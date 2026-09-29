require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const hash = (valor) => crypto.createHash("sha256").update(valor).digest("hex");

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "lecturas-service" });
});

// El ESP32 envía sus lecturas aquí periódicamente (RF-07).
// Debe autenticarse con la api_key que recibió al vincularse (ver
// POST /api/estaciones/vincular en fincas-service) para evitar que
// cualquiera pueda inyectar lecturas falsas a nombre de otra estación.
app.post("/api/lecturas", async (req, res) => {
  try {
    const apiKey = req.get("x-api-key");
    const { estacion_id, humedad_suelo, temperatura, humedad_ambiental } = req.body;

    if (!apiKey) {
      return res.status(401).json({ error: "Falta la cabecera x-api-key" });
    }

    const [estaciones] = await pool.query(
      "SELECT api_key_hash FROM estaciones WHERE id = ?",
      [estacion_id]
    );
    if (estaciones.length === 0 || estaciones[0].api_key_hash !== hash(apiKey)) {
      return res.status(401).json({ error: "api_key inválida para esta estación" });
    }

    const [result] = await pool.query(
      `INSERT INTO lecturas (estacion_id, humedad_suelo, temperatura, humedad_ambiental, fecha)
       VALUES (?, ?, ?, ?, NOW())`,
      [estacion_id, humedad_suelo, temperatura, humedad_ambiental]
    );

    // Traer umbrales de la parcela asociada a esta estación (RF-09)
    const [parcelaRows] = await pool.query(
      `SELECT p.id AS parcela_id, p.humedad_min, p.humedad_max, p.temperatura_max
       FROM parcelas p
       JOIN estaciones e ON e.parcela_id = p.id
       WHERE e.id = ?`,
      [estacion_id]
    );

    let alerta = null;
    if (parcelaRows.length > 0) {
      const p = parcelaRows[0];
      if (humedad_suelo < p.humedad_min) alerta = "Necesita riego";
      else if (humedad_suelo > p.humedad_max) alerta = "Riesgo de exceso de humedad";
      else if (temperatura > p.temperatura_max) alerta = "Riesgo de estrés hídrico por calor";

      if (alerta) {
        await pool.query(
          `INSERT INTO alertas (parcela_id, estacion_id, tipo, fecha) VALUES (?, ?, ?, NOW())`,
          [p.parcela_id, estacion_id, alerta]
        );
      }
    }

    res.status(201).json({ id: result.insertId, alerta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al guardar la lectura" });
  }
});

// Historial de lecturas por estación (RF-05)
app.get("/api/estaciones/:estacionId/lecturas", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM lecturas WHERE estacion_id = ? ORDER BY fecha DESC LIMIT 200",
    [req.params.estacionId]
  );
  res.json(rows);
});

// Alertas activas de una parcela
app.get("/api/parcelas/:parcelaId/alertas", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM alertas WHERE parcela_id = ? ORDER BY fecha DESC",
    [req.params.parcelaId]
  );
  res.json(rows);
});

// --- Registros manuales de campo (humedad/temperatura a ojo + anotaciones) ---
// Puede registrar el admin (en cualquier parcela) o quien tenga esa
// parcela asignada en usuario_parcelas (agrónomo, o cualquier usuario al
// que se la hayan asignado).
async function puedeRegistrarEnParcela(usuarioId, parcelaId) {
  const [usuarios] = await pool.query("SELECT rol FROM usuarios WHERE id = ?", [usuarioId]);
  if (usuarios.length === 0) return false;
  if (usuarios[0].rol !== "agronomo") return true; // admin/agricultor: mismo acceso amplio que ya tienen sobre parcelas
  const [asignaciones] = await pool.query(
    "SELECT 1 FROM usuario_parcelas WHERE usuario_id = ? AND parcela_id = ?",
    [usuarioId, parcelaId]
  );
  return asignaciones.length > 0;
}

app.get("/api/parcelas/:parcelaId/registros", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, u.nombre AS usuario_nombre
     FROM registros_manuales r
     JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.parcela_id = ?
     ORDER BY r.fecha DESC
     LIMIT 100`,
    [req.params.parcelaId]
  );
  res.json(rows);
});

app.post("/api/parcelas/:parcelaId/registros", async (req, res) => {
  const parcelaId = Number(req.params.parcelaId);
  const { usuario_id, humedad_suelo, temperatura, anotaciones } = req.body;

  if (!usuario_id) return res.status(400).json({ error: "Falta usuario_id" });
  const sinValores = humedad_suelo === undefined && temperatura === undefined;
  const sinAnotacion = !anotaciones || !String(anotaciones).trim();
  if (sinValores && sinAnotacion) {
    return res.status(400).json({ error: "Registra al menos un valor o una anotación" });
  }

  try {
    const permitido = await puedeRegistrarEnParcela(usuario_id, parcelaId);
    if (!permitido) {
      return res.status(403).json({ error: "No tienes esta parcela asignada" });
    }

    const [result] = await pool.query(
      `INSERT INTO registros_manuales (parcela_id, usuario_id, humedad_suelo, temperatura, anotaciones)
       VALUES (?, ?, ?, ?, ?)`,
      [parcelaId, usuario_id, humedad_suelo ?? null, temperatura ?? null, anotaciones ?? null]
    );

    const [[usuario]] = await pool.query("SELECT nombre FROM usuarios WHERE id = ?", [usuario_id]);
    res.status(201).json({
      id: result.insertId,
      parcela_id: parcelaId,
      usuario_id,
      usuario_nombre: usuario?.nombre ?? null,
      humedad_suelo: humedad_suelo ?? null,
      temperatura: temperatura ?? null,
      anotaciones: anotaciones ?? null,
      fecha: new Date(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar el registro" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`lecturas-service escuchando en puerto ${PORT}`);
});
