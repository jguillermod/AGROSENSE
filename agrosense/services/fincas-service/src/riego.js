// Programación de riego: CRUD de programaciones, riego manual, riego
// automático por humedad, bitácora y el motor que los ejecuta.
//
// El motor vive aquí (y no en el simulador) porque es lógica de negocio sobre
// datos de este servicio y tiene que funcionar igual con sensores reales; el
// simulador solo aporta la hora acelerada (ver reloj.js) y reacciona a los
// riegos en curso subiendo la humedad.

const pool = require("./db");
const reloj = require("./reloj");
const { idPositivo, esAgronomo, puedeGestionarParcela } = require("./permisos");

const DIA_POR_INDICE = ["D", "L", "M", "X", "J", "V", "S"]; // índice = getUTCDay()
const ORDEN_DIAS = ["L", "M", "X", "J", "V", "S", "D"];
const DURACION_MAX = 720;
const ORIGENES = ["programado", "manual", "automatico"];
const ESTADOS = ["en_curso", "completado", "cancelado", "omitido"];

// Alertas climáticas de lluvia (las crea lecturas-service, ver su clima.js):
// con alguna vigente en la parcela, el motor no riega y lo anota en la bitácora.
const ALERTAS_LLUVIA = ["Lluvia en curso: riego pospuesto", "Lluvia intensa prevista: posponer riego"];

// Duración (en minutos del reloj del motor) de cada riego automático
const AUTO_DURACION = Number(process.env.RIEGO_AUTO_DURACION_MINUTOS) || 60;
// Cada cuánto revisa el motor. Con el reloj simulado a x144, revisar cada
// minuto real serían 2.4 h simuladas por vuelta y un riego de 30 min empezaría
// y terminaría entre dos revisiones; por eso por defecto son 5 s (12 min
// simulados). Con el reloj real basta con 60 s.
const TICK_MS = (Number(process.env.RIEGO_TICK_SECONDS) || (reloj.MODO === "real" ? 60 : 5)) * 1000;
// Lecturas más viejas que esto no cuentan para el riego automático
const LECTURAS_RECIENTES_MIN = 10;

const DIA_MS = 24 * 60 * 60 * 1000;
const texto = (v) => (v === undefined || v === null ? "" : String(v).trim());
const aBool = (v) => v === true || v === 1 || ["true", "1", "on", "si", "sí"].includes(String(v).toLowerCase());

// --- Validación ---

function normalizarDias(valor) {
  const lista = Array.isArray(valor) ? valor : texto(valor).split(",");
  const dias = new Set(lista.map((d) => texto(d).toUpperCase()).filter((d) => ORDEN_DIAS.includes(d)));
  return ORDEN_DIAS.filter((d) => dias.has(d)).join(",");
}

function validarDuracion(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > DURACION_MAX) return null;
  return n;
}

function validarProgramacion(body) {
  const datos = {
    parcela_id: idPositivo(body.parcela_id),
    nombre: texto(body.nombre),
    dias_semana: normalizarDias(body.dias_semana),
    hora_inicio: texto(body.hora_inicio).slice(0, 5),
    duracion_minutos: validarDuracion(body.duracion_minutos),
    activa: body.activa === undefined ? true : aBool(body.activa),
  };
  if (!datos.parcela_id) return { error: "Selecciona una parcela" };
  if (!datos.nombre) return { error: "El nombre de la programación es obligatorio" };
  if (datos.nombre.length > 100) return { error: "El nombre no puede superar 100 caracteres" };
  if (!datos.dias_semana) return { error: "Elige al menos un día de la semana" };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(datos.hora_inicio)) return { error: "La hora de inicio debe tener formato HH:MM" };
  if (!datos.duracion_minutos) return { error: `La duración debe ser un número entero de 1 a ${DURACION_MAX} minutos` };
  return { datos };
}

// --- Consultas ---

const SELECT_PROGRAMACIONES = `
  SELECT rp.id, rp.parcela_id, p.nombre AS parcela_nombre, p.finca_id, f.nombre AS finca_nombre,
         rp.nombre, rp.dias_semana, TIME_FORMAT(rp.hora_inicio, '%H:%i') AS hora_inicio,
         rp.duracion_minutos, rp.activa, rp.creado_en
  FROM riego_programaciones rp
  JOIN parcelas p ON p.id = rp.parcela_id
  JOIN fincas f ON f.id = p.finca_id`;

const SELECT_EVENTOS = `
  SELECT r.id, r.parcela_id, p.nombre AS parcela_nombre, p.finca_id, f.nombre AS finca_nombre,
         r.programacion_id, rp.nombre AS programacion_nombre, r.origen,
         DATE_FORMAT(r.inicio, '%Y-%m-%d %H:%i:%s') AS inicio,
         DATE_FORMAT(r.fin, '%Y-%m-%d %H:%i:%s') AS fin,
         DATE_FORMAT(r.inicio + INTERVAL r.duracion_minutos MINUTE, '%Y-%m-%d %H:%i:%s') AS fin_previsto,
         r.duracion_minutos, r.estado, r.motivo, r.creado_en
  FROM riego_eventos r
  JOIN parcelas p ON p.id = r.parcela_id
  JOIN fincas f ON f.id = p.finca_id
  LEFT JOIN riego_programaciones rp ON rp.id = r.programacion_id`;

// Próxima vez que toca una programación, según el reloj del motor
function proximaEjecucion(prog, ahora) {
  if (!prog.activa) return null;
  const dias = prog.dias_semana.split(",");
  const [h, m] = prog.hora_inicio.split(":").map(Number);
  const base = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  for (let d = 0; d <= 7; d++) {
    const candidata = new Date(base + d * DIA_MS + (h * 60 + m) * 60000);
    if (candidata > ahora && dias.includes(DIA_POR_INDICE[candidata.getUTCDay()])) return candidata;
  }
  return null;
}

function formatearProgramacion(prog, ahora) {
  const activa = Boolean(prog.activa);
  const proxima = ahora ? proximaEjecucion({ ...prog, activa }, ahora) : null;
  return { ...prog, activa, proxima_ejecucion: proxima ? reloj.aSql(proxima).slice(0, 16) : null };
}

// Hora del motor sin romper la respuesta si el simulador no contesta
async function ahoraOpcional() {
  try {
    return (await reloj.ahora()).fecha;
  } catch (err) {
    return null;
  }
}

// Condición extra para que un agrónomo solo vea sus parcelas asignadas
async function filtroAgronomo(usuarioId, columna, condiciones, params) {
  if (await esAgronomo(usuarioId)) {
    condiciones.push(`${columna} IN (SELECT parcela_id FROM usuario_parcelas WHERE usuario_id = ?)`);
    params.push(usuarioId);
  }
}

async function listarProgramaciones({ parcelaId, usuarioId }) {
  const condiciones = [];
  const params = [];
  if (parcelaId) {
    condiciones.push("rp.parcela_id = ?");
    params.push(parcelaId);
  }
  await filtroAgronomo(usuarioId, "rp.parcela_id", condiciones, params);
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `${SELECT_PROGRAMACIONES} ${where} ORDER BY f.nombre, p.nombre, rp.hora_inicio, rp.id`,
    params
  );
  const ahora = await ahoraOpcional();
  return rows.map((r) => formatearProgramacion(r, ahora));
}

async function listarEventos({ parcelaId, fincaId, desde, hasta, estado, origen, usuarioId, limite = 100 }) {
  const condiciones = [];
  const params = [];
  if (parcelaId) {
    condiciones.push("r.parcela_id = ?");
    params.push(parcelaId);
  }
  if (fincaId) {
    condiciones.push("p.finca_id = ?");
    params.push(fincaId);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde || "")) {
    condiciones.push("r.inicio >= ?");
    params.push(`${desde} 00:00:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta || "")) {
    condiciones.push("r.inicio < ? + INTERVAL 1 DAY");
    params.push(`${hasta} 00:00:00`);
  }
  if (ESTADOS.includes(estado)) {
    condiciones.push("r.estado = ?");
    params.push(estado);
  }
  if (ORIGENES.includes(origen)) {
    condiciones.push("r.origen = ?");
    params.push(origen);
  }
  await filtroAgronomo(usuarioId, "r.parcela_id", condiciones, params);
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const [rows] = await pool.query(`${SELECT_EVENTOS} ${where} ORDER BY r.inicio DESC, r.id DESC LIMIT ?`, [
    ...params,
    Math.min(5000, Math.max(1, Number(limite) || 100)),
  ]);
  return rows;
}

// --- Abrir / cerrar riegos ---

// Abre un riego si la parcela no tiene otro en curso. Bloquea la fila de la
// parcela para que el motor y un "Regar ahora" simultáneo no abran dos.
async function abrirRiego({ parcelaId, origen, programacionId = null, inicio, duracion }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [parcelas] = await conn.query("SELECT id FROM parcelas WHERE id = ? FOR UPDATE", [parcelaId]);
    if (parcelas.length === 0) {
      await conn.rollback();
      return { error: "Parcela no encontrada", status: 404 };
    }
    const [enCurso] = await conn.query(
      "SELECT id FROM riego_eventos WHERE parcela_id = ? AND estado = 'en_curso' LIMIT 1",
      [parcelaId]
    );
    if (enCurso.length > 0) {
      await conn.rollback();
      return { error: "La parcela ya tiene un riego en curso", status: 409 };
    }
    const [result] = await conn.query(
      `INSERT INTO riego_eventos (parcela_id, programacion_id, origen, inicio, duracion_minutos, estado)
       VALUES (?, ?, ?, ?, ?, 'en_curso')`,
      [parcelaId, programacionId, origen, reloj.aSql(inicio), duracion]
    );
    await conn.commit();
    return { id: result.insertId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Alerta de lluvia vigente en la parcela (o null)
async function lluviaVigente(parcelaId) {
  const [rows] = await pool.query(
    `SELECT id, tipo, fecha FROM alertas
     WHERE parcela_id = ? AND categoria = 'climatica' AND estado IN ('activa', 'atendida') AND tipo IN (?)
     ORDER BY fecha LIMIT 1`,
    [parcelaId, ALERTAS_LLUVIA]
  );
  return rows[0] || null;
}

// Deja en la bitácora un riego que no se hizo (estado "omitido", 0 minutos)
async function registrarOmitido({ parcelaId, origen, programacionId = null, inicio, motivo }) {
  await pool.query(
    `INSERT INTO riego_eventos (parcela_id, programacion_id, origen, inicio, fin, duracion_minutos, estado, motivo)
     VALUES (?, ?, ?, ?, ?, 0, 'omitido', ?)`,
    [parcelaId, programacionId, origen, reloj.aSql(inicio), reloj.aSql(inicio), motivo]
  );
}

// Cierra los riegos cuyo tiempo ya se cumplió
async function cerrarVencidos(ahora) {
  const [result] = await pool.query(
    `UPDATE riego_eventos
     SET estado = 'completado', fin = inicio + INTERVAL duracion_minutos MINUTE
     WHERE estado = 'en_curso' AND inicio + INTERVAL duracion_minutos MINUTE <= ?`,
    [reloj.aSql(ahora)]
  );
  return result.affectedRows;
}

// Programaciones cuyo horario cae en (desde, hasta]
async function ejecutarProgramaciones(desde, hasta) {
  // si el motor estuvo detenido mucho tiempo, no recupera más de un día
  const inicioVentana = new Date(Math.max(desde.getTime(), hasta.getTime() - DIA_MS));
  const [programaciones] = await pool.query(
    "SELECT id, parcela_id, nombre, dias_semana, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, duracion_minutos FROM riego_programaciones WHERE activa = TRUE"
  );
  for (const prog of programaciones) {
    const dias = prog.dias_semana.split(",");
    const [h, m] = prog.hora_inicio.split(":").map(Number);
    const primerDia = Date.UTC(inicioVentana.getUTCFullYear(), inicioVentana.getUTCMonth(), inicioVentana.getUTCDate());
    for (let dia = primerDia; dia <= hasta.getTime(); dia += DIA_MS) {
      const candidata = new Date(dia + (h * 60 + m) * 60000);
      if (candidata <= inicioVentana || candidata > hasta) continue;
      if (!dias.includes(DIA_POR_INDICE[candidata.getUTCDay()])) continue;
      const lluvia = await lluviaVigente(prog.parcela_id);
      if (lluvia) {
        await registrarOmitido({
          parcelaId: prog.parcela_id,
          origen: "programado",
          programacionId: prog.id,
          inicio: candidata,
          motivo: `Omitido por lluvia (${lluvia.tipo.split(":")[0].toLowerCase()}); estaba programado por ${prog.duracion_minutos} min`,
        });
        console.log(`[riego] "${prog.nombre}" (${reloj.aSql(candidata)}) omitido por lluvia`);
        continue;
      }
      const r = await abrirRiego({
        parcelaId: prog.parcela_id,
        origen: "programado",
        programacionId: prog.id,
        inicio: candidata,
        duracion: prog.duracion_minutos,
      });
      console.log(
        r.error
          ? `[riego] "${prog.nombre}" (${reloj.aSql(candidata)}) no se ejecutó: ${r.error}`
          : `[riego] Programación "${prog.nombre}" iniciada (parcela ${prog.parcela_id}, ${reloj.aSql(candidata)}, ${prog.duracion_minutos} min)`
      );
    }
  }
}

// Riego automático: parcelas con riego_automatico cuya humedad (promedio de la
// última lectura reciente de cada estación) está bajo el mínimo y no riegan.
async function ejecutarRiegoAutomatico(ahora) {
  const [parcelas] = await pool.query(
    `SELECT p.id, p.nombre, MAX(p.humedad_min) AS humedad_min, AVG(l.humedad_suelo) AS humedad
     FROM parcelas p
     JOIN estaciones e ON e.parcela_id = p.id
     JOIN lecturas l ON l.id = (
       SELECT id FROM lecturas WHERE estacion_id = e.id ORDER BY fecha DESC, id DESC LIMIT 1
     )
     WHERE p.riego_automatico = TRUE
       AND l.fecha >= NOW() - INTERVAL ${LECTURAS_RECIENTES_MIN} MINUTE
       AND NOT EXISTS (SELECT 1 FROM riego_eventos r WHERE r.parcela_id = p.id AND r.estado = 'en_curso')
     GROUP BY p.id, p.nombre
     HAVING AVG(l.humedad_suelo) < MAX(p.humedad_min)`
  );
  for (const p of parcelas) {
    const lluvia = await lluviaVigente(p.id);
    if (lluvia) {
      // se anota una sola vez por episodio de lluvia, no en cada vuelta del motor
      const [yaAnotado] = await pool.query(
        `SELECT 1 FROM riego_eventos
         WHERE parcela_id = ? AND origen = 'automatico' AND estado = 'omitido' AND creado_en >= ? LIMIT 1`,
        [p.id, lluvia.fecha]
      );
      if (yaAnotado.length === 0) {
        await registrarOmitido({
          parcelaId: p.id,
          origen: "automatico",
          inicio: ahora,
          motivo: `Omitido por lluvia (${lluvia.tipo.split(":")[0].toLowerCase()}); humedad ${Number(p.humedad).toFixed(1)}% bajo el mínimo`,
        });
        console.log(`[riego] Riego automático en ${p.nombre} omitido por lluvia`);
      }
      continue;
    }
    const r = await abrirRiego({ parcelaId: p.id, origen: "automatico", inicio: ahora, duracion: AUTO_DURACION });
    if (!r.error) {
      console.log(
        `[riego] Riego automático en ${p.nombre}: humedad ${Number(p.humedad).toFixed(1)}% < ${Number(p.humedad_min)}% (${AUTO_DURACION} min)`
      );
    }
  }
}

// --- Motor ---

let ultimaHora = null;
let tickEnCurso = false;
let ultimoErrorLog = 0;

async function tickMotor() {
  if (tickEnCurso) return;
  tickEnCurso = true;
  try {
    const { fecha: ahora } = await reloj.ahora();
    if (ultimaHora && ahora < ultimaHora) {
      // El reloj retrocedió (p. ej. se reinició el simulador sin su estado):
      // los riegos abiertos ya no se podrían cerrar, así que se cancelan.
      const [result] = await pool.query(
        `UPDATE riego_eventos
         SET estado = 'cancelado',
             fin = LEAST(inicio + INTERVAL duracion_minutos MINUTE, ?),
             duracion_minutos = GREATEST(0, TIMESTAMPDIFF(MINUTE, inicio, LEAST(inicio + INTERVAL duracion_minutos MINUTE, ?)))
         WHERE estado = 'en_curso'`,
        [reloj.aSql(ultimaHora), reloj.aSql(ultimaHora)]
      );
      console.log(`[riego] El reloj retrocedió; ${result.affectedRows} riego(s) en curso cancelado(s)`);
    } else if (ultimaHora && ahora > ultimaHora) {
      await cerrarVencidos(ahora);
      await ejecutarProgramaciones(ultimaHora, ahora);
      await cerrarVencidos(ahora); // riegos cortos que empezaron y terminaron en esta misma vuelta
    }
    ultimaHora = ahora;
    await ejecutarRiegoAutomatico(ahora);
  } catch (err) {
    // sin inundar el log si el simulador está apagado
    if (Date.now() - ultimoErrorLog > 60000) {
      console.error(`[riego] Motor en espera: ${err.message}`);
      ultimoErrorLog = Date.now();
    }
  } finally {
    tickEnCurso = false;
  }
}

function iniciarMotor() {
  console.log(`[riego] Motor iniciado (reloj ${reloj.MODO}, revisa cada ${TICK_MS / 1000} s)`);
  setInterval(tickMotor, TICK_MS);
  tickMotor();
}

// --- Rutas ---

function registrarRutas(app) {
  const prohibido = (res) => res.status(403).json({ error: "No tienes esta parcela asignada" });

  app.get("/api/riego/reloj", async (req, res) => {
    try {
      const r = await reloj.ahora();
      res.json({ modo: r.modo, fecha_hora: reloj.aSql(r.fecha), escala: r.escala, pausado: r.pausado });
    } catch (err) {
      res.status(503).json({ error: `El reloj de la simulación no responde (${err.message})` });
    }
  });

  // Programaciones (global con filtros, o por parcela)
  app.get("/api/riego/programaciones", async (req, res) => {
    try {
      res.json(await listarProgramaciones({ parcelaId: idPositivo(req.query.parcela_id), usuarioId: idPositivo(req.query.usuario_id) }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar las programaciones" });
    }
  });

  app.get("/api/parcelas/:parcelaId/riego/programaciones", async (req, res) => {
    try {
      const parcelaId = idPositivo(req.params.parcelaId);
      if (!(await puedeGestionarParcela(idPositivo(req.query.usuario_id), parcelaId))) return prohibido(res);
      res.json(await listarProgramaciones({ parcelaId }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar las programaciones" });
    }
  });

  app.post("/api/riego/programaciones", async (req, res) => {
    const { error, datos } = validarProgramacion(req.body);
    if (error) return res.status(400).json({ error });
    try {
      if (!(await puedeGestionarParcela(idPositivo(req.body.usuario_id), datos.parcela_id))) return prohibido(res);
      const [result] = await pool.query(
        `INSERT INTO riego_programaciones (parcela_id, nombre, dias_semana, hora_inicio, duracion_minutos, activa)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [datos.parcela_id, datos.nombre, datos.dias_semana, datos.hora_inicio, datos.duracion_minutos, datos.activa]
      );
      res.status(201).json({ id: result.insertId, ...datos });
    } catch (err) {
      if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "La parcela no existe" });
      console.error(err);
      res.status(500).json({ error: "Error al crear la programación" });
    }
  });

  app.put("/api/riego/programaciones/:id", async (req, res) => {
    const { error, datos } = validarProgramacion(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const [actual] = await pool.query("SELECT parcela_id FROM riego_programaciones WHERE id = ?", [req.params.id]);
      if (actual.length === 0) return res.status(404).json({ error: "Programación no encontrada" });
      const usuarioId = idPositivo(req.body.usuario_id);
      const permitido =
        (await puedeGestionarParcela(usuarioId, actual[0].parcela_id)) &&
        (await puedeGestionarParcela(usuarioId, datos.parcela_id));
      if (!permitido) return prohibido(res);
      await pool.query(
        `UPDATE riego_programaciones
         SET parcela_id = ?, nombre = ?, dias_semana = ?, hora_inicio = ?, duracion_minutos = ?, activa = ?
         WHERE id = ?`,
        [datos.parcela_id, datos.nombre, datos.dias_semana, datos.hora_inicio, datos.duracion_minutos, datos.activa, req.params.id]
      );
      res.json({ id: Number(req.params.id), ...datos });
    } catch (err) {
      if (err.code === "ER_NO_REFERENCED_ROW_2") return res.status(400).json({ error: "La parcela no existe" });
      console.error(err);
      res.status(500).json({ error: "Error al editar la programación" });
    }
  });

  // Activar / pausar sin reenviar todo el formulario
  app.put("/api/riego/programaciones/:id/activa", async (req, res) => {
    try {
      const [actual] = await pool.query("SELECT parcela_id FROM riego_programaciones WHERE id = ?", [req.params.id]);
      if (actual.length === 0) return res.status(404).json({ error: "Programación no encontrada" });
      if (!(await puedeGestionarParcela(idPositivo(req.body.usuario_id), actual[0].parcela_id))) return prohibido(res);
      const activa = aBool(req.body.activa);
      await pool.query("UPDATE riego_programaciones SET activa = ? WHERE id = ?", [activa, req.params.id]);
      res.json({ id: Number(req.params.id), activa });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al cambiar el estado de la programación" });
    }
  });

  app.delete("/api/riego/programaciones/:id", async (req, res) => {
    try {
      const [actual] = await pool.query("SELECT parcela_id FROM riego_programaciones WHERE id = ?", [req.params.id]);
      if (actual.length === 0) return res.status(404).json({ error: "Programación no encontrada" });
      if (!(await puedeGestionarParcela(idPositivo(req.query.usuario_id), actual[0].parcela_id))) return prohibido(res);
      // los riegos ya registrados quedan en la bitácora (programacion_id pasa a NULL)
      await pool.query("DELETE FROM riego_programaciones WHERE id = ?", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al eliminar la programación" });
    }
  });

  // Riego manual
  app.post("/api/parcelas/:parcelaId/riego/iniciar", async (req, res) => {
    const parcelaId = idPositivo(req.params.parcelaId);
    const duracion = validarDuracion(req.body.duracion_minutos);
    if (!parcelaId) return res.status(400).json({ error: "Parcela inválida" });
    if (!duracion) return res.status(400).json({ error: `La duración debe ser un número entero de 1 a ${DURACION_MAX} minutos` });
    try {
      if (!(await puedeGestionarParcela(idPositivo(req.body.usuario_id), parcelaId))) return prohibido(res);
      let ahora;
      try {
        ahora = (await reloj.ahora()).fecha;
      } catch (err) {
        return res.status(503).json({ error: "El reloj de la simulación no responde; revisa que el simulador esté corriendo" });
      }
      const r = await abrirRiego({ parcelaId, origen: "manual", inicio: ahora, duracion });
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.status(201).json({ id: r.id, parcela_id: parcelaId, inicio: reloj.aSql(ahora), duracion_minutos: duracion });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al iniciar el riego" });
    }
  });

  // Detiene el riego en curso (sea manual, programado o automático); queda
  // como "cancelado" con los minutos que alcanzó a regar.
  app.post("/api/parcelas/:parcelaId/riego/detener", async (req, res) => {
    const parcelaId = idPositivo(req.params.parcelaId);
    if (!parcelaId) return res.status(400).json({ error: "Parcela inválida" });
    try {
      if (!(await puedeGestionarParcela(idPositivo(req.body.usuario_id), parcelaId))) return prohibido(res);
      let ahora;
      try {
        ahora = reloj.aSql((await reloj.ahora()).fecha);
      } catch (err) {
        return res.status(503).json({ error: "El reloj de la simulación no responde; revisa que el simulador esté corriendo" });
      }
      const [result] = await pool.query(
        `UPDATE riego_eventos
         SET estado = 'cancelado', fin = GREATEST(inicio, ?),
             duracion_minutos = GREATEST(0, TIMESTAMPDIFF(MINUTE, inicio, GREATEST(inicio, ?)))
         WHERE parcela_id = ? AND estado = 'en_curso'`,
        [ahora, ahora, parcelaId]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "La parcela no tiene un riego en curso" });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al detener el riego" });
    }
  });

  app.put("/api/parcelas/:parcelaId/riego-automatico", async (req, res) => {
    const parcelaId = idPositivo(req.params.parcelaId);
    if (!parcelaId) return res.status(400).json({ error: "Parcela inválida" });
    try {
      if (!(await puedeGestionarParcela(idPositivo(req.body.usuario_id), parcelaId))) return prohibido(res);
      const activo = aBool(req.body.activo);
      const [result] = await pool.query("UPDATE parcelas SET riego_automatico = ? WHERE id = ?", [activo, parcelaId]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Parcela no encontrada" });
      res.json({ parcela_id: parcelaId, riego_automatico: activo });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al cambiar el riego automático" });
    }
  });

  // Bitácora: filtros parcela_id, finca_id, desde, hasta (YYYY-MM-DD), estado, origen, limit
  app.get("/api/riego/eventos", async (req, res) => {
    try {
      res.json(
        await listarEventos({
          parcelaId: idPositivo(req.query.parcela_id),
          fincaId: idPositivo(req.query.finca_id),
          desde: req.query.desde,
          hasta: req.query.hasta,
          estado: req.query.estado,
          origen: req.query.origen,
          usuarioId: idPositivo(req.query.usuario_id),
          limite: req.query.limit,
        })
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar la bitácora de riego" });
    }
  });

  // Riegos en curso (lo consulta el simulador en cada vuelta)
  app.get("/api/riego/activos", async (req, res) => {
    try {
      res.json(await listarEventos({ estado: "en_curso", usuarioId: idPositivo(req.query.usuario_id), limite: 500 }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar los riegos en curso" });
    }
  });

  // Resumen de riego de una parcela (para el detalle de parcela en la app)
  app.get("/api/parcelas/:parcelaId/riego", async (req, res) => {
    try {
      const parcelaId = idPositivo(req.params.parcelaId);
      if (!(await puedeGestionarParcela(idPositivo(req.query.usuario_id), parcelaId))) return prohibido(res);
      const [parcelas] = await pool.query("SELECT riego_automatico FROM parcelas WHERE id = ?", [parcelaId]);
      if (parcelas.length === 0) return res.status(404).json({ error: "Parcela no encontrada" });
      const [enCurso, programaciones, eventos, ahora] = await Promise.all([
        listarEventos({ parcelaId, estado: "en_curso", limite: 1 }),
        listarProgramaciones({ parcelaId }),
        listarEventos({ parcelaId, limite: 5 }),
        ahoraOpcional(),
      ]);
      res.json({
        parcela_id: parcelaId,
        riego_automatico: Boolean(parcelas[0].riego_automatico),
        riego_en_curso: enCurso[0] || null,
        programaciones,
        ultimos_riegos: eventos,
        reloj: ahora ? reloj.aSql(ahora) : null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar el riego de la parcela" });
    }
  });
}

module.exports = { registrarRutas, iniciarMotor };
