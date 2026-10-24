// Inventario de cultivos: cada cultivo es de una finca (finca_id) y,
// opcionalmente, de una de sus parcelas (parcela_id). Con parcela_id NULL es
// un cultivo "de la finca" (varias parcelas o la finca completa).
//
// Permisos (a partir del JWT, ver permisos.js):
// - admin y llamadas de servicio: todo.
// - cultivos de parcela: quien puede gestionar esa parcela (el dueño de la
//   finca y quien la tenga asignada).
// - cultivos de la finca: solo el dueño de la finca. El agrónomo trabaja por
//   parcelas asignadas, así que nunca ve ni toca los cultivos de finca.

const pool = require("./db");
const { idPositivo, veTodo, filtroParcelas, aplicarFiltro, puedeGestionarParcela, puedeVerFinca, puedeAdministrarFinca } =
  require("./permisos");

const UNIDADES = ["plantas", "kg", "quintales"];
const ESTADOS = ["sembrado", "en_crecimiento", "cosechado"];

// Las fechas se devuelven como texto YYYY-MM-DD: un DATE convertido a Date
// de JS llega como medianoche UTC y en el navegador/celular (UTC-6) se
// mostraría como el día anterior.
const SELECT_CULTIVOS = `
  SELECT c.id, c.finca_id, f.nombre AS finca_nombre, c.parcela_id, p.nombre AS parcela_nombre,
         c.tipo, c.variedad,
         DATE_FORMAT(c.fecha_siembra, '%Y-%m-%d') AS fecha_siembra,
         DATE_FORMAT(c.fecha_cosecha_estimada, '%Y-%m-%d') AS fecha_cosecha_estimada,
         c.cantidad, c.unidad, c.estado, c.notas, c.creado_en
  FROM cultivos c
  JOIN fincas f ON f.id = c.finca_id
  LEFT JOIN parcelas p ON p.id = c.parcela_id`;

// Primero los de la finca completa, después por parcela; dentro, lo más reciente primero
const ORDEN = "ORDER BY f.nombre, c.parcela_id IS NOT NULL, p.nombre, c.fecha_siembra DESC, c.id DESC";

// Condición SQL de los cultivos que el usuario puede ver (null si ve todo)
function filtroCultivos(usuario) {
  if (veTodo(usuario)) return null;
  const deParcelas = filtroParcelas(usuario, "c.parcela_id");
  if (usuario.rol === "agronomo") return deParcelas; // parcela_id NULL nunca entra en el IN
  return {
    sql: `(${deParcelas.sql} OR (c.parcela_id IS NULL AND c.finca_id IN (SELECT id FROM fincas WHERE usuario_id = ?)))`,
    params: [...deParcelas.params, usuario.id],
  };
}

// ¿Puede crear/editar/borrar un cultivo en esa ubicación?
async function puedeGestionarUbicacion(usuario, fincaId, parcelaId) {
  if (veTodo(usuario)) return true;
  if (parcelaId) return puedeGestionarParcela(usuario, parcelaId);
  if (usuario.rol === "agronomo") return false;
  return puedeAdministrarFinca(usuario, fincaId);
}

function fechaValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

// Devuelve { error } o { datos } con los campos ya normalizados
function validarCultivo(body) {
  const texto = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const datos = {
    finca_id: idPositivo(body.finca_id),
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

  // parcela vacía = cultivo de la finca; cualquier otro valor debe ser un id
  if (texto(body.parcela_id) !== "" && !datos.parcela_id) return { error: "Parcela inválida" };
  if (!datos.finca_id && !datos.parcela_id) return { error: "Selecciona una finca" };
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
  if (!UNIDADES.includes(datos.unidad)) return { error: `Unidad inválida (usa: ${UNIDADES.join(", ")})` };
  if (!ESTADOS.includes(datos.estado)) return { error: `Estado inválido (usa: ${ESTADOS.join(", ")})` };
  return { datos };
}

// Confirma que la finca existe y que la parcela (si viene) es de esa finca.
// Sin finca_id (clientes anteriores a la 005 solo mandan parcela_id) se toma
// la finca de la parcela. Devuelve { error, status } o null; completa datos.finca_id.
async function resolverUbicacion(datos) {
  if (datos.parcela_id) {
    const [[parcela]] = await pool.query("SELECT finca_id FROM parcelas WHERE id = ?", [datos.parcela_id]);
    if (!parcela) return { status: 400, error: "La parcela no existe" };
    if (!datos.finca_id) datos.finca_id = parcela.finca_id;
    if (parcela.finca_id !== datos.finca_id) {
      return { status: 400, error: "La parcela no pertenece a la finca seleccionada" };
    }
    return null;
  }
  const [[finca]] = await pool.query("SELECT id FROM fincas WHERE id = ?", [datos.finca_id]);
  return finca ? null : { status: 400, error: "La finca no existe" };
}

function registrarRutas(app) {
  const prohibido = (res, mensaje) => res.status(403).json({ error: mensaje });
  const sinPermiso = (res, parcelaId) =>
    prohibido(res, parcelaId ? "No tienes esta parcela asignada" : "Solo el dueño de la finca gestiona sus cultivos generales");

  // Listado con filtros opcionales: finca_id, parcela_id ("ninguna" = solo
  // los de la finca completa) y estado. Siempre dentro de lo que el usuario ve.
  app.get("/api/cultivos", async (req, res) => {
    try {
      const condiciones = [];
      const params = [];
      const fincaId = idPositivo(req.query.finca_id);
      const parcelaId = idPositivo(req.query.parcela_id);
      if (fincaId) {
        condiciones.push("c.finca_id = ?");
        params.push(fincaId);
      }
      if (parcelaId) {
        condiciones.push("c.parcela_id = ?");
        params.push(parcelaId);
      } else if (req.query.parcela_id === "ninguna") {
        condiciones.push("c.parcela_id IS NULL");
      }
      if (ESTADOS.includes(req.query.estado)) {
        condiciones.push("c.estado = ?");
        params.push(req.query.estado);
      }
      aplicarFiltro(filtroCultivos(req.usuario), condiciones, params);
      const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
      const [rows] = await pool.query(`${SELECT_CULTIVOS} ${where} ${ORDEN}`, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al consultar los cultivos" });
    }
  });

  // Detalle de finca: los de la finca completa y los de sus parcelas (el
  // agrónomo, solo los de sus parcelas asignadas en esa finca)
  app.get("/api/fincas/:fincaId/cultivos", async (req, res) => {
    try {
      const fincaId = idPositivo(req.params.fincaId);
      if (!fincaId) return res.status(400).json({ error: "Finca inválida" });
      if (!(await puedeVerFinca(req.usuario, fincaId))) return prohibido(res, "No tienes acceso a esta finca");
      const condiciones = ["c.finca_id = ?"];
      const params = [fincaId];
      aplicarFiltro(filtroCultivos(req.usuario), condiciones, params);
      const [rows] = await pool.query(`${SELECT_CULTIVOS} WHERE ${condiciones.join(" AND ")} ${ORDEN}`, params);
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
      if (!(await puedeGestionarParcela(req.usuario, parcelaId))) return sinPermiso(res, parcelaId);
      const [rows] = await pool.query(`${SELECT_CULTIVOS} WHERE c.parcela_id = ? ${ORDEN}`, [parcelaId]);
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
      const invalida = await resolverUbicacion(datos);
      if (invalida) return res.status(invalida.status).json({ error: invalida.error });
      if (!(await puedeGestionarUbicacion(req.usuario, datos.finca_id, datos.parcela_id))) {
        return sinPermiso(res, datos.parcela_id);
      }
      const [result] = await pool.query(
        `INSERT INTO cultivos (finca_id, parcela_id, tipo, variedad, fecha_siembra, fecha_cosecha_estimada, cantidad, unidad, estado, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [datos.finca_id, datos.parcela_id, datos.tipo, datos.variedad, datos.fecha_siembra, datos.fecha_cosecha_estimada,
         datos.cantidad, datos.unidad, datos.estado, datos.notas]
      );
      const [[creado]] = await pool.query(`${SELECT_CULTIVOS} WHERE c.id = ?`, [result.insertId]);
      res.status(201).json(creado);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al crear el cultivo" });
    }
  });

  app.put("/api/cultivos/:id", async (req, res) => {
    const { error, datos } = validarCultivo(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const [[actual]] = await pool.query("SELECT finca_id, parcela_id FROM cultivos WHERE id = ?", [req.params.id]);
      if (!actual) return res.status(404).json({ error: "Cultivo no encontrado" });

      // Si se mueve, hace falta permiso sobre la ubicación de origen y la de destino
      if (!(await puedeGestionarUbicacion(req.usuario, actual.finca_id, actual.parcela_id))) {
        return sinPermiso(res, actual.parcela_id);
      }
      const invalida = await resolverUbicacion(datos);
      if (invalida) return res.status(invalida.status).json({ error: invalida.error });
      if (!(await puedeGestionarUbicacion(req.usuario, datos.finca_id, datos.parcela_id))) {
        return sinPermiso(res, datos.parcela_id);
      }

      await pool.query(
        `UPDATE cultivos SET finca_id = ?, parcela_id = ?, tipo = ?, variedad = ?, fecha_siembra = ?,
                fecha_cosecha_estimada = ?, cantidad = ?, unidad = ?, estado = ?, notas = ?
         WHERE id = ?`,
        [datos.finca_id, datos.parcela_id, datos.tipo, datos.variedad, datos.fecha_siembra, datos.fecha_cosecha_estimada,
         datos.cantidad, datos.unidad, datos.estado, datos.notas, req.params.id]
      );
      const [[editado]] = await pool.query(`${SELECT_CULTIVOS} WHERE c.id = ?`, [req.params.id]);
      res.json(editado);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al editar el cultivo" });
    }
  });

  app.delete("/api/cultivos/:id", async (req, res) => {
    try {
      const [[actual]] = await pool.query("SELECT finca_id, parcela_id FROM cultivos WHERE id = ?", [req.params.id]);
      if (!actual) return res.status(404).json({ error: "Cultivo no encontrado" });
      if (!(await puedeGestionarUbicacion(req.usuario, actual.finca_id, actual.parcela_id))) {
        return sinPermiso(res, actual.parcela_id);
      }
      await pool.query("DELETE FROM cultivos WHERE id = ?", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al eliminar el cultivo" });
    }
  });
}

module.exports = { registrarRutas, filtroCultivos };
