require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Simulador, ESCENARIOS } = require("./simulacion");
const { TIPOS_EVENTO } = require("./clima");
const { verificarJWT, verificarJWTOServicio, soloAdmin } = require("./verificarJWT");

const numeroEnv = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
};

const INTERVALO_MIN = 1;
const INTERVALO_MAX = 3600;

// Cada estación manda una lectura cada 30 a 60 s (al azar en cada vuelta);
// SIM_INTERVAL_SECONDS fija un intervalo exacto. SIM_TIME_SCALE=1 es la hora
// real (por defecto); una escala mayor solo sirve para ensayar a mano.
const fijo = numeroEnv("SIM_INTERVAL_SECONDS", null);
const simulador = new Simulador({
  intervalo: fijo ? { min: clampIntervalo(fijo), max: clampIntervalo(fijo) } : { min: 30, max: 60 },
  escala: numeroEnv("SIM_TIME_SCALE", 1),
  escenario: process.env.SIM_SCENARIO || "normal",
  pausado: process.env.SIM_AUTOSTART === "false",
});

function clampIntervalo(segundos) {
  return Math.min(INTERVALO_MAX, Math.max(INTERVALO_MIN, segundos));
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "simulator-service" });
});

// Permisos: /health es público; /reloj y GET /clima los consultan otros
// servicios (X-Service-Token) o un usuario con sesión; todo lo demás es el
// control de las estaciones y del clima y exige el JWT de un admin.
const usuarioOServicio = verificarJWTOServicio;
const adminOServicio = [verificarJWTOServicio, soloAdmin];
const admin = [verificarJWT, soloAdmin];

app.get("/status", admin, (req, res) => {
  res.json(simulador.status());
});

// Clima actual, pronóstico de 24 h y eventos de una finca (?finca_id=, por
// defecto la primera), con la lista de fincas en "fincas"
app.get("/clima", adminOServicio, (req, res) => {
  const clima = simulador.climaPublico(req.query.finca_id);
  if (!clima) return res.status(503).json({ error: "Todavía no hay fincas con estaciones" });
  res.json(clima);
});

// Evento de clima a mano: {"tipo": "lluvia"|"helada"|"ola_calor"|"viento",
// "duracion_horas": N, "en_horas": M (opcional, para que primero aparezca
// en el pronóstico), "finca_id": X (opcional; sin él, en todas las fincas)}.
app.post("/clima/evento", admin, (req, res) => {
  const { tipo, finca_id: fincaId } = req.body || {};
  const duracion = Number((req.body || {}).duracion_horas);
  const enHoras = Number((req.body || {}).en_horas || 0);
  if (!TIPOS_EVENTO.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido. Usa uno de: ${TIPOS_EVENTO.join(", ")}` });
  }
  if (!Number.isFinite(duracion) || duracion <= 0 || duracion > 72) {
    return res.status(400).json({ error: '"duracion_horas" debe ser un número de horas entre 0 y 72' });
  }
  if (!Number.isFinite(enHoras) || enHoras < 0 || enHoras > 24) {
    return res.status(400).json({ error: '"en_horas" debe estar entre 0 y 24' });
  }
  const climas = simulador.climasDe(fincaId);
  if (climas.length === 0) return res.status(404).json({ error: "Esa finca no tiene estaciones" });
  const ahora = simulador.reloj.ahora();
  res.status(201).json(
    climas.map((c) => ({ finca: c.finca, ...c.describirEvento(c.programar({ tipo, duracionHoras: duracion, enHoras }, ahora), ahora) }))
  );
});

// Cancela los eventos de clima en curso y los programados (?finca_id= para una sola finca)
app.delete("/clima/eventos", admin, (req, res) => {
  const eliminados = simulador.climasDe(req.query.finca_id).reduce((n, c) => n + c.limpiar(), 0);
  res.json({ ok: true, eliminados });
});

// Activa o desactiva los eventos aleatorios: {"activo": true|false}
app.post("/clima/aleatorio", admin, (req, res) => {
  simulador.aleatorios = (req.body || {}).activo !== false;
  res.json({ ok: true, eventos_aleatorios: simulador.aleatorios });
});

// Hora del motor de riego de fincas-service (la real, salvo SIM_TIME_SCALE > 1)
app.get("/reloj", usuarioOServicio, (req, res) => {
  res.json(simulador.relojPublico());
});

app.post("/scenario", admin, (req, res) => {
  const { nombre } = req.body || {};
  if (!ESCENARIOS.includes(nombre)) {
    return res.status(400).json({ error: `Escenario inválido. Usa uno de: ${ESCENARIOS.join(", ")}` });
  }
  simulador.setEscenario(nombre);
  res.json({ ok: true, escenario: nombre });
});

app.post("/pause", admin, (req, res) => {
  simulador.pausar();
  res.json({ ok: true, estado: simulador.status().estado });
});

app.post("/resume", admin, (req, res) => {
  simulador.reanudar();
  res.json({ ok: true, estado: simulador.status().estado });
});

app.post("/speed", admin, (req, res) => {
  const intervalo = Number((req.body || {}).intervalo);
  if (!Number.isFinite(intervalo) || intervalo < INTERVALO_MIN || intervalo > INTERVALO_MAX) {
    return res
      .status(400)
      .json({ error: `"intervalo" debe ser un número de segundos entre ${INTERVALO_MIN} y ${INTERVALO_MAX}` });
  }
  simulador.setIntervalo(intervalo);
  res.json({ ok: true, intervalo_segundos: intervalo });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`simulator-service escuchando en puerto ${PORT}`);
  simulador.iniciar();
});
