// Seguridad del inicio de sesión: bloqueo por intentos fallidos y
// recuperación de contraseña con tokens de un solo uso.
//
// Los tiempos se calculan con NOW() de la base (no con la hora del
// contenedor) para que bloqueos y vencimientos no dependan de zonas horarias.

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;
const RESET_MINUTOS = 30;
// Mínimo de contraseña para registro, alta/edición de usuarios, perfil y
// recuperación. La web y la app usan el mismo número y el mismo mensaje.
const PASSWORD_MIN = 8;
const MENSAJE_PASSWORD_CORTA = `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
// Simulación: no se envía correo. El enlace siempre se escribe en los logs y
// solo se devuelve al cliente (para mostrarlo en pantalla) si esto es true.
const MOSTRAR_TOKEN = process.env.DEV_SHOW_RESET_TOKEN === "true";
const WEB_URL = (process.env.WEB_PUBLIC_URL || "http://localhost:8080").replace(/\/+$/, "");

const MENSAJE_SOLICITUD =
  `Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña. ` +
  `Vence en ${RESET_MINUTOS} minutos.`;

// true si la contraseña no cumple el mínimo (o no es texto)
const passwordCorta = (password) => typeof password !== "string" || password.length < PASSWORD_MIN;

const sha256 = (valor) => crypto.createHash("sha256").update(valor).digest("hex");

// "14 min 5 s", "40 s"
function describirEspera(segundos) {
  const min = Math.floor(segundos / 60);
  const s = segundos % 60;
  if (min === 0) return `${s} s`;
  return s ? `${min} min ${s} s` : `${min} min`;
}

// --- Bloqueo de cuenta ---

// 423 (no 401): un bloqueo no es una sesión inválida, así que la web y la app
// no cierran la sesión que ya tengan abierta (ver WWW-Authenticate en verificarJWT.js).
function responderBloqueo(res, segundos, recienBloqueada = false) {
  const motivo = recienBloqueada
    ? `Demasiados intentos fallidos: la cuenta quedó bloqueada ${BLOQUEO_MINUTOS} minutos.`
    : "La cuenta está bloqueada por demasiados intentos fallidos.";
  return res.status(423).json({
    error: `${motivo} Podrás intentarlo de nuevo en ${describirEspera(segundos)}.`,
    bloqueado: true,
    segundos_restantes: segundos,
    bloqueado_hasta: new Date(Date.now() + segundos * 1000).toISOString(),
  });
}

// Segundos de bloqueo que le quedan a la cuenta (0 si no está bloqueada)
const SQL_SEGUNDOS_BLOQUEO = "COALESCE(GREATEST(TIMESTAMPDIFF(SECOND, NOW(), bloqueado_hasta), 0), 0)";

// Suma un intento fallido; al llegar a MAX_INTENTOS bloquea y reinicia el
// contador (así, al vencer el bloqueo, vuelve a tener MAX_INTENTOS intentos).
// Devuelve los segundos de bloqueo si esta falla bloqueó la cuenta, o 0.
async function registrarFallo(usuarioId) {
  // En MariaDB las asignaciones se evalúan en orden: bloqueado_hasta usa el contador anterior
  await pool.query(
    `UPDATE usuarios
     SET bloqueado_hasta = IF(intentos_fallidos + 1 >= ?, NOW() + INTERVAL ? MINUTE, bloqueado_hasta),
         intentos_fallidos = IF(intentos_fallidos + 1 >= ?, 0, intentos_fallidos + 1)
     WHERE id = ?`,
    [MAX_INTENTOS, BLOQUEO_MINUTOS, MAX_INTENTOS, usuarioId]
  );
  const [[fila]] = await pool.query(`SELECT ${SQL_SEGUNDOS_BLOQUEO} AS segundos FROM usuarios WHERE id = ?`, [usuarioId]);
  return Number(fila.segundos);
}

async function desbloquear(usuarioId) {
  const [result] = await pool.query("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?", [
    usuarioId,
  ]);
  return result.affectedRows > 0;
}

// --- Recuperación de contraseña ---

// Crea un token nuevo (e invalida los anteriores sin usar). Devuelve
// { token, enlace } o null si el correo no existe; quien llama responde
// siempre lo mismo para no revelar qué correos están registrados.
async function solicitarRecuperacion(email) {
  const [usuarios] = await pool.query("SELECT id, email FROM usuarios WHERE email = ?", [email]);
  if (usuarios.length === 0) {
    console.log(`[recuperacion] Solicitud para un correo no registrado (no se genera token)`);
    return null;
  }
  const usuario = usuarios[0];
  const token = crypto.randomBytes(24).toString("base64url");
  await pool.query("UPDATE password_resets SET usado_en = NOW() WHERE usuario_id = ? AND usado_en IS NULL", [usuario.id]);
  await pool.query(
    "INSERT INTO password_resets (usuario_id, token_hash, expira_en) VALUES (?, ?, NOW() + INTERVAL ? MINUTE)",
    [usuario.id, sha256(token), RESET_MINUTOS]
  );
  const enlace = `${WEB_URL}/restablecer?token=${token}`;
  console.log(
    `[recuperacion] SIMULACIÓN (no se envía correo) para ${usuario.email}: ${enlace} ` +
      `| código para la app: ${token} | vence en ${RESET_MINUTOS} min`
  );
  return { token, enlace };
}

// Cambia la contraseña con un token válido y lo deja usado. Devuelve
// { error, status } si el token no sirve o la contraseña no cumple.
async function confirmarRecuperacion(token, password) {
  if (passwordCorta(password)) return { status: 400, error: MENSAJE_PASSWORD_CORTA };
  if (typeof token !== "string" || !token) return { status: 400, error: "Falta el código de recuperación" };

  const hashNuevo = await bcrypt.hash(password, 10);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Se marca usado en la misma sentencia que lo valida: dos usos simultáneos no pueden pasar ambos
    const [usado] = await conn.query(
      "UPDATE password_resets SET usado_en = NOW() WHERE token_hash = ? AND usado_en IS NULL AND expira_en > NOW()",
      [sha256(token)]
    );
    if (usado.affectedRows === 0) {
      await conn.rollback();
      const [[fila]] = await pool.query(
        "SELECT usado_en IS NOT NULL AS usado, expira_en <= NOW() AS vencido FROM password_resets WHERE token_hash = ?",
        [sha256(token)]
      );
      if (!fila) return { status: 400, error: "El enlace de recuperación no es válido" };
      if (fila.usado) return { status: 400, error: "Este enlace de recuperación ya se usó o fue reemplazado por uno más nuevo" };
      return { status: 400, error: "El enlace de recuperación venció: solicita uno nuevo" };
    }
    // También levanta un bloqueo por intentos: quien recupera la cuenta puede entrar de inmediato
    await conn.query(
      `UPDATE usuarios u JOIN password_resets pr ON pr.usuario_id = u.id
       SET u.password_hash = ?, u.intentos_fallidos = 0, u.bloqueado_hasta = NULL
       WHERE pr.token_hash = ?`,
      [hashNuevo, sha256(token)]
    );
    await conn.commit();
    return {};
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  MAX_INTENTOS,
  MENSAJE_SOLICITUD,
  MOSTRAR_TOKEN,
  MENSAJE_PASSWORD_CORTA,
  passwordCorta,
  SQL_SEGUNDOS_BLOQUEO,
  responderBloqueo,
  registrarFallo,
  desbloquear,
  solicitarRecuperacion,
  confirmarRecuperacion,
};
