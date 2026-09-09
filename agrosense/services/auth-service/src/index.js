require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// Salud del servicio (útil para healthchecks/monitoreo)
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "auth-service" });
});

// Registro de usuario (administrador o agricultor, según RF-01 / RF-08)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
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

// Listado de usuarios (para el panel de administración)
app.get("/api/auth/usuarios", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre, email, rol, foto_url, creado_en FROM usuarios ORDER BY creado_en DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar usuarios" });
  }
});

// Un solo usuario (para precargar el formulario de edición/perfil)
app.get("/api/auth/usuarios/:id", async (req, res) => {
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
app.put("/api/auth/usuarios/:id", async (req, res) => {
  try {
    const { nombre, email, rol, password } = req.body;
    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
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
app.put("/api/auth/usuarios/:id/perfil", async (req, res) => {
  try {
    const { email, password_actual, password_nueva, foto_url } = req.body;
    const cambiaCredenciales = Boolean(email) || Boolean(password_nueva);

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

// Eliminar usuario (bloqueado si es dueño de alguna finca)
app.delete("/api/auth/usuarios/:id", async (req, res) => {
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

// Login (RF-01)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query("SELECT * FROM usuarios WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const usuario = rows[0];
    const passwordOk = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`auth-service escuchando en puerto ${PORT}`);
});
