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

const simulador = new Simulador({
  intervalo: clampIntervalo(numeroEnv("SIM_INTERVAL_SECONDS", 10)),
  escala: numeroEnv("SIM_TIME_SCALE", 144),
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
// control de la simulación y exige el JWT de un admin.
const usuarioOServicio = verificarJWTOServicio;
const adminOServicio = [verificarJWTOServicio, soloAdmin];
const admin = [verificarJWT, soloAdmin];

app.get("/status", admin, (req, res) => {
  res.json(simulador.status());
});

// Clima actual, pronóstico de 24 h simuladas y eventos programados
app.get("/clima", adminOServicio, (req, res) => {
  res.json(simulador.climaPublico());
});

// Evento de clima a mano: {"tipo": "lluvia"|"helada"|"ola_calor"|"viento",
// "duracion_horas": N, "en_horas": M (opcional, para que primero aparezca
// en el pronóstico)}. Las horas son simuladas.
app.post("/clima/evento", admin, (req, res) => {
  const { tipo } = req.body || {};
  const duracion = Number((req.body || {}).duracion_horas);
  const enHoras = Number((req.body || {}).en_horas || 0);
  if (!TIPOS_EVENTO.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido. Usa uno de: ${TIPOS_EVENTO.join(", ")}` });
  }
  if (!Number.isFinite(duracion) || duracion <= 0 || duracion > 72) {
    return res.status(400).json({ error: '"duracion_horas" debe ser un número de horas simuladas entre 0 y 72' });
  }
  if (!Number.isFinite(enHoras) || enHoras < 0 || enHoras > 24) {
    return res.status(400).json({ error: '"en_horas" debe estar entre 0 y 24' });
  }
  const evento = simulador.clima.programar({ tipo, duracionHoras: duracion, enHoras }, simulador.horaActualMs());
  res.status(201).json(simulador.clima.describirEvento(evento, simulador.horaActualMs()));
});

// Cancela los eventos de clima en curso y los programados
app.delete("/clima/eventos", admin, (req, res) => {
  res.json({ ok: true, eliminados: simulador.clima.limpiar() });
});

// Activa o desactiva los eventos aleatorios: {"activo": true|false}
app.post("/clima/aleatorio", admin, (req, res) => {
  simulador.clima.aleatorios = (req.body || {}).activo !== false;
  res.json({ ok: true, eventos_aleatorios: simulador.clima.aleatorios });
});

// Hora simulada para el motor de riego de fincas-service
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
