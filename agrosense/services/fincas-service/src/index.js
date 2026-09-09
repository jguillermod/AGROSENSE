require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const pool = require("./db");

const TOKEN_TTL_MINUTOS = 30;
const hash = (valor) => crypto.createHash("sha256").update(valor).digest("hex");

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

app.put("/api/fincas/:id", async (req, res) => {
  const { nombre, ubicacion } = req.body;
  const [result] = await pool.query("UPDATE fincas SET nombre = ?, ubicacion = ? WHERE id = ?", [
    nombre,
    ubicacion,
    req.params.id,
  ]);
  if (result.affectedRows === 0) return res.status(404).json({ error: "Finca no encontrada" });
  res.json({ id: Number(req.params.id), nombre, ubicacion });
});

// Elimina una finca: se bloquea si todavía tiene parcelas (que a su vez
// podrían tener sensores e historial dependiendo de ellas).
app.delete("/api/fincas/:id", async (req, res) => {
  const [parcelas] = await pool.query("SELECT COUNT(*) AS total FROM parcelas WHERE finca_id = ?", [
    req.params.id,
  ]);
  if (parcelas[0].total > 0) {
    return res.status(409).json({ error: "No se puede eliminar: la finca todavía tiene parcelas" });
  }
  const [result] = await pool.query("DELETE FROM fincas WHERE id = ?", [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: "Finca no encontrada" });
  res.json({ ok: true });
});

// Calcula el estado de una parcela según sus umbrales y la última lectura recibida
function calcularEstado(p) {
  if (p.humedad_actual === null || p.humedad_actual === undefined) return "Sin datos";
  if (p.humedad_actual < p.humedad_min) return "Necesita riego";
  if (p.humedad_actual > p.humedad_max) return "Riesgo de hongos";
  if (p.temperatura_actual !== null && p.temperatura_actual > p.temperatura_max) return "Riesgo por calor";
  return "Óptimo";
}

// --- Parcelas ---
// Incluye la última lectura recibida (humedad/temperatura) y el estado calculado (RF-09)
app.get("/api/fincas/:fincaId/parcelas", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, ult.humedad_suelo AS humedad_actual, ult.temperatura AS temperatura_actual
     FROM parcelas p
     LEFT JOIN (
       SELECT e.parcela_id, l.humedad_suelo, l.temperatura,
              ROW_NUMBER() OVER (PARTITION BY e.parcela_id ORDER BY l.fecha DESC) AS rn
       FROM estaciones e
       JOIN lecturas l ON l.estacion_id = e.id
     ) ult ON ult.parcela_id = p.id AND ult.rn = 1
     WHERE p.finca_id = ?`,
    [req.params.fincaId]
  );
  res.json(rows.map((p) => ({ ...p, estado: calcularEstado(p) })));
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

app.put("/api/parcelas/:id", async (req, res) => {
  const { nombre, humedad_min, humedad_max, temperatura_max } = req.body;
  const [result] = await pool.query(
    `UPDATE parcelas SET nombre = ?, humedad_min = ?, humedad_max = ?, temperatura_max = ?
     WHERE id = ?`,
    [nombre, humedad_min, humedad_max, temperatura_max, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: "Parcela no encontrada" });
  res.json({ id: Number(req.params.id), nombre, humedad_min, humedad_max, temperatura_max });
});

// Elimina una parcela: se bloquea si todavía tiene sensores vinculados,
// para no perder en silencio el historial de lecturas que dependen de ellos.
app.delete("/api/parcelas/:id", async (req, res) => {
  const [estaciones] = await pool.query("SELECT COUNT(*) AS total FROM estaciones WHERE parcela_id = ?", [
    req.params.id,
  ]);
  if (estaciones[0].total > 0) {
    return res.status(409).json({ error: "No se puede eliminar: la parcela tiene sensores vinculados" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM alertas WHERE parcela_id = ?", [req.params.id]);
    await conn.query("DELETE FROM reportes_diarios WHERE parcela_id = ?", [req.params.id]);
    await conn.query("DELETE FROM sensor_tokens WHERE parcela_id = ?", [req.params.id]);
    const [result] = await conn.query("DELETE FROM parcelas WHERE id = ?", [req.params.id]);
    await conn.commit();
    if (result.affectedRows === 0) return res.status(404).json({ error: "Parcela no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la parcela" });
  } finally {
    conn.release();
  }
});

// Listado plano de todas las parcelas (para asignarlas a un usuario)
app.get("/api/parcelas", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.nombre, p.finca_id, f.nombre AS finca_nombre
     FROM parcelas p
     JOIN fincas f ON f.id = p.finca_id
     ORDER BY f.nombre, p.nombre`
  );
  res.json(rows);
});

// --- Asignación de parcelas a usuarios (RF-08) ---
app.get("/api/asignaciones", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT up.usuario_id, up.parcela_id, p.nombre AS parcela_nombre, f.nombre AS finca_nombre
     FROM usuario_parcelas up
     JOIN parcelas p ON p.id = up.parcela_id
     JOIN fincas f ON f.id = p.finca_id`
  );
  res.json(rows);
});

app.get("/api/asignaciones/:usuarioId", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT up.parcela_id, p.nombre AS parcela_nombre, f.nombre AS finca_nombre
     FROM usuario_parcelas up
     JOIN parcelas p ON p.id = up.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     WHERE up.usuario_id = ?`,
    [req.params.usuarioId]
  );
  res.json(rows);
});

// Reemplaza el conjunto de parcelas asignadas a un usuario
app.put("/api/asignaciones/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  const parcelaIds = Array.isArray(req.body.parcela_ids) ? req.body.parcela_ids : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM usuario_parcelas WHERE usuario_id = ?", [usuarioId]);
    if (parcelaIds.length > 0) {
      const valores = parcelaIds.map((parcelaId) => [usuarioId, parcelaId]);
      await conn.query("INSERT INTO usuario_parcelas (usuario_id, parcela_id) VALUES ?", [valores]);
    }
    await conn.commit();
    res.json({ usuario_id: Number(usuarioId), parcela_ids: parcelaIds.map(Number) });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al asignar parcelas" });
  } finally {
    conn.release();
  }
});

// --- Estaciones/Sensores ---
app.get("/api/parcelas/:parcelaId/estaciones", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, codigo, parcela_id, creado_en FROM estaciones WHERE parcela_id = ?",
    [req.params.parcelaId]
  );
  res.json(rows);
});

// --- Vinculación de sensores por token (RF-06) ---
// El panel genera un token de un solo uso para una parcela; el propio sensor
// físico lo consume para darse de alta y recibe a cambio una api_key que
// deberá enviar en cada lectura (ver lecturas-service). El token nunca
// llega a manos de terceros por fuera del panel, y la api_key solo se
// muestra una vez, igual que un password: en la base solo guardamos su hash.

app.post("/api/sensores/tokens", async (req, res) => {
  const { parcela_id } = req.body;
  if (!parcela_id) return res.status(400).json({ error: "Falta parcela_id" });

  const token = crypto.randomBytes(16).toString("hex");
  const expiraEn = new Date(Date.now() + TOKEN_TTL_MINUTOS * 60 * 1000);

  try {
    const [result] = await pool.query(
      "INSERT INTO sensor_tokens (token, parcela_id, expira_en) VALUES (?, ?, ?)",
      [token, parcela_id, expiraEn]
    );
    res.status(201).json({ id: result.insertId, token, parcela_id, expira_en: expiraEn });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar el token" });
  }
});

app.get("/api/sensores/tokens", async (req, res) => {
  await pool.query(
    "UPDATE sensor_tokens SET estado = 'expirado' WHERE estado = 'pendiente' AND expira_en < NOW()"
  );
  const [rows] = await pool.query(
    `SELECT st.id, st.token, st.estado, st.creado_en, st.expira_en, st.usado_en,
            p.nombre AS parcela_nombre, f.nombre AS finca_nombre
     FROM sensor_tokens st
     JOIN parcelas p ON p.id = st.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     ORDER BY st.creado_en DESC
     LIMIT 50`
  );
  res.json(rows);
});

app.delete("/api/sensores/tokens/:id", async (req, res) => {
  const [result] = await pool.query(
    "UPDATE sensor_tokens SET estado = 'expirado' WHERE id = ? AND estado = 'pendiente'",
    [req.params.id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "Token no encontrado o ya no está pendiente" });
  }
  res.json({ ok: true });
});

// El sensor físico consume el token para vincularse y obtener su api_key
app.post("/api/estaciones/vincular", async (req, res) => {
  const { token, codigo } = req.body;
  if (!token || !codigo) return res.status(400).json({ error: "Faltan token o codigo" });

  const [tokens] = await pool.query(
    "SELECT * FROM sensor_tokens WHERE token = ? AND estado = 'pendiente' AND expira_en > NOW()",
    [token]
  );
  if (tokens.length === 0) {
    return res.status(400).json({ error: "Token inválido, expirado o ya utilizado" });
  }
  const tokenRow = tokens[0];

  const apiKey = crypto.randomBytes(24).toString("hex");
  try {
    const [result] = await pool.query(
      "INSERT INTO estaciones (codigo, parcela_id, api_key_hash) VALUES (?, ?, ?)",
      [codigo, tokenRow.parcela_id, hash(apiKey)]
    );
    await pool.query(
      "UPDATE sensor_tokens SET estado = 'usado', usado_en = NOW(), estacion_id = ? WHERE id = ?",
      [result.insertId, tokenRow.id]
    );
    res.status(201).json({
      estacion_id: result.insertId,
      codigo,
      parcela_id: tokenRow.parcela_id,
      api_key: apiKey,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya existe una estación con ese código" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al vincular la estación" });
  }
});

// Renombrar una estación (el código visible del sensor)
app.put("/api/estaciones/:id", async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: "Falta codigo" });
  try {
    const [result] = await pool.query("UPDATE estaciones SET codigo = ? WHERE id = ?", [
      codigo,
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Estación no encontrada" });
    res.json({ id: Number(req.params.id), codigo });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya existe una estación con ese código" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al editar la estación" });
  }
});

// Elimina una estación junto con su historial de lecturas/alertas
app.delete("/api/estaciones/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE sensor_tokens SET estacion_id = NULL WHERE estacion_id = ?", [req.params.id]);
    await conn.query("DELETE FROM alertas WHERE estacion_id = ?", [req.params.id]);
    await conn.query("DELETE FROM lecturas WHERE estacion_id = ?", [req.params.id]);
    const [result] = await conn.query("DELETE FROM estaciones WHERE id = ?", [req.params.id]);
    await conn.commit();
    if (result.affectedRows === 0) return res.status(404).json({ error: "Estación no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la estación" });
  } finally {
    conn.release();
  }
});

// --- Sensores (vista plana de estaciones con su última lectura) ---
app.get("/api/estaciones", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT e.id, e.codigo, e.parcela_id, p.nombre AS parcela_nombre, f.nombre AS finca_nombre,
            ult.humedad_suelo, ult.temperatura, ult.humedad_ambiental, ult.fecha AS ultima_lectura
     FROM estaciones e
     JOIN parcelas p ON p.id = e.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     LEFT JOIN (
       SELECT l.*, ROW_NUMBER() OVER (PARTITION BY estacion_id ORDER BY fecha DESC) AS rn
       FROM lecturas l
     ) ult ON ult.estacion_id = e.id AND ult.rn = 1
     ORDER BY e.id`
  );
  res.json(rows);
});

// --- Dashboard: resumen general ---
app.get("/api/dashboard/resumen", async (req, res) => {
  const [[resumen]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM estaciones) AS estaciones_activas,
       (SELECT COUNT(*) FROM alertas WHERE DATE(fecha) = CURDATE()) AS alertas_hoy,
       (SELECT ROUND(AVG(humedad_suelo)) FROM lecturas WHERE fecha >= NOW() - INTERVAL 1 DAY) AS humedad_promedio,
       (SELECT ROUND(AVG(temperatura)) FROM lecturas WHERE fecha >= NOW() - INTERVAL 1 DAY) AS temperatura_promedio`
  );
  res.json(resumen);
});

// --- Dashboard: humedad promedio por finca en los últimos N días (para la gráfica) ---
app.get("/api/dashboard/humedad-historial", async (req, res) => {
  const dias = Number(req.query.dias) || 7;
  const [rows] = await pool.query(
    `SELECT f.nombre AS finca, r.dia, ROUND(AVG(r.humedad_promedio)) AS humedad
     FROM reportes_diarios r
     JOIN parcelas p ON p.id = r.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     WHERE r.dia >= CURDATE() - INTERVAL ? DAY
     GROUP BY f.nombre, r.dia
     ORDER BY r.dia ASC`,
    [dias]
  );
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`fincas-service escuchando en puerto ${PORT}`);
});
