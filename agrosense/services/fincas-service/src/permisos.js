// Permisos por rol compartidos por cultivos y riego.
// Igual que los registros manuales de lecturas-service: si la petición trae
// usuario_id y ese usuario es agrónomo, solo opera sobre las parcelas que
// tiene asignadas en usuario_parcelas; admin y agricultor mantienen el
// mismo acceso amplio que ya tienen sobre parcelas.

const pool = require("./db");

const idPositivo = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function esAgronomo(usuarioId) {
  if (!usuarioId) return false;
  const [rows] = await pool.query("SELECT rol FROM usuarios WHERE id = ?", [usuarioId]);
  return rows.length > 0 && rows[0].rol === "agronomo";
}

async function puedeGestionarParcela(usuarioId, parcelaId) {
  if (!usuarioId) return true;
  const [usuarios] = await pool.query("SELECT rol FROM usuarios WHERE id = ?", [usuarioId]);
  if (usuarios.length === 0) return false;
  if (usuarios[0].rol !== "agronomo") return true;
  const [asignaciones] = await pool.query(
    "SELECT 1 FROM usuario_parcelas WHERE usuario_id = ? AND parcela_id = ?",
    [usuarioId, parcelaId]
  );
  return asignaciones.length > 0;
}

module.exports = { idPositivo, esAgronomo, puedeGestionarParcela };
