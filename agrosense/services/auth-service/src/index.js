require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");
const { verificarJWT, soloAdmin } = require("./verificarJWT");
const seguridad = require("./seguridadLogin");

const app = express();
app.use(cors());
app.use(express.json());

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Salud del servicio (útil para healthchecks/monitoreo)
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "auth-service" });
});

// El auto-registro (web y app) es público y siempre crea agricultores; crear
// cualquier otro rol (admin, agrónomo) exige el JWT de un administrador.
function registroPublicoOAdmin(req, res, next) {
  if ((req.body || {}).rol === "agricultor") return next();
  verificarJWT(req, res, () => soloAdmin(req, res, next));
}

// Permisos sobre /usuarios/:id
function soloPropioUsuario(req, res, next) {
  if (String(req.usuario.id) === String(req.params.id)) return next();
  res.status(403).json({ error: "Solo puedes editar tu propio perfil" });
}

function mismoUsuarioOAdmin(req, res, next) {
  if (req.usuario.rol === "admin" || String(req.usuario.id) === String(req.params.id)) return next();
  res.status(403).json({ error: "Solo puedes consultar tu propio usuario" });
}

// Registro de usuario (administrador o agricultor, según RF-01 / RF-08)
app.post("/api/auth/register", registroPublicoOAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "El correo no tiene un formato válido" });
    }
    if (seguridad.passwordCorta(password)) {
      return res.status(400).json({ error: seguridad.MENSAJE_PASSWORD_CORTA });
    }

    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)",
      [nombre, email, hash, rol]
    );

    res.status(201).json({ id: result.insertId, nombre, email, rol });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al registrar usuario" });
  }
});

// Login (RF-01). Tras MAX_INTENTOS fallos seguidos la cuenta queda bloqueada
// (423 con el tiempo restante, ver seguridadLogin.js); mientras dure, ni la
// contraseña correcta entra.
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query(
      `SELECT *, ${seguridad.SQL_SEGUNDOS_BLOQUEO} AS segundos_bloqueo FROM usuarios WHERE email = ?`,
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const usuario = rows[0];
    if (usuario.segundos_bloqueo > 0) return seguridad.responderBloqueo(res, Number(usuario.segundos_bloqueo));

    const passwordOk = await bcrypt.compare(String(password || ""), usuario.password_hash);
    if (!passwordOk) {
      const segundos = await seguridad.registrarFallo(usuario.id);
      if (segundos > 0) return seguridad.responderBloqueo(res, segundos, true);
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    // login correcto: se reinician los intentos fallidos
    if (usuario.intentos_fallidos > 0 || usuario.bloqueado_hasta) await seguridad.desbloquear(usuario.id);

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol, email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, foto_url: usuario.foto_url },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

// --- Recuperación de contraseña (pública, sin JWT) ---
// Simulación: no se envía correo; el enlace queda en los logs de este servicio
// y, solo con DEV_SHOW_RESET_TOKEN=true, también va en la respuesta.

// Responde siempre lo mismo, exista o no el correo
app.post("/api/auth/recuperar", async (req, res) => {
  try {
    const email = String((req.body || {}).email || "").trim();
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "El correo no tiene un formato válido" });
    }
    const creado = await seguridad.solicitarRecuperacion(email);
    const respuesta = { mensaje: seguridad.MENSAJE_SOLICITUD };
    if (seguridad.MOSTRAR_TOKEN && creado) {
      respuesta.dev_token = creado.token;
      respuesta.dev_enlace = creado.enlace;
    }
    res.json(respuesta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo procesar la solicitud" });
  }
});

// Define la contraseña nueva con el token (de un solo uso, vence a los 30 min)
app.post("/api/auth/restablecer", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const resultado = await seguridad.confirmarRecuperacion(token, password);
    if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });
    res.json({ mensaje: "Contraseña actualizada. Ya puedes iniciar sesión." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo restablecer la contraseña" });
  }
});

// --- De aquí en adelante todo requiere sesión (JWT) ---
app.use(verificarJWT);

// Usuario de la sesión actual
app.get("/api/auth/me", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre, email, rol, foto_url, creado_en FROM usuarios WHERE id = ?",
      [req.usuario.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el usuario" });
  }
});

// Listado de usuarios (para el panel de administración)
app.get("/api/auth/usuarios", soloAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, email, rol, foto_url, creado_en, intentos_fallidos,
              ${seguridad.SQL_SEGUNDOS_BLOQUEO} AS segundos_bloqueo
       FROM usuarios ORDER BY creado_en DESC`
    );
    res.json(rows.map((u) => ({ ...u, segundos_bloqueo: Number(u.segundos_bloqueo), bloqueado: u.segundos_bloqueo > 0 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar usuarios" });
  }
});

// Un solo usuario (para precargar el formulario de edición/perfil)
app.get("/api/auth/usuarios/:id", mismoUsuarioOAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre, email, rol, foto_url, creado_en FROM usuarios WHERE id = ?",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el usuario" });
  }
});

// Editar usuario (nombre/email/rol; la contraseña solo se toca si se envía)
app.put("/api/auth/usuarios/:id", soloAdmin, async (req, res) => {
  try {
    const { nombre, email, rol, password } = req.body;
    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "El correo no tiene un formato válido" });
    }
    if (password && seguridad.passwordCorta(password)) {
      return res.status(400).json({ error: seguridad.MENSAJE_PASSWORD_CORTA });
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE usuarios SET nombre = ?, email = ?, rol = ?, password_hash = ? WHERE id = ?",
        [nombre, email, rol, hash, req.params.id]
      );
    } else {
      await pool.query(
        "UPDATE usuarios SET nombre = ?, email = ?, rol = ? WHERE id = ?",
        [nombre, email, rol, req.params.id]
      );
    }

    res.json({ id: Number(req.params.id), nombre, email, rol });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al editar usuario" });
  }
});

// El propio usuario edita su perfil (email/contraseña/foto), cada campo
// de forma independiente. Cambiar el correo o la contraseña exige la
// contraseña actual para confirmar identidad; la foto no, porque no es
// un dato sensible de acceso a la cuenta.
app.put("/api/auth/usuarios/:id/perfil", soloPropioUsuario, async (req, res) => {
  try {
    const { email, password_actual, password_nueva, foto_url } = req.body;
    const cambiaCredenciales = Boolean(email) || Boolean(password_nueva);

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "El correo no tiene un formato válido" });
    }
    if (password_nueva && seguridad.passwordCorta(password_nueva)) {
      return res.status(400).json({ error: seguridad.MENSAJE_PASSWORD_CORTA });
    }

    const [rows] = await pool.query("SELECT * FROM usuarios WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const usuario = rows[0];

    if (cambiaCredenciales) {
      if (!password_actual) {
        return res.status(400).json({ error: "Debes indicar tu contraseña actual" });
      }
      const passwordOk = await bcrypt.compare(password_actual, usuario.password_hash);
      if (!passwordOk) {
        return res.status(401).json({ error: "La contraseña actual no es correcta" });
      }
    }

    const nuevoEmail = email || usuario.email;
    const nuevaFoto = foto_url !== undefined ? foto_url : usuario.foto_url;
    const nuevoHash = password_nueva ? await bcrypt.hash(password_nueva, 10) : usuario.password_hash;

    await pool.query("UPDATE usuarios SET email = ?, foto_url = ?, password_hash = ? WHERE id = ?", [
      nuevoEmail,
      nuevaFoto,
      nuevoHash,
      req.params.id,
    ]);

    res.json({ id: usuario.id, nombre: usuario.nombre, email: nuevoEmail, rol: usuario.rol, foto_url: nuevaFoto });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el perfil" });
  }
});

// Desbloquear una cuenta bloqueada por intentos fallidos (solo admin)
app.put("/api/auth/usuarios/:id/desbloquear", soloAdmin, async (req, res) => {
  try {
    if (!(await seguridad.desbloquear(req.params.id))) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ id: Number(req.params.id), bloqueado: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al desbloquear la cuenta" });
  }
});

// Eliminar usuario (bloqueado si es dueño de alguna finca)
app.delete("/api/auth/usuarios/:id", soloAdmin, async (req, res) => {
  try {
    const [fincas] = await pool.query("SELECT COUNT(*) AS total FROM fincas WHERE usuario_id = ?", [
      req.params.id,
    ]);
    if (fincas[0].total > 0) {
      return res.status(409).json({ error: "No se puede eliminar: el usuario tiene fincas asociadas" });
    }

    const [result] = await pool.query("DELETE FROM usuarios WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`auth-service escuchando en puerto ${PORT}`);
});
