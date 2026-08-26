require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "fincas-service" });
});

// --- Fincas ---
app.get("/api/fincas", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM fincas");
  res.json(rows);
});

app.post("/api/fincas", async (req, res) => {
  const { nombre, ubicacion, usuario_id } = req.body;
  const [result] = await pool.query(
    "INSERT INTO fincas (nombre, ubicacion, usuario_id) VALUES (?, ?, ?)",
    [nombre, ubicacion, usuario_id]
  );
  res.status(201).json({ id: result.insertId, nombre, ubicacion, usuario_id });
});

// --- Parcelas ---
app.get("/api/fincas/:fincaId/parcelas", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM parcelas WHERE finca_id = ?", [req.params.fincaId]);
  res.json(rows);
});

app.post("/api/parcelas", async (req, res) => {
  const { nombre, finca_id, humedad_min, humedad_max, temperatura_max } = req.body;
  const [result] = await pool.query(
    `INSERT INTO parcelas (nombre, finca_id, humedad_min, humedad_max, temperatura_max)
     VALUES (?, ?, ?, ?, ?)`,
    [nombre, finca_id, humedad_min, humedad_max, temperatura_max]
  );
  res.status(201).json({ id: result.insertId, nombre, finca_id });
});

// --- Estaciones/Sensores ---
app.get("/api/parcelas/:parcelaId/estaciones", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM estaciones WHERE parcela_id = ?", [req.params.parcelaId]);
  res.json(rows);
});

app.post("/api/estaciones", async (req, res) => {
  const { codigo, parcela_id } = req.body;
  const [result] = await pool.query(
    "INSERT INTO estaciones (codigo, parcela_id) VALUES (?, ?)",
    [codigo, parcela_id]
  );
  res.status(201).json({ id: result.insertId, codigo, parcela_id });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`fincas-service escuchando en puerto ${PORT}`);
});
