require("dotenv").config();
const express = require("express");
const respaldos = require("./respaldos");

const INTERVALO_HORAS = Number(process.env.BACKUP_INTERVAL_HOURS) || 24;
const AL_ARRANCAR = process.env.BACKUP_ON_START === "true";
// Si se define, todas las rutas /backups exigen la cabecera x-backup-token
// (el panel web la envía). Sin definir, el servicio confía en la red interna
// igual que los demás microservicios.
const TOKEN = process.env.BACKUP_API_TOKEN || "";

const app = express();
app.use(express.json());

let proximoAutomatico = null;
let ultimoError = null;

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "backup-service" });
});

app.use("/backups", (req, res, next) => {
  if (TOKEN && req.get("x-backup-token") !== TOKEN) return res.status(401).json({ error: "Token de respaldo inválido" });
  next();
});

const manejar = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof respaldos.ErrorRespaldo)) console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

// Lista: nombre, fecha, tamaño y tipo (manual / automático)
app.get("/backups", manejar(async (req, res) => {
  res.json(await respaldos.listar());
}));

// Configuración y estado del respaldo automático
app.get("/backups/config", manejar(async (req, res) => {
  const lista = await respaldos.listar();
  res.json({
    intervalo_horas: INTERVALO_HORAS,
    retencion_dias: respaldos.RETENCION_DIAS,
    al_arrancar: AL_ARRANCAR,
    proximo_automatico: proximoAutomatico,
    ultimo: lista[0] || null,
    ultimo_error: ultimoError,
    token_requerido: Boolean(TOKEN),
  });
}));

// Respaldo manual ahora
app.post("/backups", manejar(async (req, res) => {
  res.status(201).json(await respaldos.crear("manual"));
}));

app.get("/backups/:nombre/descargar", manejar(async (req, res) => {
  const ruta = respaldos.rutaSegura(req.params.nombre);
  if (!(await respaldos.existe(ruta))) return res.status(404).json({ error: "Ese respaldo no existe" });
  res.download(ruta, req.params.nombre);
}));

// Restaurar: crea antes un respaldo automático de seguridad
app.post("/backups/:nombre/restaurar", manejar(async (req, res) => {
  res.json(await respaldos.restaurar(req.params.nombre));
}));

app.delete("/backups/:nombre", manejar(async (req, res) => {
  res.json(await respaldos.eliminar(req.params.nombre));
}));

// --- Respaldo automático ---
async function respaldoAutomatico() {
  try {
    await respaldos.crear("automatico");
    ultimoError = null;
  } catch (err) {
    ultimoError = { mensaje: err.message, fecha: new Date().toISOString() };
    console.error(`[backup] Falló el respaldo automático: ${err.message}`);
  } finally {
    proximoAutomatico = new Date(Date.now() + INTERVALO_HORAS * 3600 * 1000).toISOString();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(
    `backup-service escuchando en puerto ${PORT} (cada ${INTERVALO_HORAS} h, retención ${respaldos.RETENCION_DIAS} días, ` +
      `al arrancar: ${AL_ARRANCAR ? "sí" : "no"}, carpeta ${respaldos.DIR})`
  );
  setInterval(respaldoAutomatico, INTERVALO_HORAS * 3600 * 1000);
  proximoAutomatico = new Date(Date.now() + INTERVALO_HORAS * 3600 * 1000).toISOString();
  try {
    await respaldos.rotar();
  } catch (err) {
    console.error(`[backup] No se pudo rotar: ${err.message}`);
  }
  if (AL_ARRANCAR) respaldoAutomatico();
});
