require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const pool = require("./db");
const {
  idPositivo,
  veTodo,
  filtroParcelas,
  filtroFincas,
  aplicarFiltro,
  puedeGestionarParcela,
  puedeVerFinca,
  puedeAdministrarFinca,
} = require("./permisos");
const { verificarJWTOServicio, soloAdmin } = require("./verificarJWT");
const riego = require("./riego");

const TOKEN_TTL_MINUTOS = 30;
const hash = (valor) => crypto.createHash("sha256").update(valor).digest("hex");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "fincas-service" });
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

// --- De aquí en adelante: JWT de usuario o X-Service-Token (simulador) ---
// Los permisos por rol salen de req.usuario (ver permisos.js).
app.use(verificarJWTOServicio);

const prohibido = (res, mensaje = "No tienes esta parcela asignada") => res.status(403).json({ error: mensaje });

// --- Fincas ---
app.get("/api/fincas", async (req, res) => {
  const filtro = filtroFincas(req.usuario, "id") || { sql: "TRUE", params: [] };
  const [rows] = await pool.query(`SELECT * FROM fincas WHERE ${filtro.sql}`, filtro.params);
  res.json(rows);
});

// Agricultor y agrónomo crean fincas siempre a su nombre; el admin (o el simulador) elige el dueño
app.post("/api/fincas", async (req, res) => {
  const { nombre, ubicacion } = req.body;
  if (!veTodo(req.usuario) && !["agricultor", "agronomo"].includes(req.usuario.rol)) {
    return prohibido(res, "Tu rol no puede crear fincas");
  }
  const usuario_id = veTodo(req.usuario) ? req.body.usuario_id ?? null : req.usuario.id;
  const [result] = await pool.query(
    "INSERT INTO fincas (nombre, ubicacion, usuario_id) VALUES (?, ?, ?)",
    [nombre, ubicacion, usuario_id]
  );
  res.status(201).json({ id: result.insertId, nombre, ubicacion, usuario_id });
});

app.put("/api/fincas/:id", async (req, res) => {
  const { nombre, ubicacion } = req.body;
  if (!(await puedeAdministrarFinca(req.usuario, req.params.id))) return prohibido(res, "Esta finca no es tuya");
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
  if (!(await puedeAdministrarFinca(req.usuario, req.params.id))) return prohibido(res, "Esta finca no es tuya");
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
  if (p.temperatura_actual !== null && p.temperatura_min !== null && Number(p.temperatura_actual) < Number(p.temperatura_min)) {
    return "Riesgo de helada";
  }
  return "Óptimo";
}

// --- Parcelas ---
// Incluye la última lectura recibida (humedad/temperatura) y el estado calculado (RF-09)
app.get("/api/fincas/:fincaId/parcelas", async (req, res) => {
  if (!(await puedeVerFinca(req.usuario, req.params.fincaId))) return prohibido(res, "No tienes acceso a esta finca");
  // en una finca ajena, quien solo tiene parcelas asignadas ve únicamente esas
  const filtro = filtroParcelas(req.usuario, "p.id") || { sql: "TRUE", params: [] };
  const [rows] = await pool.query(
    `SELECT p.*, ult.humedad_suelo AS humedad_actual, ult.temperatura AS temperatura_actual
     FROM parcelas p
     LEFT JOIN (
       SELECT e.parcela_id, l.humedad_suelo, l.temperatura,
              ROW_NUMBER() OVER (PARTITION BY e.parcela_id ORDER BY l.fecha DESC) AS rn
       FROM estaciones e
       JOIN lecturas l ON l.estacion_id = e.id
     ) ult ON ult.parcela_id = p.id AND ult.rn = 1
     WHERE p.finca_id = ? AND ${filtro.sql}`,
    [req.params.fincaId, ...filtro.params]
  );
  res.json(rows.map((p) => ({ ...p, estado: calcularEstado(p) })));
});

// temperatura_min (heladas) es opcional: si no llega o viene vacía, al crear
// se usa 5 °C y al editar se conserva la que tenía (la app móvil todavía no
// la envía y no debe borrarla).
const temperaturaMin = (valor) => (valor === undefined || valor === null || valor === "" ? null : Number(valor));

app.post("/api/parcelas", async (req, res) => {
  const { nombre, finca_id, humedad_min, humedad_max, temperatura_max } = req.body;
  if (!(await puedeAdministrarFinca(req.usuario, finca_id))) return prohibido(res, "Esta finca no es tuya");
  const tMin = temperaturaMin(req.body.temperatura_min);
  const [result] = await pool.query(
    `INSERT INTO parcelas (nombre, finca_id, humedad_min, humedad_max, temperatura_max, temperatura_min)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nombre, finca_id, humedad_min, humedad_max, temperatura_max, Number.isFinite(tMin) ? tMin : 5]
  );
  res.status(201).json({ id: result.insertId, nombre, finca_id });
});

app.put("/api/parcelas/:id", async (req, res) => {
  const { nombre, humedad_min, humedad_max, temperatura_max } = req.body;
  if (!(await puedeGestionarParcela(req.usuario, req.params.id))) return prohibido(res);
  const tMin = temperaturaMin(req.body.temperatura_min);
  const [result] = await pool.query(
    `UPDATE parcelas SET nombre = ?, humedad_min = ?, humedad_max = ?, temperatura_max = ?,
            temperatura_min = COALESCE(?, temperatura_min)
     WHERE id = ?`,
    [nombre, humedad_min, humedad_max, temperatura_max, Number.isFinite(tMin) ? tMin : null, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: "Parcela no encontrada" });
  res.json({ id: Number(req.params.id), nombre, humedad_min, humedad_max, temperatura_max });
});

// Elimina una parcela: se bloquea si todavía tiene sensores vinculados,
// para no perder en silencio el historial de lecturas que dependen de ellos.
app.delete("/api/parcelas/:id", async (req, res) => {
  const [[parcela]] = await pool.query("SELECT finca_id FROM parcelas WHERE id = ?", [req.params.id]);
  if (!parcela) return res.status(404).json({ error: "Parcela no encontrada" });
  if (!(await puedeAdministrarFinca(req.usuario, parcela.finca_id))) return prohibido(res, "Esta finca no es tuya");
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
  const filtro = filtroParcelas(req.usuario, "p.id") || { sql: "TRUE", params: [] };
  const [rows] = await pool.query(
    `SELECT p.id, p.nombre, p.finca_id, f.nombre AS finca_nombre, p.riego_automatico
     FROM parcelas p
     JOIN fincas f ON f.id = p.finca_id
     WHERE ${filtro.sql}
     ORDER BY f.nombre, p.nombre`,
    filtro.params
  );
  res.json(rows);
});

// Parcelas asignadas a un usuario (rol agrónomo): mismo detalle que el
// listado por finca (última lectura + estado calculado), pero cruzando
// primero por sus asignaciones en usuario_parcelas en vez de por finca_id.
// Es lo que le da al agrónomo acceso solo a lo que el admin le asignó.
app.get("/api/usuarios/:usuarioId/parcelas", async (req, res) => {
  if (!veTodo(req.usuario) && String(req.usuario.id) !== String(req.params.usuarioId)) {
    return prohibido(res, "Solo puedes ver tus propias parcelas asignadas");
  }
  const [rows] = await pool.query(
    `SELECT p.*, f.nombre AS finca_nombre,
            ult.humedad_suelo AS humedad_actual, ult.temperatura AS temperatura_actual
     FROM usuario_parcelas up
     JOIN parcelas p ON p.id = up.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     LEFT JOIN (
       SELECT e.parcela_id, l.humedad_suelo, l.temperatura,
              ROW_NUMBER() OVER (PARTITION BY e.parcela_id ORDER BY l.fecha DESC) AS rn
       FROM estaciones e
       JOIN lecturas l ON l.estacion_id = e.id
     ) ult ON ult.parcela_id = p.id AND ult.rn = 1
     WHERE up.usuario_id = ?
     ORDER BY f.nombre, p.nombre`,
    [req.params.usuarioId]
  );
  res.json(rows.map((p) => ({ ...p, estado: calcularEstado(p) })));
});

// --- Asignación de parcelas a usuarios (RF-08) ---
app.get("/api/asignaciones", soloAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT up.usuario_id, up.parcela_id, p.nombre AS parcela_nombre, f.nombre AS finca_nombre
     FROM usuario_parcelas up
     JOIN parcelas p ON p.id = up.parcela_id
     JOIN fincas f ON f.id = p.finca_id`
  );
  res.json(rows);
});

app.get("/api/asignaciones/:usuarioId", async (req, res) => {
  if (!veTodo(req.usuario) && String(req.usuario.id) !== String(req.params.usuarioId)) {
    return prohibido(res, "Solo puedes ver tus propias asignaciones");
  }
  const [rows] = await pool.query(
    `SELECT up.usuario_id, up.parcela_id, p.nombre AS parcela_nombre, f.nombre AS finca_nombre
     FROM usuario_parcelas up
     JOIN parcelas p ON p.id = up.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     WHERE up.usuario_id = ?`,
    [req.params.usuarioId]
  );
  res.json(rows);
});

// Reemplaza el conjunto de parcelas asignadas a un usuario
// El admin asigna lo que quiera; un usuario solo puede tocar las suyas y
// únicamente agregarse parcelas de fincas propias (la app auto-asigna al
// agrónomo la parcela que acaba de registrar).
app.put("/api/asignaciones/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  const parcelaIds = Array.isArray(req.body.parcela_ids) ? req.body.parcela_ids : [];
  if (!veTodo(req.usuario)) {
    if (String(req.usuario.id) !== String(usuarioId)) return prohibido(res, "Solo el admin asigna parcelas a otros usuarios");
    const [actuales] = await pool.query("SELECT parcela_id FROM usuario_parcelas WHERE usuario_id = ?", [usuarioId]);
    const nuevas = parcelaIds.map(Number).filter((id) => !actuales.some((a) => a.parcela_id === id));
    if (nuevas.length > 0) {
      const [propias] = await pool.query(
        "SELECT p.id FROM parcelas p JOIN fincas f ON f.id = p.finca_id WHERE f.usuario_id = ? AND p.id IN (?)",
        [req.usuario.id, nuevas]
      );
      if (propias.length !== new Set(nuevas).size) {
        return prohibido(res, "Solo puedes asignarte parcelas de tus propias fincas");
      }
    }
  }

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
  if (!(await puedeGestionarParcela(req.usuario, req.params.parcelaId))) return prohibido(res);
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

// Genera/revoca tokens el admin o quien gestiona la parcela (la app deja al agrónomo vincular sensores)
app.post("/api/sensores/tokens", async (req, res) => {
  const { parcela_id } = req.body;
  if (!parcela_id) return res.status(400).json({ error: "Falta parcela_id" });
  if (!(await puedeGestionarParcela(req.usuario, parcela_id))) return prohibido(res);

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
  // cada quien ve los de sus parcelas
  const filtro = filtroParcelas(req.usuario, "st.parcela_id") || { sql: "TRUE", params: [] };
  const [rows] = await pool.query(
    `SELECT st.id, st.token, st.estado, st.creado_en, st.expira_en, st.usado_en,
            p.nombre AS parcela_nombre, f.nombre AS finca_nombre
     FROM sensor_tokens st
     JOIN parcelas p ON p.id = st.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     WHERE ${filtro.sql}
     ORDER BY st.creado_en DESC
     LIMIT 50`,
    filtro.params
  );
  res.json(rows);
});

app.delete("/api/sensores/tokens/:id", async (req, res) => {
  const [[token]] = await pool.query("SELECT parcela_id FROM sensor_tokens WHERE id = ?", [req.params.id]);
  if (token && !(await puedeGestionarParcela(req.usuario, token.parcela_id))) return prohibido(res);
  const [result] = await pool.query(
    "UPDATE sensor_tokens SET estado = 'expirado' WHERE id = ? AND estado = 'pendiente'",
    [req.params.id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "Token no encontrado o ya no está pendiente" });
  }
  res.json({ ok: true });
});

// Renombrar una estación (el código visible del sensor)
app.put("/api/estaciones/:id", soloAdmin, async (req, res) => {
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
app.delete("/api/estaciones/:id", soloAdmin, async (req, res) => {
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
  const filtro = filtroParcelas(req.usuario, "e.parcela_id") || { sql: "TRUE", params: [] };
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
     WHERE ${filtro.sql}
     ORDER BY e.id`,
    filtro.params
  );
  res.json(rows);
});

// --- Inventario de cultivos ---
// Permisos: ver permisos.js (cada rol opera solo las parcelas que le tocan).

const UNIDADES_CULTIVO = ["plantas", "kg", "quintales"];
const ESTADOS_CULTIVO = ["sembrado", "en_crecimiento", "cosechado"];

// Las fechas se devuelven como texto YYYY-MM-DD: un DATE convertido a Date
// de JS llega como medianoche UTC y en el navegador/celular (UTC-6) se
// mostraría como el día anterior.
const SELECT_CULTIVOS = `
  SELECT c.id, c.parcela_id, p.nombre AS parcela_nombre, p.finca_id, f.nombre AS finca_nombre,
         c.tipo, c.variedad,
         DATE_FORMAT(c.fecha_siembra, '%Y-%m-%d') AS fecha_siembra,
         DATE_FORMAT(c.fecha_cosecha_estimada, '%Y-%m-%d') AS fecha_cosecha_estimada,
         c.cantidad, c.unidad, c.estado, c.notas, c.creado_en
  FROM cultivos c
  JOIN parcelas p ON p.id = c.parcela_id
  JOIN fincas f ON f.id = p.finca_id`;

function fechaValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

// Devuelve { error } o { datos } con los campos ya normalizados
function validarCultivo(body) {
  const texto = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const datos = {
    parcela_id: idPositivo(body.parcela_id),
    tipo: texto(body.tipo),
    variedad: texto(body.variedad) || null,
    fecha_siembra: texto(body.fecha_siembra),
    fecha_cosecha_estimada: texto(body.fecha_cosecha_estimada) || null,
    cantidad: Number(body.cantidad),
    unidad: texto(body.unidad) || "plantas",
    estado: texto(body.estado) || "sembrado",
    notas: texto(body.notas) || null,
  };

  if (!datos.parcela_id) return { error: "Selecciona una parcela" };
  if (!datos.tipo) return { error: "El tipo de cultivo es obligatorio" };
  if (datos.tipo.length > 100) return { error: "El tipo no puede superar 100 caracteres" };
  if (datos.variedad && datos.variedad.length > 100) return { error: "La variedad no puede superar 100 caracteres" };
  if (!fechaValida(datos.fecha_siembra)) return { error: "La fecha de siembra es obligatoria y debe ser válida" };
  if (datos.fecha_cosecha_estimada) {
    if (!fechaValida(datos.fecha_cosecha_estimada)) return { error: "La fecha de cosecha estimada no es válida" };
    if (datos.fecha_cosecha_estimada < datos.fecha_siembra) {
      return { error: "La fecha de cosecha estimada no puede ser anterior a la de siembra" };
    }
  }
  if (texto(body.cantidad) === "" || !Number.isFinite(datos.cantidad) || datos.cantidad <= 0) {
    return { error: "La cantidad es obligatoria y debe ser mayor que 0" };
  }
  if (datos.cantidad >= 1e8) return { error: "La cantidad es demasiado grande" };
  if (!UNIDADES_CULTIVO.includes(datos.unidad)) return { error: `Unidad inválida (usa: ${UNIDADES_CULTIVO.join(", ")})` };
  if (!ESTADOS_CULTIVO.includes(datos.estado)) return { error: `Estado inválido (usa: ${ESTADOS_CULTIVO.join(", ")})` };
  return { datos };
}

// Listado con filtros opcionales: finca_id, parcela_id, estado (siempre dentro de las parcelas del usuario)
app.get("/api/cultivos", async (req, res) => {
  try {
    const condiciones = [];
    const params = [];
    const fincaId = idPositivo(req.query.finca_id);
    const parcelaId = idPositivo(req.query.parcela_id);
    if (fincaId) {
      condiciones.push("p.finca_id = ?");
      params.push(fincaId);
    }
    if (parcelaId) {
      condiciones.push("c.parcela_id = ?");
      params.push(parcelaId);
    }
    if (ESTADOS_CULTIVO.includes(req.query.estado)) {
      condiciones.push("c.estado = ?");
      params.push(req.query.estado);
    }
    aplicarFiltro(filtroParcelas(req.usuario, "c.parcela_id"), condiciones, params);
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `${SELECT_CULTIVOS} ${where} ORDER BY f.nombre, p.nombre, c.fecha_siembra DESC, c.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los cultivos" });
  }
});

app.get("/api/parcelas/:parcelaId/cultivos", async (req, res) => {
  try {
    const parcelaId = idPositivo(req.params.parcelaId);
    if (!parcelaId) return res.status(400).json({ error: "Parcela inválida" });
    if (!(await puedeGestionarParcela(req.usuario, parcelaId))) return prohibido(res);
    const [rows] = await pool.query(
      `${SELECT_CULTIVOS} WHERE c.parcela_id = ? ORDER BY c.fecha_siembra DESC, c.id DESC`,
      [parcelaId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los cultivos" });
  }
});

app.post("/api/cultivos", async (req, res) => {
  const { error, datos } = validarCultivo(req.body);
  if (error) return res.status(400).json({ error });
  try {
    if (!(await puedeGestionarParcela(req.usuario, datos.parcela_id))) return prohibido(res);
    const [result] = await pool.query(
      `INSERT INTO cultivos (parcela_id, tipo, variedad, fecha_siembra, fecha_cosecha_estimada, cantidad, unidad, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.parcela_id, datos.tipo, datos.variedad, datos.fecha_siembra, datos.fecha_cosecha_estimada,
       datos.cantidad, datos.unidad, datos.estado, datos.notas]
    );
    res.status(201).json({ id: result.insertId, ...datos });
  } catch (err) {
    if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "La parcela no existe" });
    console.error(err);
    res.status(500).json({ error: "Error al crear el cultivo" });
  }
});

app.put("/api/cultivos/:id", async (req, res) => {
  const { error, datos } = validarCultivo(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const [actual] = await pool.query("SELECT parcela_id FROM cultivos WHERE id = ?", [req.params.id]);
    if (actual.length === 0) return res.status(404).json({ error: "Cultivo no encontrado" });

    // Si se mueve de parcela, hace falta permiso sobre la de origen y la de destino
    const permitido =
      (await puedeGestionarParcela(req.usuario, actual[0].parcela_id)) &&
      (await puedeGestionarParcela(req.usuario, datos.parcela_id));
    if (!permitido) return prohibido(res);

    await pool.query(
      `UPDATE cultivos SET parcela_id = ?, tipo = ?, variedad = ?, fecha_siembra = ?, fecha_cosecha_estimada = ?,
              cantidad = ?, unidad = ?, estado = ?, notas = ?
       WHERE id = ?`,
      [datos.parcela_id, datos.tipo, datos.variedad, datos.fecha_siembra, datos.fecha_cosecha_estimada,
       datos.cantidad, datos.unidad, datos.estado, datos.notas, req.params.id]
    );
    res.json({ id: Number(req.params.id), ...datos });
  } catch (err) {
    if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "La parcela no existe" });
    console.error(err);
    res.status(500).json({ error: "Error al editar el cultivo" });
  }
});

app.delete("/api/cultivos/:id", async (req, res) => {
  try {
    const [actual] = await pool.query("SELECT parcela_id FROM cultivos WHERE id = ?", [req.params.id]);
    if (actual.length === 0) return res.status(404).json({ error: "Cultivo no encontrado" });
    if (!(await puedeGestionarParcela(req.usuario, actual[0].parcela_id))) return prohibido(res);
    await pool.query("DELETE FROM cultivos WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el cultivo" });
  }
});

// --- Riego: programaciones, riego manual/automático, bitácora y motor ---
riego.registrarRutas(app);

// --- Dashboard: resumen general ---
// Todo se limita a las parcelas que el usuario puede ver (el admin ve todo).
app.get("/api/dashboard/resumen", async (req, res) => {
  const filtro = (columna) => filtroParcelas(req.usuario, columna) || { sql: "TRUE", params: [] };
  const [est, ale, lec, cul, rie] = ["e.parcela_id", "a.parcela_id", "e.parcela_id", "c.parcela_id", "r.parcela_id"].map(filtro);
  const [[resumen]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM estaciones e WHERE ${est.sql}) AS estaciones_activas,
       (SELECT COUNT(*) FROM alertas a WHERE DATE(a.fecha) = CURDATE() AND ${ale.sql}) AS alertas_hoy,
       (SELECT ROUND(AVG(l.humedad_suelo)) FROM lecturas l JOIN estaciones e ON e.id = l.estacion_id
         WHERE l.fecha >= NOW() - INTERVAL 1 DAY AND ${lec.sql}) AS humedad_promedio,
       (SELECT ROUND(AVG(l.temperatura)) FROM lecturas l JOIN estaciones e ON e.id = l.estacion_id
         WHERE l.fecha >= NOW() - INTERVAL 1 DAY AND ${lec.sql}) AS temperatura_promedio,
       (SELECT COUNT(*) FROM cultivos c WHERE c.estado <> 'cosechado' AND ${cul.sql}) AS cultivos_activos,
       (SELECT COUNT(*) FROM riego_eventos r WHERE r.estado = 'en_curso' AND ${rie.sql}) AS riegos_en_curso`,
    [...est.params, ...ale.params, ...lec.params, ...lec.params, ...cul.params, ...rie.params]
  );
  res.json(resumen);
});

// --- Dashboard: humedad promedio por finca en los últimos N días (para la gráfica) ---
app.get("/api/dashboard/humedad-historial", async (req, res) => {
  const dias = Number(req.query.dias) || 7;
  const filtro = filtroParcelas(req.usuario, "p.id") || { sql: "TRUE", params: [] };
  const [rows] = await pool.query(
    `SELECT f.nombre AS finca, r.dia, ROUND(AVG(r.humedad_promedio)) AS humedad
     FROM reportes_diarios r
     JOIN parcelas p ON p.id = r.parcela_id
     JOIN fincas f ON f.id = p.finca_id
     WHERE r.dia >= CURDATE() - INTERVAL ? DAY AND ${filtro.sql}
     GROUP BY f.nombre, r.dia
     ORDER BY r.dia ASC`,
    [dias, ...filtro.params]
  );
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`fincas-service escuchando en puerto ${PORT}`);
  riego.iniciarMotor();
});
