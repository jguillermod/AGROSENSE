require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const pool = require("./db");
const alertas = require("./alertas");
const clima = require("./clima");
const { verificarJWT } = require("./verificarJWT");
const { idPositivo, filtroParcelas, puedeGestionarParcela } = require("./permisos");

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

    // Alertas de sensor de la parcela (RF-09): una vigente por tipo, que se
    // actualiza mientras siga fuera de rango y se resuelve al volver (alertas.js)
    const { nuevas, vigentes } = await alertas.evaluarLectura(estacion_id);
    const alerta = nuevas[0] || null;

    res.status(201).json({ id: result.insertId, alerta, alertas_vigentes: vigentes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al guardar la lectura" });
  }
});

// --- De aquí en adelante (consultas de lecturas, alertas y clima) se exige JWT ---
// La ingesta de arriba sigue usando solo la api_key de la estación.
app.use(verificarJWT);

const prohibido = (res) => res.status(403).json({ error: "No tienes esta parcela asignada" });

// --- Lecturas en vivo (panel web) ---
// Filtros opcionales comunes: parcela_id o finca_id, siempre dentro de las
// parcelas que el usuario puede ver (permisos.js). Se ordena por id
// (orden de inserción) en vez de por fecha para usar la clave primaria y
// no ordenar toda la tabla en cada consulta.
function filtroUbicacion(query, usuario) {
  const condiciones = [];
  const params = [];
  const permiso = filtroParcelas(usuario, "p.id");
  if (permiso) {
    condiciones.push(permiso.sql);
    params.push(...permiso.params);
  }
  const parcelaId = Number(query.parcela_id);
  const fincaId = Number(query.finca_id);
  if (Number.isInteger(parcelaId) && parcelaId > 0) {
    condiciones.push("p.id = ?");
    params.push(parcelaId);
  }
  if (Number.isInteger(fincaId) && fincaId > 0) {
    condiciones.push("p.finca_id = ?");
    params.push(fincaId);
  }
  return { where: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "", params };
}

const limite = (valor, porDefecto, maximo) => Math.min(maximo, Math.max(1, Number(valor) || porDefecto));

// Últimas lecturas con su estación, parcela, finca y los umbrales de la
// parcela (para colorear cada valor en el cliente).
app.get("/api/lecturas/recientes", async (req, res) => {
  try {
    const { where, params } = filtroUbicacion(req.query, req.usuario);
    const [rows] = await pool.query(
      `SELECT l.id, l.estacion_id, e.codigo AS estacion_codigo,
              p.id AS parcela_id, p.nombre AS parcela_nombre,
              f.id AS finca_id, f.nombre AS finca_nombre,
              l.humedad_suelo, l.temperatura, l.humedad_ambiental, l.fecha,
              p.humedad_min, p.humedad_max, p.temperatura_max
       FROM lecturas l
       JOIN estaciones e ON e.id = l.estacion_id
       JOIN parcelas p ON p.id = e.parcela_id
       JOIN fincas f ON f.id = p.finca_id
       ${where}
       ORDER BY l.id DESC
       LIMIT ?`,
      [...params, limite(req.query.limit, 50, 500)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las lecturas recientes" });
  }
});

// Exportación (CSV desde el panel): filtros parcela_id / finca_id y rango
// desde / hasta (YYYY-MM-DD, inclusive). Hasta EXPORT_MAX filas, de la más
// vieja a la más nueva; si se alcanza el límite la respuesta lo indica en la
// cabecera X-Export-Truncado para que el panel lo avise.
const EXPORT_MAX = 100000;
app.get("/api/lecturas/exportar", async (req, res) => {
  try {
    const { where, params } = filtroUbicacion(req.query, req.usuario);
    const condiciones = where ? [where.replace(/^WHERE /, "")] : [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "")) {
      condiciones.push("l.fecha >= ?");
      params.push(`${req.query.desde} 00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || "")) {
      condiciones.push("l.fecha < ? + INTERVAL 1 DAY");
      params.push(`${req.query.hasta} 00:00:00`);
    }
    const limiteFilas = limite(req.query.limit, 50000, EXPORT_MAX);
    const [rows] = await pool.query(
      `SELECT l.id, l.fecha, f.nombre AS finca_nombre, p.nombre AS parcela_nombre, e.codigo AS estacion_codigo,
              l.humedad_suelo, l.temperatura, l.humedad_ambiental
       FROM lecturas l
       JOIN estaciones e ON e.id = l.estacion_id
       JOIN parcelas p ON p.id = e.parcela_id
       JOIN fincas f ON f.id = p.finca_id
       ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
       ORDER BY l.id
       LIMIT ?`,
      [...params, limiteFilas]
    );
    if (rows.length === limiteFilas) res.set("X-Export-Truncado", String(limiteFilas));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al exportar las lecturas" });
  }
});

// Historial de lecturas por estación (RF-05)
app.get("/api/estaciones/:estacionId/lecturas", async (req, res) => {
  const [[estacion]] = await pool.query("SELECT parcela_id FROM estaciones WHERE id = ?", [req.params.estacionId]);
  if (!estacion) return res.status(404).json({ error: "Estación no encontrada" });
  if (!(await puedeGestionarParcela(req.usuario, estacion.parcela_id))) return prohibido(res);
  const [rows] = await pool.query(
    "SELECT * FROM lecturas WHERE estacion_id = ? ORDER BY fecha DESC LIMIT 200",
    [req.params.estacionId]
  );
  res.json(rows);
});

// --- Registros manuales de campo (humedad/temperatura a ojo + anotaciones) ---
// Puede registrar quien puede gestionar la parcela (permisos.js); el autor es
// siempre el usuario del JWT, no un usuario_id que mande el cliente.
app.get("/api/parcelas/:parcelaId/registros", async (req, res) => {
  if (!(await puedeGestionarParcela(req.usuario, idPositivo(req.params.parcelaId)))) return prohibido(res);
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
  const usuario_id = req.usuario.id;
  const { humedad_suelo, temperatura, anotaciones } = req.body;

  const sinValores = humedad_suelo === undefined && temperatura === undefined;
  const sinAnotacion = !anotaciones || !String(anotaciones).trim();
  if (sinValores && sinAnotacion) {
    return res.status(400).json({ error: "Registra al menos un valor o una anotación" });
  }

  try {
    if (!(await puedeGestionarParcela(req.usuario, parcelaId))) return prohibido(res);

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

// --- Alertas (sensor y climáticas) y clima ---
alertas.registrarRutas(app);
clima.registrarRutas(app);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`lecturas-service escuchando en puerto ${PORT}`);
  clima.iniciar();
});
