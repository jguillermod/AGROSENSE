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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`lecturas-service escuchando en puerto ${PORT}`);
});
