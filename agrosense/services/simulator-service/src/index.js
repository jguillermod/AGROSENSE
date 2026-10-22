require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Simulador, ESCENARIOS } = require("./simulacion");

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

app.get("/status", (req, res) => {
  res.json(simulador.status());
});

app.post("/scenario", (req, res) => {
  const { nombre } = req.body || {};
  if (!ESCENARIOS.includes(nombre)) {
    return res.status(400).json({ error: `Escenario inválido. Usa uno de: ${ESCENARIOS.join(", ")}` });
  }
  simulador.setEscenario(nombre);
  res.json({ ok: true, escenario: nombre });
});

app.post("/pause", (req, res) => {
  simulador.pausar();
  res.json({ ok: true, estado: simulador.status().estado });
});

app.post("/resume", (req, res) => {
  simulador.reanudar();
  res.json({ ok: true, estado: simulador.status().estado });
});

app.post("/speed", (req, res) => {
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
