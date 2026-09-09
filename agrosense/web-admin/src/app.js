require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
app.set("view engine", "ejs");
app.set("views", __dirname + "/../views");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + "/../public"));
app.use(cookieParser());

const AUTH_URL = process.env.AUTH_SERVICE_URL;
const FINCAS_URL = process.env.FINCAS_SERVICE_URL;

const AVATARS_DIR = path.join(__dirname, "../public/uploads/avatars");
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: AVATARS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `usuario-${req.usuario.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return cb(new Error("Formato de imagen no soportado"));
    }
    cb(null, true);
  },
});

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    let perfil = {};
    try {
      perfil = JSON.parse(req.cookies.usuario || "{}");
    } catch (e) {
      perfil = {};
    }
    res.locals.usuario = { ...req.usuario, ...perfil };
    next();
  } catch (err) {
    res.clearCookie("token");
    res.clearCookie("usuario");
    res.redirect("/login");
  }
}

function requireAdmin(req, res, next) {
  if (req.usuario?.rol !== "admin") return res.redirect("/dashboard");
  next();
}

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data } = await axios.post(`${AUTH_URL}/api/auth/login`, { email, password });
    res.cookie("token", data.token, { httpOnly: true });
    res.cookie("usuario", JSON.stringify(data.usuario));
    res.redirect("/dashboard");
  } catch (err) {
    res.render("login", { error: "Credenciales inválidas" });
  }
});

app.get("/register", (req, res) => {
  res.render("register", { error: null, success: false });
});

app.post("/register", async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    // El auto-registro público siempre crea cuentas de agricultor;
    // los administradores se crean desde /usuarios (ver requireAdmin).
    await axios.post(`${AUTH_URL}/api/auth/register`, { nombre, email, password, rol: "agricultor" });
    res.render("register", { error: null, success: true });
  } catch (err) {
    const mensaje = err.response?.data?.error || "No se pudo completar el registro";
    res.render("register", { error: mensaje, success: false });
  }
});

app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const [{ data: resumen }, { data: historial }] = await Promise.all([
      axios.get(`${FINCAS_URL}/api/dashboard/resumen`),
      axios.get(`${FINCAS_URL}/api/dashboard/humedad-historial?dias=7`),
    ]);
    res.render("dashboard", { active: "dashboard", resumen, historial });
  } catch (err) {
    console.error(err.message);
    res.render("dashboard", {
      active: "dashboard",
      resumen: { estaciones_activas: 0, alertas_hoy: 0, humedad_promedio: 0, temperatura_promedio: 0 },
      historial: [],
    });
  }
});

async function cargarFincasView(extra = {}) {
  const { data: fincas } = await axios.get(`${FINCAS_URL}/api/fincas`);
  return { active: "fincas", fincas, error: null, ...extra };
}

app.get("/fincas", requireAuth, async (req, res) => {
  try {
    res.render("fincas", await cargarFincasView());
  } catch (err) {
    console.error(err.message);
    res.render("fincas", { active: "fincas", fincas: [], error: null });
  }
});

app.post("/fincas", requireAuth, async (req, res) => {
  const { nombre, ubicacion } = req.body;
  try {
    await axios.post(`${FINCAS_URL}/api/fincas`, { nombre, ubicacion, usuario_id: req.usuario.id });
    res.redirect("/fincas");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo crear la finca";
    res.render("fincas", await cargarFincasView({ error: mensaje }));
  }
});

app.post("/fincas/:id/editar", requireAuth, async (req, res) => {
  const { nombre, ubicacion } = req.body;
  try {
    await axios.put(`${FINCAS_URL}/api/fincas/${req.params.id}`, { nombre, ubicacion });
    res.redirect("/fincas");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo editar la finca";
    res.render("fincas", await cargarFincasView({ error: mensaje }));
  }
});

app.post("/fincas/:id/eliminar", requireAuth, async (req, res) => {
  try {
    await axios.delete(`${FINCAS_URL}/api/fincas/${req.params.id}`);
    res.redirect("/fincas");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo eliminar la finca";
    res.render("fincas", await cargarFincasView({ error: mensaje }));
  }
});

async function cargarParcelasView(fincaIdSolicitada, extra = {}) {
  const { data: fincas } = await axios.get(`${FINCAS_URL}/api/fincas`);
  const fincaActiva = fincas.find((f) => String(f.id) === String(fincaIdSolicitada)) || fincas[0];
  let parcelas = [];
  if (fincaActiva) {
    const { data } = await axios.get(`${FINCAS_URL}/api/fincas/${fincaActiva.id}/parcelas`);
    parcelas = data;
  }
  return { active: "parcelas", fincas, fincaActiva, parcelas, error: null, ...extra };
}

app.get("/parcelas", requireAuth, async (req, res) => {
  try {
    res.render("parcelas", await cargarParcelasView(req.query.finca));
  } catch (err) {
    console.error(err.message);
    res.render("parcelas", { active: "parcelas", fincas: [], fincaActiva: null, parcelas: [], error: null });
  }
});

app.post("/parcelas", requireAuth, async (req, res) => {
  const { nombre, finca_id, humedad_min, humedad_max, temperatura_max } = req.body;
  try {
    await axios.post(`${FINCAS_URL}/api/parcelas`, {
      nombre,
      finca_id,
      humedad_min,
      humedad_max,
      temperatura_max,
    });
    res.redirect(`/parcelas?finca=${finca_id}`);
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo crear la parcela";
    res.render("parcelas", await cargarParcelasView(finca_id, { error: mensaje }));
  }
});

app.post("/parcelas/:id/editar", requireAuth, async (req, res) => {
  const { nombre, humedad_min, humedad_max, temperatura_max, finca_id } = req.body;
  try {
    await axios.put(`${FINCAS_URL}/api/parcelas/${req.params.id}`, {
      nombre,
      humedad_min,
      humedad_max,
      temperatura_max,
    });
    res.redirect(`/parcelas?finca=${finca_id}`);
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo editar la parcela";
    res.render("parcelas", await cargarParcelasView(finca_id, { error: mensaje }));
  }
});

app.post("/parcelas/:id/eliminar", requireAuth, async (req, res) => {
  const { finca_id } = req.body;
  try {
    await axios.delete(`${FINCAS_URL}/api/parcelas/${req.params.id}`);
    res.redirect(`/parcelas?finca=${finca_id}`);
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo eliminar la parcela";
    res.render("parcelas", await cargarParcelasView(finca_id, { error: mensaje }));
  }
});

async function cargarSensoresView(extra = {}) {
  const [{ data: estaciones }, { data: tokens }, { data: parcelas }] = await Promise.all([
    axios.get(`${FINCAS_URL}/api/estaciones`),
    axios.get(`${FINCAS_URL}/api/sensores/tokens`),
    axios.get(`${FINCAS_URL}/api/parcelas`),
  ]);
  return {
    active: "sensores",
    estaciones,
    tokens,
    parcelas,
    tokenGenerado: null,
    error: null,
    ...extra,
  };
}

app.get("/sensores", requireAuth, async (req, res) => {
  try {
    res.render("sensores", await cargarSensoresView());
  } catch (err) {
    console.error(err.message);
    res.render("sensores", { active: "sensores", estaciones: [], tokens: [], parcelas: [], tokenGenerado: null, error: null });
  }
});

// El admin genera un token de un solo uso para vincular un sensor a una parcela
app.post("/sensores/tokens", requireAuth, requireAdmin, async (req, res) => {
  const { parcela_id } = req.body;
  try {
    const { data: tokenGenerado } = await axios.post(`${FINCAS_URL}/api/sensores/tokens`, { parcela_id });
    res.render("sensores", await cargarSensoresView({ tokenGenerado }));
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo generar el token";
    res.render("sensores", await cargarSensoresView({ error: mensaje }));
  }
});

app.post("/sensores/tokens/:id/revocar", requireAuth, requireAdmin, async (req, res) => {
  try {
    await axios.delete(`${FINCAS_URL}/api/sensores/tokens/${req.params.id}`);
  } catch (err) {
    console.error(err.message);
  }
  res.redirect("/sensores");
});

app.post("/sensores/:id/editar", requireAuth, requireAdmin, async (req, res) => {
  const { codigo } = req.body;
  try {
    await axios.put(`${FINCAS_URL}/api/estaciones/${req.params.id}`, { codigo });
    res.redirect("/sensores");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo editar el sensor";
    res.render("sensores", await cargarSensoresView({ error: mensaje }));
  }
});

app.post("/sensores/:id/eliminar", requireAuth, requireAdmin, async (req, res) => {
  try {
    await axios.delete(`${FINCAS_URL}/api/estaciones/${req.params.id}`);
    res.redirect("/sensores");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo eliminar el sensor";
    res.render("sensores", await cargarSensoresView({ error: mensaje }));
  }
});

async function cargarUsuariosView(extra = {}) {
  const [{ data: usuarios }, { data: parcelas }, { data: asignaciones }] = await Promise.all([
    axios.get(`${AUTH_URL}/api/auth/usuarios`),
    axios.get(`${FINCAS_URL}/api/parcelas`),
    axios.get(`${FINCAS_URL}/api/asignaciones`),
  ]);

  const parcelasPorUsuario = {};
  const parcelaIdsPorUsuario = {};
  asignaciones.forEach((a) => {
    if (!parcelasPorUsuario[a.usuario_id]) {
      parcelasPorUsuario[a.usuario_id] = [];
      parcelaIdsPorUsuario[a.usuario_id] = [];
    }
    parcelasPorUsuario[a.usuario_id].push(a.parcela_nombre);
    parcelaIdsPorUsuario[a.usuario_id].push(a.parcela_id);
  });

  return {
    active: "usuarios",
    usuarios,
    parcelas,
    parcelasPorUsuario,
    parcelaIdsPorUsuario,
    error: null,
    ...extra,
  };
}

app.get("/usuarios", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.render("usuarios", await cargarUsuariosView());
  } catch (err) {
    console.error(err.message);
    res.render("usuarios", {
      active: "usuarios",
      usuarios: [],
      parcelas: [],
      parcelasPorUsuario: {},
      parcelaIdsPorUsuario: {},
      error: null,
    });
  }
});

app.post("/usuarios", requireAuth, requireAdmin, async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  const parcelaIds = [].concat(req.body.parcela_ids || []);
  try {
    const { data: nuevoUsuario } = await axios.post(`${AUTH_URL}/api/auth/register`, {
      nombre,
      email,
      password,
      rol,
    });
    await axios.put(`${FINCAS_URL}/api/asignaciones/${nuevoUsuario.id}`, { parcela_ids: parcelaIds });
    res.redirect("/usuarios");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo crear el usuario";
    res.render("usuarios", await cargarUsuariosView({ error: mensaje }));
  }
});

app.post("/usuarios/:id/editar", requireAuth, requireAdmin, async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  const parcelaIds = [].concat(req.body.parcela_ids || []);
  try {
    await axios.put(`${AUTH_URL}/api/auth/usuarios/${req.params.id}`, { nombre, email, rol, password });
    await axios.put(`${FINCAS_URL}/api/asignaciones/${req.params.id}`, { parcela_ids: parcelaIds });
    res.redirect("/usuarios");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo editar el usuario";
    res.render("usuarios", await cargarUsuariosView({ error: mensaje }));
  }
});

app.post("/usuarios/:id/eliminar", requireAuth, requireAdmin, async (req, res) => {
  if (String(req.params.id) === String(req.usuario.id)) {
    const mensaje = "No puedes eliminar tu propia cuenta";
    return res.render("usuarios", await cargarUsuariosView({ error: mensaje }));
  }
  try {
    await axios.delete(`${AUTH_URL}/api/auth/usuarios/${req.params.id}`);
    res.redirect("/usuarios");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo eliminar el usuario";
    res.render("usuarios", await cargarUsuariosView({ error: mensaje }));
  }
});

async function renderConfiguracion(req, res, extra = {}) {
  const perfil = await axios
    .get(`${AUTH_URL}/api/auth/usuarios/${req.usuario.id}`)
    .then((r) => r.data)
    .catch(() => res.locals.usuario);
  res.render("configuracion", {
    active: "configuracion",
    perfil,
    section: null,
    error: null,
    success: null,
    ...extra,
  });
}

function actualizarCookiePerfil(req, res, actualizado) {
  const perfilCookie = { ...JSON.parse(req.cookies.usuario || "{}"), ...actualizado };
  res.cookie("usuario", JSON.stringify(perfilCookie));
}

app.get("/configuracion", requireAuth, async (req, res) => {
  await renderConfiguracion(req, res);
});

// Cada aspecto del perfil (foto, correo, contraseña) se guarda por separado:
// así el usuario no tiene que volver a escribir su contraseña actual solo
// para subir una foto, ni tocar el correo si solo quiere cambiar la clave.

app.post(
  "/configuracion/foto",
  requireAuth,
  (req, res, next) => {
    uploadAvatar.single("foto")(req, res, async (err) => {
      if (err) return renderConfiguracion(req, res, { section: "foto", error: err.message });
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return renderConfiguracion(req, res, { section: "foto", error: "Selecciona una imagen" });
    }
    try {
      const { data: actualizado } = await axios.put(`${AUTH_URL}/api/auth/usuarios/${req.usuario.id}/perfil`, {
        foto_url: `/uploads/avatars/${req.file.filename}`,
      });
      actualizarCookiePerfil(req, res, actualizado);
      await renderConfiguracion(req, res, { section: "foto", success: "Foto de perfil actualizada" });
    } catch (err) {
      console.error(err.message);
      const mensaje = err.response?.data?.error || "No se pudo actualizar la foto";
      await renderConfiguracion(req, res, { section: "foto", error: mensaje });
    }
  }
);

app.post("/configuracion/correo", requireAuth, async (req, res) => {
  const { email, password_actual } = req.body;
  try {
    const { data: actualizado } = await axios.put(`${AUTH_URL}/api/auth/usuarios/${req.usuario.id}/perfil`, {
      email,
      password_actual,
    });
    actualizarCookiePerfil(req, res, actualizado);
    await renderConfiguracion(req, res, { section: "correo", success: "Correo actualizado correctamente" });
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo actualizar el correo";
    await renderConfiguracion(req, res, { section: "correo", error: mensaje });
  }
});

app.post("/configuracion/contrasena", requireAuth, async (req, res) => {
  const { password_actual, password_nueva } = req.body;
  try {
    const { data: actualizado } = await axios.put(`${AUTH_URL}/api/auth/usuarios/${req.usuario.id}/perfil`, {
      password_actual,
      password_nueva,
    });
    actualizarCookiePerfil(req, res, actualizado);
    await renderConfiguracion(req, res, { section: "password", success: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo actualizar la contraseña";
    await renderConfiguracion(req, res, { section: "password", error: mensaje });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.clearCookie("usuario");
  res.redirect("/login");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`web-admin escuchando en puerto ${PORT}`);
});
