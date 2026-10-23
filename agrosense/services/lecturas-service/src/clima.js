// Alertas climáticas a partir del clima actual y del pronóstico.
//
// Cada CLIMA_POLL_SECONDS consulta al proveedor de clima (durante la demo, el
// simulator-service con GET /clima; en producción se cambiaría por una API
// meteorológica con la misma forma de respuesta) y, para cada parcela de la
// finca a la que corresponde ese clima, abre o resuelve alertas climáticas
// con el mismo mecanismo de "una vigente por tipo" que las de sensor.
//
// El riesgo se decide aquí y no en el simulador: el simulador solo hace de
// "mundo" (qué clima hay y cuál viene); qué es un riesgo para cada parcela
// (p. ej. bajar de SU temperatura mínima) es regla de AgroSense.

const pool = require("./db");
const { abrirOActualizar, resolver } = require("./alertas");
const { cabeceraServicio } = require("./verificarJWT");

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

let ultimo = null; // { datos, recibido_en } para GET /api/clima
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

async function revisar() {
  let clima;
  try {
    const res = await fetch(`${PROVEEDOR_URL}/clima`, { headers: CABECERAS_PROVEEDOR, signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`el proveedor de clima respondió ${res.status}`);
    clima = await res.json();
  } catch (err) {
    // sin datos de clima no se abre ni se resuelve nada (se conserva el estado)
    if (Date.now() - ultimoErrorLog > 60000) {
      console.error(`[clima] Sin datos de clima: ${err.message}`);
      ultimoErrorLog = Date.now();
    }
    return;
  }
  ultimo = { datos: clima, recibido_en: new Date().toISOString() };
  if (!clima.finca || !clima.finca.id || !Array.isArray(clima.pronostico)) return;

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
  // Último clima recibido (para el dashboard web y la app)
  app.get("/api/clima", (req, res) => {
    if (!ultimo) return res.status(503).json({ error: "Todavía no hay datos de clima" });
    res.json({ ...ultimo.datos, recibido_en: ultimo.recibido_en });
  });
}

module.exports = { iniciar, registrarRutas, CLIMA };
