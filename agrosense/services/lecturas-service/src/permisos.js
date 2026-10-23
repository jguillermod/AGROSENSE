// Permisos por rol, a partir del usuario del JWT (req.usuario, ver verificarJWT.js).
// Nunca se usa el usuario_id que manda el cliente: se podría falsificar.
//
// - admin, y las llamadas internas con X-Service-Token (rol "servicio"): todo.
// - cualquier otro usuario (agricultor, agrónomo): las fincas de las que es
//   dueño (fincas.usuario_id) con todas sus parcelas, más las parcelas que el
//   admin le asignó en usuario_parcelas. En la práctica el agricultor ve sus
//   fincas y el agrónomo sus parcelas asignadas (y las que él mismo registró).
//
// COPIA IDÉNTICA en fincas-service y lecturas-service: si cambias una, copia la otra.

const pool = require("./db");

const idPositivo = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const veTodo = (usuario) => usuario.rol === "admin" || usuario.rol === "servicio";

const PARCELAS_ASIGNADAS = "SELECT parcela_id FROM usuario_parcelas WHERE usuario_id = ?";

// Condición SQL "columna IN (parcelas visibles)" con sus parámetros, o null si ve todo
function filtroParcelas(usuario, columna) {
  if (veTodo(usuario)) return null;
  return {
    sql: `${columna} IN (SELECT p.id FROM parcelas p JOIN fincas f ON f.id = p.finca_id WHERE f.usuario_id = ?
                         UNION ${PARCELAS_ASIGNADAS})`,
    params: [usuario.id, usuario.id],
  };
}

// Igual para fincas: las propias y las que contienen alguna parcela asignada
function filtroFincas(usuario, columna) {
  if (veTodo(usuario)) return null;
  return {
    sql: `${columna} IN (SELECT id FROM fincas WHERE usuario_id = ?
                         UNION SELECT p.finca_id FROM parcelas p WHERE p.id IN (${PARCELAS_ASIGNADAS}))`,
    params: [usuario.id, usuario.id],
  };
}

// Agrega un filtro (si lo hay) a las listas de condiciones/params de un listado
function aplicarFiltro(filtro, condiciones, params) {
  if (!filtro) return;
  condiciones.push(filtro.sql);
  params.push(...filtro.params);
}

// Ver y operar una parcela (cultivos, riego, alertas, umbrales)
async function puedeGestionarParcela(usuario, parcelaId) {
  if (veTodo(usuario)) return true;
  const filtro = filtroParcelas(usuario, "p.id");
  const [rows] = await pool.query(`SELECT 1 FROM parcelas p WHERE p.id = ? AND ${filtro.sql}`, [
    parcelaId,
    ...filtro.params,
  ]);
  return rows.length > 0;
}

async function puedeVerFinca(usuario, fincaId) {
  if (veTodo(usuario)) return true;
  const filtro = filtroFincas(usuario, "f.id");
  const [rows] = await pool.query(`SELECT 1 FROM fincas f WHERE f.id = ? AND ${filtro.sql}`, [fincaId, ...filtro.params]);
  return rows.length > 0;
}

// Editar o eliminar la finca y crear o eliminar sus parcelas: solo su dueño (o admin)
async function puedeAdministrarFinca(usuario, fincaId) {
  if (veTodo(usuario)) return true;
  const [rows] = await pool.query("SELECT 1 FROM fincas WHERE id = ? AND usuario_id = ?", [fincaId, usuario.id]);
  return rows.length > 0;
}

module.exports = {
  idPositivo,
  veTodo,
  filtroParcelas,
  filtroFincas,
  aplicarFiltro,
  puedeGestionarParcela,
  puedeVerFinca,
  puedeAdministrarFinca,
};
