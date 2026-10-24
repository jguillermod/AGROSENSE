// Modelo del "mundo" que miden las estaciones: temperatura del lugar con
// ciclo día/noche y variación de un día a otro, humedad ambiental y humedad
// del suelo (evaporación, riego y lluvia).
//
// Lo usan el envío en vivo (simulacion.js), el relleno de huecos al arrancar
// (estaciones.js) y el script de datos iniciales (scripts/datos-iniciales.js),
// para que el historial y lo que viene después sean continuos y coherentes.
//
// Las horas del día son las de APP_TIMEZONE (hora real de Guatemala): el
// máximo de temperatura cae hacia las 15:00 y el mínimo hacia las 03:00.

const ZONA = process.env.APP_TIMEZONE || "America/Guatemala";
const HORA_MS = 3600 * 1000;
const DIA_MS = 24 * HORA_MS;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const redondear = (v) => Math.round(v * 100) / 100;
// Ruido gaussiano (Box-Muller)
const ruido = (sigma) => sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
// Fracción del camino hacia un objetivo en dtH horas con tasa k (1/h)
const acercar = (dtH, k) => 1 - Math.exp(-k * dtH);

const formatoHora = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Hora local del día (0–24, con decimales) de un instante
function horaLocal(ms) {
  const partes = Object.fromEntries(formatoHora.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Number(partes.hour) + Number(partes.minute) / 60;
}

// Variación lenta de un día a otro (frentes, días nublados), igual para toda
// la finca y determinista en el tiempo: el historial, el relleno y el envío
// en vivo dan el mismo valor para el mismo instante.
function anomalia(fincaId, ms) {
  const dias = ms / DIA_MS;
  const fase = (fincaId * 2.399) % (2 * Math.PI);
  return 1.3 * Math.sin((2 * Math.PI * dias) / 4.3 + fase) + 0.7 * Math.sin((2 * Math.PI * dias) / 9.7 + 2 * fase);
}

// Ciclo diario: +1 a las 15:00, -1 a las 03:00
const ciclo = (hora) => Math.sin((2 * Math.PI * (hora - 9)) / 24);

// Perfil de clima de una finca: { media, amplitud } en °C
function temperaturaLugar(perfil, fincaId, ms) {
  return perfil.media + anomalia(fincaId, ms) + perfil.amplitud * ciclo(horaLocal(ms));
}

// Ajuste de temperatura por un evento de clima en curso ("sequia" es el
// escenario de POST /scenario: más calor y evaporación, sin lluvia)
function ajusteEvento(temp, evento) {
  if (evento === "lluvia") return temp - 3;
  if (evento === "sequia") return temp + 3;
  if (evento === "helada") return Math.min(temp, 1.5);
  if (evento === "ola_calor") return temp + 9;
  return temp;
}

function humedadAmbiental(temp, evento) {
  let hr = 85 - 2.2 * (temp - 12);
  if (evento === "lluvia") hr += 15;
  if (evento === "viento") hr -= 10;
  if (evento === "sequia") hr -= 12;
  return clamp(hr, 18, 99);
}

// Pérdida de humedad del suelo en %/h según la temperatura (más con calor y viento)
function evaporacion(temp, evento) {
  const calor = clamp(1 + (temp - 20) / 10, 0.4, 2.4);
  return 0.24 * calor * ({ viento: 1.5, sequia: 3 }[evento] || 1);
}

// Avanza la humedad del suelo dtH horas. parcela: { humedad_min, humedad_max }
function pasoSuelo(suelo, dtH, { temp, regando, evento, parcela }) {
  const max = Number(parcela.humedad_max);
  if (regando) {
    // el agua sube la humedad hasta la capacidad de campo (algo bajo el máximo)
    const tope = Math.min(95, max - 3);
    if (suelo < tope) suelo += (tope - suelo) * acercar(dtH, 0.9);
  } else if (evento === "lluvia") {
    const tope = Math.min(98, max + 4);
    if (suelo < tope) suelo += (tope - suelo) * acercar(dtH, 0.5);
  } else {
    suelo -= evaporacion(temp, evento) * dtH;
    if (suelo > max - 2) suelo -= (suelo - (max - 4)) * acercar(dtH, 0.25); // drenaje
  }
  // variación suave (la desviación crece con la raíz del tiempo, no por lectura)
  return clamp(suelo + ruido(0.35 * Math.sqrt(dtH)), 5, 100);
}

// Lectura de una estación a partir del estado de su parcela
function lectura({ estacionId, suelo, temp, evento }) {
  const t = temp + ruido(0.2);
  return {
    estacion_id: estacionId,
    humedad_suelo: redondear(clamp(suelo + ruido(0.1), 0, 100)),
    temperatura: redondear(t),
    humedad_ambiental: redondear(clamp(humedadAmbiental(t, evento) + ruido(1), 15, 99)),
  };
}

module.exports = {
  HORA_MS,
  DIA_MS,
  ZONA,
  clamp,
  redondear,
  ruido,
  acercar,
  horaLocal,
  anomalia,
  temperaturaLugar,
  ajusteEvento,
  humedadAmbiental,
  evaporacion,
  pasoSuelo,
  lectura,
};
