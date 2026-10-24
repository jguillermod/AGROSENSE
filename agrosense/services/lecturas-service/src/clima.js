// Alertas climáticas a partir del clima actual y del pronóstico.
//
// Cada CLIMA_POLL_SECONDS consulta al proveedor de clima (por defecto el
// simulator-service con GET /clima, que da el clima de cada finca; se puede
// cambiar por una API meteorológica con la misma forma de respuesta en
// CLIMA_PROVIDER_URL) y, para cada parcela de cada finca, abre o resuelve
// alertas climáticas con el mismo mecanismo de "una vigente por tipo" que las
// de sensor.
//
// El riesgo se decide aquí y no en el proveedor: el proveedor solo dice qué
// clima hay y cuál viene; qué es un riesgo para cada parcela (p. ej. bajar de
// SU temperatura mínima) es regla de AgroSense.

const pool = require("./db");
const { abrirOActualizar, resolver } = require("./alertas");
const { cabeceraServicio } = require("./verificarJWT");
const { filtroFincas } = require("./permisos");

const PROVEEDOR_URL = process.env.CLIMA_PROVIDER_URL || process.env.SIMULATOR_SERVICE_URL || "http://simulator-service:3000";
// El token interno solo viaja al simulador; nunca a un proveedor externo (CLIMA_PROVIDER_URL)
const CABECERAS_PROVEEDOR = process.env.CLIMA_PROVIDER_URL ? {} : cabeceraServicio();
const INTERVALO_MS = (Number(process.env.CLIMA_POLL_SECONDS) || 10) * 1000;

// Tipos de alerta climática. Los dos de lluvia los consulta también el motor
// de riego de fincas-service para omitir riegos: si cambian, cambiarlos allá.
const CLIMA = {
  lluviaAhora: "Lluvia en curso: riego pospuesto",
  lluviaPrevista: "Lluvia intensa prevista: posponer riego",
  helada: "Pronóstico de helada",
  calor: "Pronóstico de ola de calor",
  vientoAhora: "Viento fuerte",
  vientoPrevisto: "Viento fuerte previsto",
};

const LLUVIA_INTENSA_MM = 2; // mm/h
const VIENTO_FUERTE_KMH = 50;

const ultimos = new Map(); // finca_id -> { datos, recibido_en } para GET /api/clima
let ultimoErrorLog = 0;

const hora = (fechaHora) => String(fechaHora).slice(11, 16);
const enLasProximas = (pronostico, horas) => pronostico.slice(0, horas);
const esDeNoche = (fechaHora) => {
  const h = Number(hora(fechaHora).slice(0, 2));
  return h >= 18 || h < 8;
};

// Condiciones climáticas de riesgo para una parcela
function evaluarParcela(parcela, clima) {
  const { ahora, pronostico } = clima;
  const prox12 = enLasProximas(pronostico, 12);
  const prox24 = enLasProximas(pronostico, 24);
  const tMin = parcela.temperatura_min === null ? null : Number(parcela.temperatura_min);
  const tMax = Number(parcela.temperatura_max);

  const lloviendo = ahora.lluvia_mm > 0.5;
  const lluviaFutura = prox12.find((h) => h.lluvia_mm >= LLUVIA_INTENSA_MM);
  const heladaFutura = tMin === null ? null : prox12.find((h) => h.temperatura < tMin);
  const calorFuturo = prox24.find((h) => h.temperatura > tMax + 2);
  const vientoFuturo = prox12.find((h) => h.viento_kmh >= VIENTO_FUERTE_KMH);
  const maxLluvia = Math.max(...prox12.map((h) => h.lluvia_mm), 0);

  return [
    {
      tipo: CLIMA.lluviaAhora,
      activa: lloviendo,
      severidad: "info",
      detalle: `Lluvia de ${ahora.lluvia_mm} mm/h: los riegos se omiten mientras llueva`,
      valor: ahora.lluvia_mm,
    },
    {
      tipo: CLIMA.lluviaPrevista,
      activa: !lloviendo && Boolean(lluviaFutura),
      severidad: "media",
      detalle: lluviaFutura
        ? `Lluvia de hasta ${maxLluvia} mm/h desde las ${hora(lluviaFutura.fecha_hora)}: conviene posponer el riego`
        : "",
      valor: maxLluvia,
    },
    {
      // si ya hiela ahora, lo cubre la alerta de sensor "Riesgo de helada"
      tipo: CLIMA.helada,
      activa: Boolean(heladaFutura) && !(tMin !== null && ahora.temperatura < tMin),
      severidad: "alta",
      detalle: heladaFutura
        ? `Se esperan ${heladaFutura.temperatura} °C${esDeNoche(heladaFutura.fecha_hora) ? " esta noche" : ""} hacia las ${hora(heladaFutura.fecha_hora)} (mínimo de la parcela ${tMin} °C)`
        : "",
      valor: heladaFutura ? heladaFutura.temperatura : null,
    },
    {
      tipo: CLIMA.calor,
      activa: Boolean(calorFuturo) && ahora.temperatura <= tMax,
      severidad: "media",
      detalle: calorFuturo
        ? `Se esperan ${calorFuturo.temperatura} °C hacia las ${hora(calorFuturo.fecha_hora)} (máximo de la parcela ${tMax} °C)`
        : "",
      valor: calorFuturo ? calorFuturo.temperatura : null,
    },
    {
      tipo: CLIMA.vientoAhora,
      activa: ahora.viento_kmh >= VIENTO_FUERTE_KMH,
      severidad: "media",
      detalle: `Viento de ${ahora.viento_kmh} km/h`,
      valor: ahora.viento_kmh,
    },
    {
      tipo: CLIMA.vientoPrevisto,
      activa: ahora.viento_kmh < VIENTO_FUERTE_KMH && Boolean(vientoFuturo),
      severidad: "info",
      detalle: vientoFuturo ? `Viento de ${vientoFuturo.viento_kmh} km/h previsto hacia las ${hora(vientoFuturo.fecha_hora)}` : "",
      valor: vientoFuturo ? vientoFuturo.viento_kmh : null,
    },
  ];
}

async function pedirClima(fincaId) {
  const url = fincaId ? `${PROVEEDOR_URL}/clima?finca_id=${fincaId}` : `${PROVEEDOR_URL}/clima`;
  const res = await fetch(url, { headers: CABECERAS_PROVEEDOR, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`el proveedor de clima respondió ${res.status}`);
  return res.json();
}

// Pide el clima de cada finca que informa el proveedor (en "fincas"; un
// proveedor con una sola finca la manda en "finca") y evalúa sus parcelas
async function revisar() {
  try {
    const primero = await pedirClima();
    const fincas = Array.isArray(primero.fincas) && primero.fincas.length ? primero.fincas : [primero.finca].filter(Boolean);
    const vigentes = new Set();
    for (const finca of fincas) {
      if (!finca || !finca.id) continue;
      const clima = primero.finca && primero.finca.id === finca.id ? primero : await pedirClima(finca.id);
      if (!clima.finca || !Array.isArray(clima.pronostico)) continue;
      ultimos.set(finca.id, { datos: clima, recibido_en: new Date().toISOString() });
      vigentes.add(finca.id);
      await evaluarFinca(clima);
    }
    // fincas que ya no informa el proveedor (borradas o sin estaciones)
    for (const id of ultimos.keys()) if (!vigentes.has(id)) ultimos.delete(id);
  } catch (err) {
    // sin datos de clima no se abre ni se resuelve nada (se conserva el estado)
    if (Date.now() - ultimoErrorLog > 60000) {
      console.error(`[clima] Sin datos de clima: ${err.message}`);
      ultimoErrorLog = Date.now();
    }
  }
}

async function evaluarFinca(clima) {
  const [parcelas] = await pool.query(
    "SELECT id, temperatura_min, temperatura_max FROM parcelas WHERE finca_id = ?",
    [clima.finca.id]
  );
  for (const parcela of parcelas) {
    for (const c of evaluarParcela(parcela, clima)) {
      if (c.activa) {
        const nueva = await abrirOActualizar({
          parcelaId: parcela.id,
          tipo: c.tipo,
          categoria: "climatica",
          severidad: c.severidad,
          detalle: c.detalle,
          valor: c.valor,
        });
        if (nueva) console.log(`[clima] Alerta "${c.tipo}" en parcela ${parcela.id}: ${c.detalle}`);
      } else {
        await resolver(parcela.id, c.tipo);
      }
    }
  }
}

let revisando = false;
async function tick() {
  if (revisando) return;
  revisando = true;
  try {
    await revisar();
  } catch (err) {
    console.error(`[clima] ${err.message}`);
  } finally {
    revisando = false;
  }
}

function iniciar() {
  console.log(`[clima] Revisando el clima cada ${INTERVALO_MS / 1000} s (${PROVEEDOR_URL}/clima)`);
  setInterval(tick, INTERVALO_MS);
  tick();
}

function registrarRutas(app) {
  // Último clima recibido (para el dashboard web y la app): el de ?finca_id=
  // si el usuario la puede ver, si no el de la primera de sus fincas
  app.get("/api/clima", async (req, res) => {
    try {
      const filtro = filtroFincas(req.usuario, "id") || { sql: "TRUE", params: [] };
      const [visibles] = await pool.query(`SELECT id FROM fincas WHERE ${filtro.sql} ORDER BY id`, filtro.params);
      const ids = visibles.map((f) => f.id).filter((id) => ultimos.has(id));
      const pedida = Number(req.query.finca_id);
      const id = ids.includes(pedida) ? pedida : ids[0];
      if (!id) return res.status(503).json({ error: "Todavía no hay datos de clima" });
      const { datos, recibido_en } = ultimos.get(id);
      res.json({ ...datos, fincas: undefined, recibido_en });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar el clima" });
    }
  });
}

module.exports = { iniciar, registrarRutas, CLIMA };
