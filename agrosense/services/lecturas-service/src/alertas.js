// Ciclo de vida de las alertas (sensor y climáticas) y sus endpoints.
//
// Regla: una sola alerta vigente (activa o atendida) por (parcela, tipo).
// Mientras la condición sigue, se actualiza (repeticiones, último valor y
// hora); cuando termina, se marca resuelta. La base lo garantiza con el
// índice único sobre la columna generada clave_vigente, así que dos
// lecturas simultáneas de la misma parcela no pueden duplicarla.
//
// Viven aquí (y no en fincas-service) porque este servicio es el único que
// crea y resuelve alertas, y ya era dueño de sus endpoints de lectura: todo
// el ciclo de vida queda en un solo lugar.

const pool = require("./db");
const { idPositivo, filtroParcelas, aplicarFiltro, puedeGestionarParcela } = require("./permisos");

const CATEGORIAS = ["sensor", "climatica"];
const SEVERIDADES = ["info", "media", "alta"];
const ESTADOS = ["activa", "atendida", "resuelta"];

// Tipos de alerta de sensor (por parcela, a partir de las lecturas)
const SENSOR = {
  riego: "Necesita riego",
  exceso: "Riesgo de exceso de humedad",
  calor: "Riesgo de estrés hídrico por calor",
  helada: "Riesgo de helada",
};

const redondear = (v) => Math.round(Number(v) * 10) / 10;

// Permisos: permisos.js (los mismos que en fincas-service), con el usuario del JWT.

// --- Abrir / actualizar / resolver ---

// Devuelve true si la alerta es nueva, false si ya estaba vigente y solo se actualizó
async function abrirOActualizar({ parcelaId, estacionId = null, tipo, categoria, severidad, detalle, valor = null }) {
  const [result] = await pool.query(
    `INSERT INTO alertas (parcela_id, estacion_id, tipo, categoria, severidad, estado, detalle, ultimo_valor, ultima_lectura_en, fecha)
     VALUES (?, ?, ?, ?, ?, 'activa', ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       repeticiones = repeticiones + 1,
       estacion_id = VALUES(estacion_id),
       severidad = VALUES(severidad),
       detalle = VALUES(detalle),
       ultimo_valor = VALUES(ultimo_valor),
       ultima_lectura_en = NOW()`,
    [parcelaId, estacionId, tipo, categoria, severidad, detalle, valor]
  );
  return result.affectedRows === 1;
}

async function resolver(parcelaId, tipo) {
  const [result] = await pool.query(
    `UPDATE alertas SET estado = 'resuelta', resuelta_en = NOW()
     WHERE parcela_id = ? AND tipo = ? AND estado IN ('activa', 'atendida')`,
    [parcelaId, tipo]
  );
  return result.affectedRows;
}

// Evalúa las alertas de sensor de la parcela de una estación con el promedio
// de la última lectura reciente de cada una de sus estaciones (así una
// estación algo distinta no hace parpadear la alerta).
async function evaluarLectura(estacionId) {
  const [filas] = await pool.query(
    `SELECT p.id, MAX(p.humedad_min) AS humedad_min, MAX(p.humedad_max) AS humedad_max,
            MAX(p.temperatura_max) AS temperatura_max, MAX(p.temperatura_min) AS temperatura_min,
            AVG(l.humedad_suelo) AS humedad, AVG(l.temperatura) AS temperatura
     FROM parcelas p
     JOIN estaciones e ON e.parcela_id = p.id
     JOIN lecturas l ON l.id = (SELECT id FROM lecturas WHERE estacion_id = e.id ORDER BY fecha DESC, id DESC LIMIT 1)
     WHERE p.id = (SELECT parcela_id FROM estaciones WHERE id = ?)
       AND l.fecha >= NOW() - INTERVAL 10 MINUTE
     GROUP BY p.id`,
    [estacionId]
  );
  if (filas.length === 0) return { nuevas: [], vigentes: [] };
  const p = filas[0];
  const humedad = Number(p.humedad);
  const temperatura = Number(p.temperatura);
  const min = Number(p.humedad_min);
  const max = Number(p.humedad_max);
  const tMax = Number(p.temperatura_max);
  const tMin = p.temperatura_min === null ? null : Number(p.temperatura_min);

  const [regando] = await pool.query(
    "SELECT 1 FROM riego_eventos WHERE parcela_id = ? AND estado = 'en_curso' LIMIT 1",
    [p.id]
  );

  const condiciones = [
    {
      tipo: SENSOR.riego,
      activa: humedad < min,
      // con un riego en curso no se abre ni se actualiza, pero tampoco se
      // resuelve hasta que la humedad vuelva a rango
      omitir: regando.length > 0,
      severidad: humedad < min - 10 ? "alta" : "media",
      detalle: `Humedad de suelo ${redondear(humedad)}% (mínimo ${redondear(min)}%)`,
      valor: humedad,
    },
    {
      tipo: SENSOR.exceso,
      activa: humedad > max,
      severidad: "media",
      detalle: `Humedad de suelo ${redondear(humedad)}% (máximo ${redondear(max)}%)`,
      valor: humedad,
    },
    {
      tipo: SENSOR.calor,
      activa: temperatura > tMax,
      severidad: temperatura > tMax + 3 ? "alta" : "media",
      detalle: `Temperatura ${redondear(temperatura)} °C (máximo ${redondear(tMax)} °C)`,
      valor: temperatura,
    },
    {
      tipo: SENSOR.helada,
      activa: tMin !== null && temperatura < tMin,
      severidad: "alta",
      detalle: `Temperatura ${redondear(temperatura)} °C (mínimo ${tMin === null ? "—" : redondear(tMin)} °C)`,
      valor: temperatura,
    },
  ];

  const nuevas = [];
  const vigentes = [];
  for (const c of condiciones) {
    if (c.activa) {
      if (c.omitir) continue;
      const nueva = await abrirOActualizar({
        parcelaId: p.id,
        estacionId,
        tipo: c.tipo,
        categoria: "sensor",
        severidad: c.severidad,
        detalle: c.detalle,
        valor: c.valor,
      });
      vigentes.push(c.tipo);
      if (nueva) nuevas.push(c.tipo);
    } else {
      await resolver(p.id, c.tipo);
    }
  }
  return { nuevas, vigentes };
}

// --- Consultas ---

const SELECT_ALERTAS = `
  SELECT a.id, a.parcela_id, p.nombre AS parcela_nombre, p.finca_id, f.nombre AS finca_nombre,
         a.estacion_id, e.codigo AS estacion_codigo, a.tipo, a.categoria, a.severidad, a.estado,
         a.detalle, a.repeticiones, a.ultimo_valor, a.fecha, a.ultima_lectura_en,
         a.atendida_por, u.nombre AS atendida_por_nombre, a.atendida_en, a.resuelta_en
  FROM alertas a
  JOIN parcelas p ON p.id = a.parcela_id
  JOIN fincas f ON f.id = p.finca_id
  LEFT JOIN estaciones e ON e.id = a.estacion_id
  LEFT JOIN usuarios u ON u.id = a.atendida_por`;

function filtrosAlertas(query, usuario) {
  const condiciones = [];
  const params = [];
  const parcelaId = idPositivo(query.parcela_id);
  const fincaId = idPositivo(query.finca_id);
  if (parcelaId) {
    condiciones.push("a.parcela_id = ?");
    params.push(parcelaId);
  }
  if (fincaId) {
    condiciones.push("p.finca_id = ?");
    params.push(fincaId);
  }
  if (CATEGORIAS.includes(query.categoria)) {
    condiciones.push("a.categoria = ?");
    params.push(query.categoria);
  }
  if (SEVERIDADES.includes(query.severidad)) {
    condiciones.push("a.severidad = ?");
    params.push(query.severidad);
  }
  if (query.estado === "vigentes") {
    condiciones.push("a.estado IN ('activa', 'atendida')");
  } else if (ESTADOS.includes(query.estado)) {
    condiciones.push("a.estado = ?");
    params.push(query.estado);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.desde || "")) {
    condiciones.push("a.fecha >= ?");
    params.push(`${query.desde} 00:00:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.hasta || "")) {
    condiciones.push("a.fecha < ? + INTERVAL 1 DAY");
    params.push(`${query.hasta} 00:00:00`);
  }
  aplicarFiltro(filtroParcelas(usuario, "a.parcela_id"), condiciones, params);
  return { where: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "", params };
}

function registrarRutas(app) {
  // Listado con filtros: parcela_id, finca_id, categoria, severidad,
  // estado (activa | atendida | resuelta | vigentes), desde, hasta, limit (solo parcelas del usuario)
  app.get("/api/alertas", async (req, res) => {
    try {
      const { where, params } = filtrosAlertas(req.query, req.usuario);
      const limite = Math.min(10000, Math.max(1, Number(req.query.limit) || 200));
      const [rows] = await pool.query(
        `${SELECT_ALERTAS} ${where}
         ORDER BY FIELD(a.estado, 'activa', 'atendida', 'resuelta'), FIELD(a.severidad, 'alta', 'media', 'info'),
                  COALESCE(a.ultima_lectura_en, a.fecha) DESC, a.id DESC
         LIMIT ?`,
        [...params, limite]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar las alertas" });
    }
  });

  // Conteo de alertas activas (sin atender) por severidad, para insignias y dashboard
  app.get("/api/alertas/conteo", async (req, res) => {
    try {
      const { where, params } = filtrosAlertas({ ...req.query, estado: "vigentes", severidad: undefined }, req.usuario);
      const [rows] = await pool.query(
        `SELECT a.estado, a.severidad, COUNT(*) AS total FROM alertas a JOIN parcelas p ON p.id = a.parcela_id
         ${where} GROUP BY a.estado, a.severidad`,
        params
      );
      const conteo = { activas: 0, atendidas: 0, por_severidad: { alta: 0, media: 0, info: 0 } };
      rows.forEach((r) => {
        if (r.estado === "activa") {
          conteo.activas += r.total;
          conteo.por_severidad[r.severidad] += r.total;
        } else {
          conteo.atendidas += r.total;
        }
      });
      res.json(conteo);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al contar las alertas" });
    }
  });

  // Marcar como atendida: alguien la vio y se hace cargo. Sigue vigente (se
  // sigue actualizando) hasta que la condición termine y se resuelva sola.
  app.put("/api/alertas/:id/atender", async (req, res) => {
    const usuarioId = req.usuario.id;
    try {
      const [rows] = await pool.query("SELECT parcela_id, estado FROM alertas WHERE id = ?", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Alerta no encontrada" });
      if (!(await puedeGestionarParcela(req.usuario, rows[0].parcela_id))) {
        return res.status(403).json({ error: "No tienes esta parcela asignada" });
      }
      if (rows[0].estado !== "activa") {
        return res.status(409).json({ error: `La alerta ya está ${rows[0].estado}` });
      }
      await pool.query(
        "UPDATE alertas SET estado = 'atendida', atendida_por = ?, atendida_en = NOW() WHERE id = ? AND estado = 'activa'",
        [usuarioId, req.params.id]
      );
      res.json({ id: Number(req.params.id), estado: "atendida" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al atender la alerta" });
    }
  });

  // Panel "Lecturas en vivo": con vigentes=1 solo las que siguen abiertas
  app.get("/api/alertas/recientes", async (req, res) => {
    try {
      const { where, params } = filtrosAlertas(
        { ...req.query, estado: req.query.vigentes === "1" ? "vigentes" : req.query.estado },
        req.usuario
      );
      const limite = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
      const [rows] = await pool.query(
        `${SELECT_ALERTAS} ${where} ORDER BY COALESCE(a.ultima_lectura_en, a.fecha) DESC, a.id DESC LIMIT ?`,
        [...params, limite]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar las alertas recientes" });
    }
  });

  // Alertas de una parcela (detalle de parcela en la app): por defecto solo
  // las vigentes; ?estado=todas para el historial completo
  app.get("/api/parcelas/:parcelaId/alertas", async (req, res) => {
    try {
      if (!(await puedeGestionarParcela(req.usuario, idPositivo(req.params.parcelaId)))) {
        return res.status(403).json({ error: "No tienes esta parcela asignada" });
      }
      const estado = req.query.estado === "todas" ? undefined : req.query.estado || "vigentes";
      const { where, params } = filtrosAlertas({ ...req.query, parcela_id: req.params.parcelaId, estado }, req.usuario);
      const [rows] = await pool.query(
        `${SELECT_ALERTAS} ${where} ORDER BY COALESCE(a.ultima_lectura_en, a.fecha) DESC LIMIT 100`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar las alertas de la parcela" });
    }
  });
}

module.exports = { abrirOActualizar, resolver, evaluarLectura, registrarRutas };
