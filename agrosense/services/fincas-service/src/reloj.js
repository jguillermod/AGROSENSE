// Reloj del motor de riego.
//
// - "simulado" (por defecto, AgroSense corre como simulación): la hora la da
//   el simulator-service (GET /reloj), que avanza SIM_TIME_SCALE veces más
//   rápido que la real; así las programaciones se disparan en pocos minutos
//   reales durante la demo.
// - "real": hora local en APP_TIMEZONE (por defecto America/Guatemala), para
//   cuando haya sensores reales y no corra el simulador.
//
// Las horas se manejan "de pared", sin zona horaria: un Date cuyos campos UTC
// son la fecha/hora local. Así se comparan y se guardan tal cual en columnas
// DATETIME, igual que las escribe la gente ("regar a las 06:00").

const { cabeceraServicio } = require("./verificarJWT");

const MODO = process.env.RIEGO_RELOJ === "real" ? "real" : "simulado";
const SIMULATOR_URL = process.env.SIMULATOR_SERVICE_URL || "http://simulator-service:3000";
const ZONA = process.env.APP_TIMEZONE || "America/Guatemala";

function horaRealDePared() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return new Date(Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second));
}

// { fecha: Date de pared, modo, escala, pausado }
async function ahora() {
  if (MODO === "real") return { fecha: horaRealDePared(), modo: "real", escala: 1, pausado: false };
  // llamada interna: token de servicio, nunca el JWT de un usuario
  const res = await fetch(`${SIMULATOR_URL}/reloj`, { headers: cabeceraServicio(), signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`el simulador respondió ${res.status}`);
  const data = await res.json();
  return { fecha: new Date(`${data.fecha_hora}Z`), modo: "simulado", escala: data.escala, pausado: data.pausado };
}

// "YYYY-MM-DD HH:MM:SS" para columnas DATETIME
const aSql = (fecha) => fecha.toISOString().slice(0, 19).replace("T", " ");

module.exports = { MODO, ahora, aSql };
