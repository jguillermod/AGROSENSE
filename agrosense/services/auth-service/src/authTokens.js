const crypto = require("crypto");
const pool = require("./db");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function ensureAuthSchema() {
  // En instalaciones existentes, el DEFAULT 1 mantiene verificadas las cuentas antiguas.
  await pool.query(
    "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado TINYINT(1) NOT NULL DEFAULT 1 AFTER rol"
  );
  await pool.query("ALTER TABLE usuarios ALTER COLUMN email_verificado SET DEFAULT 0");
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    tipo ENUM('verificacion', 'recuperacion') NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expira_en TIMESTAMP NOT NULL,
    usado_en TIMESTAMP NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_auth_token (token_hash, tipo, expira_en)
  )`);
}

async function createToken(usuarioId, tipo, minutes) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    "UPDATE auth_tokens SET usado_en = NOW() WHERE usuario_id = ? AND tipo = ? AND usado_en IS NULL",
    [usuarioId, tipo]
  );
  await pool.query(
    "INSERT INTO auth_tokens (usuario_id, tipo, token_hash, expira_en) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
    [usuarioId, tipo, hashToken(token), minutes]
  );
  return token;
}

async function findValidToken(connection, token, tipo) {
  if (!token) return null;
  const [rows] = await connection.query(
    "SELECT id, usuario_id FROM auth_tokens WHERE token_hash = ? AND tipo = ? AND usado_en IS NULL AND expira_en > NOW() LIMIT 1",
    [hashToken(token), tipo]
  );
  return rows[0] || null;
}

module.exports = { ensureAuthSchema, createToken, findValidToken };
