// Estaciones que alimenta este servicio y su estado inicial, leídos de la base.
//
// - Cuáles: las de código con el prefijo ESTACIONES_PREFIJO ("AGS-" por
//   defecto). Un sensor físico se registra con otro código y nunca se toca.
// - Llaves: la api_key en texto plano no se guarda en ningún lado (en la base
//   solo queda su sha256). Al arrancar, y cada vez que lecturas-service
//   rechaza una (p. ej. después de restaurar un respaldo en otro servidor),
//   se genera una nueva, se registra su hash y se guarda solo en memoria.
// - Clima de cada finca: media y amplitud del día salen de las lecturas de
//   los últimos días, así continúa igual después de un reinicio o de
//   restaurar un respaldo; sin historial se usa un perfil templado.
// - Hueco: si la última lectura guardada es anterior a ahora (servicio
//   detenido, respaldo restaurado días después), se rellena con lecturas
//   verosímiles cada 5 minutos, hasta un máximo de RELLENO_MAX_DIAS.

const crypto = require("crypto");
const pool = require("./db");
const modelo = require("./modelo");

const PREFIJO = process.env.ESTACIONES_PREFIJO || "AGS-";
const RELLENO_MAX_DIAS = Math.min(7, Number(process.env.RELLENO_MAX_DIAS) || 7);
const RELLENO_PASO_MIN = 5;
const VENTANA_PERFIL_DIAS = 3;

const sha256 = (valor) => crypto.createHash("sha256").update(valor).digest("hex");
const aSqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

// Minutos a sumar a una hora UTC para obtener la local (Guatemala: -360)
function desfaseLocalMin(ms = Date.now()) {
  const local = new Date(new Date(ms).toLocaleString("en-US", { timeZone: modelo.ZONA }));
  const utc = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local - utc) / 60000);
}

async function leerEstaciones() {
  const [filas] = await pool.query(
    `SELECT e.id, e.codigo, p.id AS parcela_id, p.nombre AS parcela_nombre, p.humedad_min, p.humedad_max,
            p.temperatura_max, p.temperatura_min, p.riego_automatico, f.id AS finca_id, f.nombre AS finca_nombre
     FROM estaciones e
     JOIN parcelas p ON p.id = e.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     WHERE e.codigo LIKE ?
     ORDER BY f.id, p.id, e.id`,
    [`${PREFIJO}%`]
  );
  return filas;
}

// Llave nueva para una estación: se registra el hash y se devuelve el texto
async function regenerarLlave(estacionId) {
  const apiKey = crypto.randomBytes(24).toString("hex");
  const [result] = await pool.query("UPDATE estaciones SET api_key_hash = ? WHERE id = ? AND codigo LIKE ?", [
    sha256(apiKey),
    estacionId,
    `${PREFIJO}%`,
  ]);
  return result.affectedRows === 1 ? apiKey : null;
}

// Perfil de clima de cada finca y desfase de temperatura de cada parcela
async function leerPerfiles(estaciones) {
  const desfase = desfaseLocalMin();
  const [porFinca] = await pool.query(
    `SELECT p.finca_id, AVG(l.temperatura) AS media,
            AVG(CASE WHEN HOUR(l.fecha + INTERVAL ? MINUTE) BETWEEN 13 AND 16 THEN l.temperatura END) AS tarde,
            AVG(CASE WHEN HOUR(l.fecha + INTERVAL ? MINUTE) BETWEEN 2 AND 5 THEN l.temperatura END) AS madrugada
     FROM lecturas l
     JOIN estaciones e ON e.id = l.estacion_id
     JOIN parcelas p ON p.id = e.parcela_id
     WHERE l.fecha >= NOW() - INTERVAL ? DAY AND e.codigo LIKE ?
     GROUP BY p.finca_id`,
    [desfase, desfase, VENTANA_PERFIL_DIAS, `${PREFIJO}%`]
  );
  const [porParcela] = await pool.query(
    `SELECT e.parcela_id, AVG(l.temperatura) AS media
     FROM lecturas l JOIN estaciones e ON e.id = l.estacion_id
     WHERE l.fecha >= NOW() - INTERVAL ? DAY AND e.codigo LIKE ?
     GROUP BY e.parcela_id`,
    [VENTANA_PERFIL_DIAS, `${PREFIJO}%`]
  );

  const perfiles = new Map();
  for (const e of estaciones) {
    if (perfiles.has(e.finca_id)) continue;
    const fila = porFinca.find((f) => f.finca_id === e.finca_id);
    const deLaFinca = estaciones.filter((x) => x.finca_id === e.finca_id);
    let perfil;
    if (fila && fila.media !== null) {
      // a la media medida se le quita la variación de esos días (anomalia), que el modelo vuelve a sumar
      let suma = 0;
      const horas = VENTANA_PERFIL_DIAS * 24;
      for (let h = 0; h < horas; h++) suma += modelo.anomalia(e.finca_id, Date.now() - h * modelo.HORA_MS);
      const amplitud = fila.tarde !== null && fila.madrugada !== null ? (fila.tarde - fila.madrugada) / 2 : 6;
      perfil = { media: Number(fila.media) - suma / horas, amplitud: modelo.clamp(Number(amplitud), 3, 8) };
    } else {
      // sin historial: templado y dentro de los umbrales de sus parcelas
      const tMax = Math.min(...deLaFinca.map((x) => Number(x.temperatura_max)));
      const tMin = Math.max(...deLaFinca.map((x) => (x.temperatura_min === null ? 0 : Number(x.temperatura_min))));
      perfil = { media: modelo.clamp(Math.min(22, tMax - 10), tMin + 8, 30), amplitud: 6 };
    }
    perfil.desfaseParcela = new Map(
      deLaFinca.map((x) => {
        const parcela = porParcela.find((p) => p.parcela_id === x.parcela_id);
        const d = parcela && fila ? Number(parcela.media) - Number(fila.media) : 0;
        return [x.parcela_id, modelo.clamp(d, -3, 3)];
      })
    );
    perfiles.set(e.finca_id, perfil);
  }
  return perfiles;
}

// Última lectura de cada estación
async function leerUltimas(ids) {
  if (ids.length === 0) return new Map();
  const [filas] = await pool.query(
    `SELECT l.estacion_id, l.humedad_suelo, UNIX_TIMESTAMP(l.fecha) * 1000 AS ms
     FROM lecturas l
     JOIN (SELECT estacion_id, MAX(fecha) AS fecha FROM lecturas WHERE estacion_id IN (?) GROUP BY estacion_id) u
       ON u.estacion_id = l.estacion_id AND u.fecha = l.fecha`,
    [ids]
  );
  return new Map(filas.map((f) => [f.estacion_id, { suelo: Number(f.humedad_suelo), ms: Number(f.ms) }]));
}

// Riegos de la bitácora (hora de pared local) de unas parcelas desde un instante, en ms UTC
async function leerRiegos(parcelaIds, desdeMs) {
  if (parcelaIds.length === 0) return [];
  const desfase = desfaseLocalMin(desdeMs);
  const [filas] = await pool.query(
    `SELECT parcela_id, UNIX_TIMESTAMP(inicio) * 1000 AS inicio,
            UNIX_TIMESTAMP(COALESCE(fin, inicio + INTERVAL duracion_minutos MINUTE)) * 1000 AS fin
     FROM riego_eventos
     WHERE parcela_id IN (?) AND estado IN ('en_curso', 'completado', 'cancelado')
       AND COALESCE(fin, inicio + INTERVAL duracion_minutos MINUTE) >= ? - INTERVAL ? MINUTE`,
    [parcelaIds, aSqlUtc(desdeMs), -desfase]
  );
  // la sesión de la base está en UTC: UNIX_TIMESTAMP trató la hora local como UTC
  const corregir = (ms) => Number(ms) - desfase * 60000;
  return filas.map((f) => ({ parcela_id: f.parcela_id, inicio: corregir(f.inicio), fin: corregir(f.fin) }));
}

// Rellena el hueco de una estación entre su última lectura y `hastaMs`
async function rellenarHueco(est, estado, perfil, riegos, hastaMs) {
  const pasoMs = RELLENO_PASO_MIN * 60000;
  const desde = Math.max(estado.ultimaMs, hastaMs - RELLENO_MAX_DIAS * modelo.DIA_MS);
  if (hastaMs - desde < 2 * pasoMs) return 0;
  const parcela = { humedad_min: est.humedad_min, humedad_max: est.humedad_max };
  const medio = (Number(est.humedad_min) + Number(est.humedad_max)) / 2;
  const desfaseParcela = perfil.desfaseParcela.get(est.parcela_id) || 0;
  const dtH = RELLENO_PASO_MIN / 60;
  // instantes cada 5 min que terminan un minuto antes de ahora (así empalma con la primera lectura en vivo)
  const instantes = [];
  for (let t = hastaMs - 60000; t > desde + pasoMs / 2; t -= pasoMs) instantes.unshift(t);
  const filas = [];
  for (const t of instantes) {
    const temp = modelo.temperaturaLugar(perfil, est.finca_id, t) + desfaseParcela;
    const regando = riegos.some((r) => r.parcela_id === est.parcela_id && r.inicio <= t && t < r.fin);
    estado.suelo = modelo.pasoSuelo(estado.suelo, dtH, { temp, regando, evento: null, parcela });
    // sin saber qué se regó en ese tiempo, la humedad vuelve despacio hacia el centro del rango
    if (!regando) estado.suelo += (medio - estado.suelo) * modelo.acercar(dtH, 0.05);
    const l = modelo.lectura({ estacionId: est.id, suelo: estado.suelo, temp, evento: null });
    filas.push([l.estacion_id, l.humedad_suelo, l.temperatura, l.humedad_ambiental, aSqlUtc(t)]);
  }
  for (let i = 0; i < filas.length; i += 1000) {
    await pool.query(
      "INSERT INTO lecturas (estacion_id, humedad_suelo, temperatura, humedad_ambiental, fecha) VALUES ?",
      [filas.slice(i, i + 1000)]
    );
  }
  return filas.length;
}

// Todo lo necesario para empezar a enviar: estaciones con llave nueva, perfil
// de cada finca y humedad de suelo inicial (la de su última lectura), con el
// hueco hasta ahora ya rellenado.
async function preparar() {
  const estaciones = await leerEstaciones();
  const perfiles = await leerPerfiles(estaciones);
  const ultimas = await leerUltimas(estaciones.map((e) => e.id));
  const ahora = Date.now();
  const riegos = await leerRiegos(
    [...new Set(estaciones.map((e) => e.parcela_id))],
    ahora - RELLENO_MAX_DIAS * modelo.DIA_MS
  );

  const listas = [];
  let rellenadas = 0;
  for (const e of estaciones) {
    const apiKey = await regenerarLlave(e.id);
    if (!apiKey) continue;
    const ultima = ultimas.get(e.id);
    const medio = (Number(e.humedad_min) + Number(e.humedad_max)) / 2;
    const estado = { suelo: ultima ? ultima.suelo : medio, ultimaMs: ultima ? ultima.ms : ahora };
    const perfil = perfiles.get(e.finca_id);
    if (ultima) rellenadas += await rellenarHueco(e, estado, perfil, riegos, ahora);
    listas.push({ ...e, apiKey, suelo: estado.suelo });
  }
  if (rellenadas > 0) console.log(`[estaciones] Hueco rellenado: ${rellenadas} lecturas (hasta ${RELLENO_MAX_DIAS} días)`);
  return { estaciones: listas, perfiles };
}

// Umbrales actuales (por si se editan desde la web o la app) y estaciones vigentes
async function leerUmbrales() {
  return leerEstaciones();
}

module.exports = { PREFIJO, preparar, leerUmbrales };
