require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const app = express();
app.set("view engine", "ejs");
app.set("views", __dirname + "/../views");
// Mínimo de contraseña (el mismo que valida auth-service): las vistas lo usan
// en minlength y en los textos de ayuda; public/js/password-minimo.js pone el mensaje.
app.locals.passwordMin = 8;
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + "/../public"));
app.use(cookieParser());

// Salud del panel (healthcheck de Docker y Uptime Kuma); no requiere sesión
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "web-admin" });
});

const AUTH_URL = process.env.AUTH_SERVICE_URL;
const FINCAS_URL = process.env.FINCAS_SERVICE_URL;
const LECTURAS_URL = process.env.LECTURAS_SERVICE_URL;
const BACKUP_URL = process.env.BACKUP_SERVICE_URL || "http://backup-service:3000";
const ZONA_HORARIA = process.env.APP_TIMEZONE || "America/Guatemala";
// Todas las fechas visibles se muestran en esta zona (Guatemala), formateen en
// el servidor (que corre en UTC) o en el navegador (que puede estar en otra)
app.locals.zonaHoraria = ZONA_HORARIA;

// Cookies de sesión: con HTTPS (producción, COOKIE_SECURE=true) solo viajan
// cifradas; SameSite=Lax evita que otros sitios las manden en sus formularios.
const OPCIONES_COOKIE = { secure: process.env.COOKIE_SECURE === "true", sameSite: "lax" };
// backup-service puede exigir un token propio (BACKUP_API_TOKEN); el panel lo reenvía
const backupApi = axios.create({
  baseURL: BACKUP_URL,
  headers: process.env.BACKUP_API_TOKEN ? { "x-backup-token": process.env.BACKUP_API_TOKEN } : {},
});

// --- JWT hacia los microservicios ---
// Los servicios rechazan peticiones sin token (ver services/*/src/verificarJWT.js).
// requireAuth/requireBearerAuth guardan el JWT de la petición en "sesion" y estos
// interceptores lo agregan como Authorization: Bearer a cada llamada de axios
// hecha mientras se atiende esa petición, sin pasarlo a mano a cada función.
// Si un servicio responde 401 de sesión (trae WWW-Authenticate: Bearer), se marca
// la sesión como inválida y la respuesta al navegador se convierte en un cierre
// de sesión (ver cerrarSesionSiInvalida).
const sesion = new AsyncLocalStorage();

for (const cliente of [axios, backupApi]) {
  cliente.interceptors.request.use((config) => {
    const actual = sesion.getStore();
    if (actual) config.headers.Authorization = `Bearer ${actual.token}`;
    return config;
  });
  cliente.interceptors.response.use(undefined, (err) => {
    const actual = sesion.getStore();
    const res = err.response;
    if (actual && res && res.status === 401 && /^Bearer/i.test(res.headers["www-authenticate"] || "")) {
      actual.invalida = true;
    }
    return Promise.reject(err);
  });
}

function cerrarSesion(res) {
  res.clearCookie("token");
  res.clearCookie("usuario");
}

// Cada ruta atrapa sus errores y responde (render, json, redirect...). Si
// mientras tanto algún servicio rechazó el token, esa respuesta se cambia por
// "cerrar sesión y volver al login" (o 401 JSON para la app móvil).
function cerrarSesionSiInvalida(req, res, comoJson) {
  const enviar = res.send.bind(res);
  const redirigir = res.redirect.bind(res);
  const invalida = () => req.sesionStore.invalida;
  const responderCierre = () => {
    cerrarSesion(res);
    if (!comoJson) return redirigir("/login?sesion=expirada");
    res.set("WWW-Authenticate", 'Bearer realm="agrosense"');
    res.status(401).type("json");
    return enviar(JSON.stringify({ error: "La sesión ya no es válida: vuelve a iniciar sesión" }));
  };
  res.send = (...args) => (invalida() && !res.headersSent ? responderCierre() : enviar(...args));
  res.redirect = (...args) => (invalida() && !res.headersSent ? responderCierre() : redirigir(...args));
}

// Entra (o vuelve a entrar) al contexto de la sesión. multer avisa que terminó
// desde eventos del stream, donde ese contexto se pierde: por eso las rutas con
// subida de archivos llaman de nuevo a conSesion dentro de su callback.
function conSesion(req, res, next) {
  sesion.run(req.sesionStore, next);
}

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
    if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"].includes(file.mimetype)) {
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
    req.sesionStore = { token, invalida: false };
    cerrarSesionSiInvalida(req, res, false);
    let perfil = {};
    try {
      perfil = JSON.parse(req.cookies.usuario || "{}");
    } catch (e) {
      perfil = {};
    }
    res.locals.usuario = { ...req.usuario, ...perfil };
  } catch (err) {
    cerrarSesion(res);
    return res.redirect("/login");
  }
  conSesion(req, res, next);
}

function requireAdmin(req, res, next) {
  if (req.usuario?.rol !== "admin") return res.redirect("/dashboard");
  next();
}

// Igual que requireAuth pero para clientes de API (la app móvil): no hay
// cookies de sesión, así que la identidad viaja en la cabecera
// Authorization: Bearer <token> y la respuesta es siempre JSON.
function requireBearerAuth(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  res.set("WWW-Authenticate", 'Bearer realm="agrosense"');
  if (!token) return res.status(401).json({ error: "Falta el token de autenticación" });
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  res.removeHeader("WWW-Authenticate");
  req.sesionStore = { token, invalida: false };
  cerrarSesionSiInvalida(req, res, true);
  conSesion(req, res, next);
}

// Sube la foto de perfil desde la app móvil y reutiliza exactamente el
// mismo almacenamiento (uploadAvatar) y el mismo PUT de perfil que usa
// /configuracion/foto en el panel web, para que ambos clientes vean
// siempre la misma foto.
app.post(
  "/api/perfil/foto",
  requireBearerAuth,
  (req, res, next) => {
    uploadAvatar.single("foto")(req, res, (err) =>
      conSesion(req, res, () => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      })
    );
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Selecciona una imagen" });
    try {
      const { data: actualizado } = await axios.put(`${AUTH_URL}/api/auth/usuarios/${req.usuario.id}/perfil`, {
        foto_url: `/uploads/avatars/${req.file.filename}`,
      });
      res.json(actualizado);
    } catch (err) {
      console.error(err.message);
      const mensaje = err.response?.data?.error || "No se pudo actualizar la foto";
      res.status(500).json({ error: mensaje });
    }
  }
);

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  const error = req.query.sesion === "expirada" ? "Tu sesión expiró o ya no es válida. Vuelve a iniciar sesión." : null;
  const mensaje = req.query.restablecida === "1" ? "Contraseña actualizada. Ya puedes iniciar sesión." : null;
  res.render("login", { error, mensaje });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data } = await axios.post(`${AUTH_URL}/api/auth/login`, { email, password });
    res.cookie("token", data.token, { ...OPCIONES_COOKIE, httpOnly: true });
    res.cookie("usuario", JSON.stringify(data.usuario), OPCIONES_COOKIE);
    res.redirect("/dashboard");
  } catch (err) {
    // 423 = cuenta bloqueada por intentos fallidos: el mensaje trae el tiempo restante.
    // No se tocan las cookies: si en este navegador ya había otra sesión, sigue abierta.
    const mensaje = err.response?.status === 423 ? err.response.data.error : "Credenciales inválidas";
    res.render("login", { error: mensaje, mensaje: null });
  }
});

// --- Recuperación de contraseña (pública; la lógica vive en auth-service) ---

app.get("/olvide", (req, res) => {
  res.render("olvide", { error: null, mensaje: null, devEnlace: null, email: "" });
});

app.post("/olvide", async (req, res) => {
  const email = String(req.body.email || "").trim();
  try {
    const { data } = await axios.post(`${AUTH_URL}/api/auth/recuperar`, { email });
    // dev_enlace solo llega con DEV_SHOW_RESET_TOKEN=true (sin servidor de correo)
    res.render("olvide", { error: null, mensaje: data.mensaje, devEnlace: data.dev_enlace || null, email });
  } catch (err) {
    const mensaje = err.response?.data?.error || "No se pudo procesar la solicitud";
    res.render("olvide", { error: mensaje, mensaje: null, devEnlace: null, email });
  }
});

function renderRestablecer(res, token, error = null) {
  res.set("Cache-Control", "no-store");
  res.render("restablecer", { token, error });
}

app.get("/restablecer", (req, res) => renderRestablecer(res, String(req.query.token || "")));

app.post("/restablecer", async (req, res) => {
  const token = String(req.body.token || "");
  const { password, confirmacion } = req.body;
  if (password !== confirmacion) return renderRestablecer(res, token, "Las contraseñas no coinciden");
  try {
    await axios.post(`${AUTH_URL}/api/auth/restablecer`, { token, password });
    res.redirect("/login?restablecida=1");
  } catch (err) {
    renderRestablecer(res, token, err.response?.data?.error || "No se pudo restablecer la contraseña");
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

// Datos opcionales del dashboard: si un servicio no responde, su tarjeta
// muestra "sin datos" en vez de tumbar toda la página.
const opcional = (promesa) => promesa.then((r) => r.data).catch(() => null);

app.get("/dashboard", requireAuth, async (req, res) => {
  const esAdmin = req.usuario.rol === "admin";
  const [conteoAlertas, clima, respaldo] = await Promise.all([
    opcional(axios.get(`${LECTURAS_URL}/api/alertas/conteo`, { params: { usuario_id: req.usuario.id } })),
    opcional(axios.get(`${LECTURAS_URL}/api/clima`)),
    esAdmin ? opcional(backupApi.get("/backups/config")) : Promise.resolve(null),
  ]);
  try {
    const [{ data: resumen }, { data: historial }] = await Promise.all([
      axios.get(`${FINCAS_URL}/api/dashboard/resumen`, { params: { usuario_id: req.usuario.id } }),
      axios.get(`${FINCAS_URL}/api/dashboard/humedad-historial?dias=7`),
    ]);
    res.render("dashboard", { active: "dashboard", resumen, historial, conteoAlertas, clima, respaldo, esAdmin });
  } catch (err) {
    console.error(err.message);
    res.render("dashboard", {
      active: "dashboard",
      resumen: { estaciones_activas: 0, alertas_hoy: 0, humedad_promedio: 0, temperatura_promedio: 0, cultivos_activos: 0, riegos_en_curso: 0 },
      historial: [],
      conteoAlertas,
      clima,
      respaldo,
      esAdmin,
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

const ESTADOS_CULTIVO = { sembrado: "Sembrado", en_crecimiento: "En crecimiento", cosechado: "Cosechado" };
const UNIDADES_CULTIVO = ["plantas", "kg", "quintales"];

async function cargarParcelasView(fincaIdSolicitada, extra = {}) {
  const { data: fincas } = await axios.get(`${FINCAS_URL}/api/fincas`);
  const fincaActiva = fincas.find((f) => String(f.id) === String(fincaIdSolicitada)) || fincas[0];
  let parcelas = [];
  let cultivos = [];
  if (fincaActiva) {
    const [resParcelas, resCultivos] = await Promise.all([
      axios.get(`${FINCAS_URL}/api/fincas/${fincaActiva.id}/parcelas`),
      // los cultivos son un extra de la página: si fallan, se muestra la finca igual
      axios.get(`${FINCAS_URL}/api/fincas/${fincaActiva.id}/cultivos`).catch(() => ({ data: null })),
    ]);
    parcelas = resParcelas.data;
    cultivos = resCultivos.data;
  }
  return { active: "parcelas", fincas, fincaActiva, parcelas, cultivos, estadosCultivo: ESTADOS_CULTIVO, error: null, ...extra };
}

app.get("/parcelas", requireAuth, async (req, res) => {
  try {
    res.render("parcelas", await cargarParcelasView(req.query.finca));
  } catch (err) {
    console.error(err.message);
    res.render("parcelas", { active: "parcelas", fincas: [], fincaActiva: null, parcelas: [], cultivos: [], estadosCultivo: ESTADOS_CULTIVO, error: null });
  }
});

app.post("/parcelas", requireAuth, async (req, res) => {
  const { nombre, finca_id, humedad_min, humedad_max, temperatura_max, temperatura_min } = req.body;
  try {
    await axios.post(`${FINCAS_URL}/api/parcelas`, {
      nombre,
      finca_id,
      humedad_min,
      humedad_max,
      temperatura_max,
      temperatura_min,
    });
    res.redirect(`/parcelas?finca=${finca_id}`);
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo crear la parcela";
    res.render("parcelas", await cargarParcelasView(finca_id, { error: mensaje }));
  }
});

app.post("/parcelas/:id/editar", requireAuth, async (req, res) => {
  const { nombre, humedad_min, humedad_max, temperatura_max, temperatura_min, finca_id } = req.body;
  try {
    await axios.put(`${FINCAS_URL}/api/parcelas/${req.params.id}`, {
      nombre,
      humedad_min,
      humedad_max,
      temperatura_max,
      temperatura_min,
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

// --- Inventario de cultivos ---
// Cada cultivo es de una finca y, opcionalmente, de una de sus parcelas
// (sin parcela = "Toda la finca"). fincas-service aplica los permisos con el
// JWT: el dueño de la finca gestiona todo lo de ella; el agrónomo solo los
// cultivos de sus parcelas asignadas (nunca los de la finca completa).

const CAMPOS_CULTIVO = [
  "finca_id", "parcela_id", "tipo", "variedad", "fecha_siembra", "fecha_cosecha_estimada", "cantidad", "unidad", "estado", "notas",
];

async function parcelasDisponibles(usuario) {
  const url = usuario.rol === "agronomo" ? `/api/usuarios/${usuario.id}/parcelas` : "/api/parcelas";
  const { data } = await axios.get(`${FINCAS_URL}${url}`);
  return data.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    finca_id: p.finca_id,
    finca_nombre: p.finca_nombre,
    riego_automatico: Boolean(p.riego_automatico),
  }));
}

function filtrosCultivos(fuente) {
  return { finca: fuente.finca || "", parcela: fuente.parcela || "", estado: fuente.estado || "" };
}

function urlCultivos(filtros) {
  const query = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
  return query ? `/cultivos?${query}` : "/cultivos";
}

// Fincas donde el usuario puede registrar cultivos. "propia" = puede usar
// "Toda la finca" (admin, o el dueño si no es agrónomo); en las demás hay
// que elegir una de sus parcelas.
async function fincasParaCultivos(usuario, parcelas) {
  if (usuario.rol === "agronomo") {
    const fincas = [];
    parcelas.forEach((p) => {
      if (!fincas.some((f) => f.id === p.finca_id)) fincas.push({ id: p.finca_id, nombre: p.finca_nombre, propia: false });
    });
    return fincas;
  }
  const { data } = await axios.get(`${FINCAS_URL}/api/fincas`);
  return data.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    propia: usuario.rol === "admin" || String(f.usuario_id) === String(usuario.id),
  }));
}

async function cargarCultivosView(usuario, filtros, extra = {}) {
  const parcelas = await parcelasDisponibles(usuario);
  const params = {};
  if (filtros.finca) params.finca_id = filtros.finca;
  if (filtros.parcela) params.parcela_id = filtros.parcela; // "ninguna" = solo los de toda la finca
  if (filtros.estado) params.estado = filtros.estado;
  const [{ data: cultivos }, fincas] = await Promise.all([
    axios.get(`${FINCAS_URL}/api/cultivos`, { params }),
    fincasParaCultivos(usuario, parcelas),
  ]);

  return {
    active: "cultivos",
    cultivos,
    parcelas,
    fincas,
    filtros,
    estados: ESTADOS_CULTIVO,
    unidades: UNIDADES_CULTIVO,
    esAgronomo: usuario.rol === "agronomo",
    error: null,
    formulario: null,
    ...extra,
  };
}

function datosCultivo(body) {
  const datos = {};
  CAMPOS_CULTIVO.forEach((campo) => (datos[campo] = body[campo]));
  return datos;
}

// Si la API rechaza el formulario, se vuelve a mostrar con el error y con
// el modal abierto y los valores que la persona ya había escrito.
async function renderErrorCultivo(req, res, err, fallback, id = null) {
  console.error(err.message);
  const mensaje = err.response?.data?.error || fallback;
  const filtros = filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado });
  try {
    res.render("cultivos", await cargarCultivosView(req.usuario, filtros, { error: mensaje, formulario: { ...req.body, id } }));
  } catch (e) {
    console.error(e.message);
    res.redirect(urlCultivos(filtros));
  }
}

app.get("/cultivos", requireAuth, async (req, res) => {
  const filtros = filtrosCultivos(req.query);
  try {
    res.render("cultivos", await cargarCultivosView(req.usuario, filtros));
  } catch (err) {
    console.error(err.message);
    res.render("cultivos", {
      active: "cultivos", cultivos: [], parcelas: [], fincas: [], filtros, estados: ESTADOS_CULTIVO,
      unidades: UNIDADES_CULTIVO, esAgronomo: req.usuario.rol === "agronomo",
      error: "No se pudieron cargar los cultivos", formulario: null,
    });
  }
});

app.post("/cultivos", requireAuth, async (req, res) => {
  try {
    await axios.post(`${FINCAS_URL}/api/cultivos`, datosCultivo(req.body));
    res.redirect(urlCultivos(filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado })));
  } catch (err) {
    await renderErrorCultivo(req, res, err, "No se pudo crear el cultivo");
  }
});

app.post("/cultivos/:id/editar", requireAuth, async (req, res) => {
  try {
    await axios.put(`${FINCAS_URL}/api/cultivos/${req.params.id}`, datosCultivo(req.body));
    res.redirect(urlCultivos(filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado })));
  } catch (err) {
    await renderErrorCultivo(req, res, err, "No se pudo editar el cultivo", req.params.id);
  }
});

app.post("/cultivos/:id/eliminar", requireAuth, async (req, res) => {
  const filtros = filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado });
  try {
    await axios.delete(`${FINCAS_URL}/api/cultivos/${req.params.id}`);
    res.redirect(urlCultivos(filtros));
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo eliminar el cultivo";
    res.render("cultivos", await cargarCultivosView(req.usuario, filtros, { error: mensaje }));
  }
});

// --- Programación de riego ---
// Mismos permisos que cultivos: el agrónomo solo ve y opera sus parcelas
// asignadas, y el usuario_id viaja en cada petición para que fincas-service
// aplique la regla también al escribir.

function filtrosRiego(fuente) {
  return {
    finca: fuente.finca || "",
    b_parcela: fuente.b_parcela || "",
    desde: fuente.desde || "",
    hasta: fuente.hasta || "",
    origen: fuente.origen || "",
  };
}

// Las acciones vuelven a la misma vista (con sus filtros); solo se aceptan
// rutas de /riego para no convertir el formulario en una redirección abierta.
function volverARiego(valor) {
  return typeof valor === "string" && /^\/riego(\?|$)/.test(valor) ? valor : "/riego";
}

async function humedadPorParcela(usuario, parcelas) {
  const filas =
    usuario.rol === "agronomo"
      ? (await axios.get(`${FINCAS_URL}/api/usuarios/${usuario.id}/parcelas`)).data
      : (
          await Promise.all(
            [...new Set(parcelas.map((p) => p.finca_id))].map((fincaId) =>
              axios.get(`${FINCAS_URL}/api/fincas/${fincaId}/parcelas`).then((r) => r.data)
            )
          )
        ).flat();
  const mapa = {};
  filas.forEach((p) => (mapa[p.id] = { humedad: p.humedad_actual, humedad_min: Number(p.humedad_min) }));
  return mapa;
}

async function cargarRiegoView(usuario, filtros, extra = {}) {
  const params = { usuario_id: usuario.id };
  const paramsBitacora = { ...params, limit: 100 };
  if (filtros.b_parcela) paramsBitacora.parcela_id = filtros.b_parcela;
  if (filtros.desde) paramsBitacora.desde = filtros.desde;
  if (filtros.hasta) paramsBitacora.hasta = filtros.hasta;
  if (filtros.origen) paramsBitacora.origen = filtros.origen;

  const parcelas = await parcelasDisponibles(usuario);
  const [activos, programaciones, eventos, reloj, humedades] = await Promise.all([
    axios.get(`${FINCAS_URL}/api/riego/activos`, { params }).then((r) => r.data),
    axios.get(`${FINCAS_URL}/api/riego/programaciones`, { params }).then((r) => r.data),
    axios.get(`${FINCAS_URL}/api/riego/eventos`, { params: paramsBitacora }).then((r) => r.data),
    axios.get(`${FINCAS_URL}/api/riego/reloj`).then((r) => r.data).catch(() => null),
    humedadPorParcela(usuario, parcelas).catch(() => ({})),
  ]);

  const fincas = [];
  parcelas.forEach((p) => {
    if (!fincas.some((f) => f.id === p.finca_id)) fincas.push({ id: p.finca_id, nombre: p.finca_nombre });
  });
  const visibles = filtros.finca ? parcelas.filter((p) => String(p.finca_id) === filtros.finca) : parcelas;

  return {
    active: "riego",
    parcelas,
    fincas,
    estadoParcelas: visibles.map((p) => {
      const propias = programaciones.filter((g) => g.parcela_id === p.id && g.proxima_ejecucion);
      propias.sort((a, b) => a.proxima_ejecucion.localeCompare(b.proxima_ejecucion));
      return {
        ...p,
        ...(humedades[p.id] || {}),
        riegoEnCurso: activos.find((a) => a.parcela_id === p.id) || null,
        proxima: propias[0] || null,
      };
    }),
    programaciones: filtros.finca ? programaciones.filter((g) => String(g.finca_id) === filtros.finca) : programaciones,
    eventos,
    reloj,
    filtros,
    volver: urlRiego(filtros),
    error: null,
    formulario: null,
    ...extra,
  };
}

function urlRiego(filtros) {
  const query = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
  return query ? `/riego?${query}` : "/riego";
}

// Errores de la API: se vuelve a mostrar la vista con el mensaje (y con el
// formulario de programación abierto si venía de ahí)
async function renderErrorRiego(req, res, err, fallback, formulario = null) {
  console.error(err.message);
  const mensaje = err.response?.data?.error || fallback;
  const volver = volverARiego(req.body.volver);
  const filtros = filtrosRiego(Object.fromEntries(new URL(volver, "http://x").searchParams));
  try {
    res.render("riego", await cargarRiegoView(req.usuario, filtros, { error: mensaje, formulario }));
  } catch (e) {
    console.error(e.message);
    res.redirect(volver);
  }
}

app.get("/riego", requireAuth, async (req, res) => {
  const filtros = filtrosRiego(req.query);
  try {
    res.render("riego", await cargarRiegoView(req.usuario, filtros));
  } catch (err) {
    console.error(err.message);
    res.render("riego", {
      active: "riego", parcelas: [], fincas: [], estadoParcelas: [], programaciones: [], eventos: [], reloj: null,
      filtros, volver: urlRiego(filtros), error: "No se pudo cargar la información de riego", formulario: null,
    });
  }
});

function datosProgramacion(body, usuarioId) {
  return {
    usuario_id: usuarioId,
    parcela_id: body.parcela_id,
    nombre: body.nombre,
    dias_semana: body.dias_semana || "",
    hora_inicio: body.hora_inicio,
    duracion_minutos: body.duracion_minutos,
    activa: body.activa === "1",
  };
}

app.post("/riego/programaciones", requireAuth, async (req, res) => {
  try {
    await axios.post(`${FINCAS_URL}/api/riego/programaciones`, datosProgramacion(req.body, req.usuario.id));
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo crear la programación", { ...req.body, id: null });
  }
});

app.post("/riego/programaciones/:id/editar", requireAuth, async (req, res) => {
  try {
    await axios.put(`${FINCAS_URL}/api/riego/programaciones/${req.params.id}`, datosProgramacion(req.body, req.usuario.id));
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo editar la programación", { ...req.body, id: req.params.id });
  }
});

app.post("/riego/programaciones/:id/activa", requireAuth, async (req, res) => {
  try {
    await axios.put(`${FINCAS_URL}/api/riego/programaciones/${req.params.id}/activa`, {
      activa: req.body.activa === "1",
      usuario_id: req.usuario.id,
    });
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo cambiar el estado de la programación");
  }
});

app.post("/riego/programaciones/:id/eliminar", requireAuth, async (req, res) => {
  try {
    await axios.delete(`${FINCAS_URL}/api/riego/programaciones/${req.params.id}`, { params: { usuario_id: req.usuario.id } });
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo eliminar la programación");
  }
});

app.post("/riego/parcelas/:id/iniciar", requireAuth, async (req, res) => {
  try {
    await axios.post(`${FINCAS_URL}/api/parcelas/${req.params.id}/riego/iniciar`, {
      duracion_minutos: req.body.duracion_minutos,
      usuario_id: req.usuario.id,
    });
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo iniciar el riego");
  }
});

app.post("/riego/parcelas/:id/detener", requireAuth, async (req, res) => {
  try {
    await axios.post(`${FINCAS_URL}/api/parcelas/${req.params.id}/riego/detener`, { usuario_id: req.usuario.id });
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo detener el riego");
  }
});

app.post("/riego/parcelas/:id/automatico", requireAuth, async (req, res) => {
  try {
    await axios.put(`${FINCAS_URL}/api/parcelas/${req.params.id}/riego-automatico`, {
      activo: req.body.activo === "1",
      usuario_id: req.usuario.id,
    });
    res.redirect(volverARiego(req.body.volver));
  } catch (err) {
    await renderErrorRiego(req, res, err, "No se pudo cambiar el riego automático");
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

// --- Alertas (sensor y climáticas) ---
// Mismos permisos que cultivos y riego: el agrónomo solo ve y atiende las
// de sus parcelas asignadas (lecturas-service aplica la regla con usuario_id).

const SEVERIDADES_ALERTA = { alta: "Alta", media: "Media", info: "Info" };
const ESTADOS_ALERTA = { vigentes: "Vigentes (activas y atendidas)", activa: "Activas", atendida: "Atendidas", resuelta: "Resueltas" };

function filtrosAlertas(fuente) {
  return {
    finca: fuente.finca || "",
    parcela: fuente.parcela || "",
    categoria: fuente.categoria || "",
    severidad: fuente.severidad || "",
    estado: fuente.estado === undefined ? "vigentes" : fuente.estado,
  };
}

function urlAlertas(filtros) {
  const query = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== undefined)).toString();
  return query ? `/alertas?${query}` : "/alertas";
}

async function cargarAlertasView(usuario, filtros, extra = {}) {
  const params = { usuario_id: usuario.id, limit: 300 };
  if (filtros.finca) params.finca_id = filtros.finca;
  if (filtros.parcela) params.parcela_id = filtros.parcela;
  if (filtros.categoria) params.categoria = filtros.categoria;
  if (filtros.severidad) params.severidad = filtros.severidad;
  if (filtros.estado) params.estado = filtros.estado;
  const [parcelas, { data: alertas }, { data: conteo }] = await Promise.all([
    parcelasDisponibles(usuario),
    axios.get(`${LECTURAS_URL}/api/alertas`, { params }),
    axios.get(`${LECTURAS_URL}/api/alertas/conteo`, { params: { usuario_id: usuario.id } }),
  ]);
  const fincas = [];
  parcelas.forEach((p) => {
    if (!fincas.some((f) => f.id === p.finca_id)) fincas.push({ id: p.finca_id, nombre: p.finca_nombre });
  });
  return {
    active: "alertas",
    alertas,
    conteo,
    parcelas,
    fincas,
    filtros,
    volver: urlAlertas(filtros),
    severidades: SEVERIDADES_ALERTA,
    estados: ESTADOS_ALERTA,
    error: null,
    ...extra,
  };
}

app.get("/alertas", requireAuth, async (req, res) => {
  const filtros = filtrosAlertas(req.query);
  try {
    res.render("alertas", await cargarAlertasView(req.usuario, filtros));
  } catch (err) {
    console.error(err.message);
    res.render("alertas", {
      active: "alertas", alertas: [], conteo: { activas: 0, atendidas: 0, por_severidad: { alta: 0, media: 0, info: 0 } },
      parcelas: [], fincas: [], filtros, volver: urlAlertas(filtros), severidades: SEVERIDADES_ALERTA,
      estados: ESTADOS_ALERTA, error: "No se pudieron cargar las alertas",
    });
  }
});

// Insignia del menú (la pide el navegador desde cualquier página)
app.get("/alertas/conteo", requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${LECTURAS_URL}/api/alertas/conteo`, { params: { usuario_id: req.usuario.id } });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "No se pudo contar las alertas" });
  }
});

app.post("/alertas/:id/atender", requireAuth, async (req, res) => {
  const volver = typeof req.body.volver === "string" && /^\/alertas(\?|$)/.test(req.body.volver) ? req.body.volver : "/alertas";
  try {
    await axios.put(`${LECTURAS_URL}/api/alertas/${req.params.id}/atender`, { usuario_id: req.usuario.id });
    res.redirect(volver);
  } catch (err) {
    console.error(err.message);
    const filtros = filtrosAlertas(Object.fromEntries(new URL(volver, "http://x").searchParams));
    const mensaje = err.response?.data?.error || "No se pudo marcar la alerta como atendida";
    try {
      res.render("alertas", await cargarAlertasView(req.usuario, filtros, { error: mensaje }));
    } catch (e) {
      res.redirect(volver);
    }
  }
});

// --- Lecturas en vivo ---
// La página carga el selector de finca/parcela y luego el navegador pide
// /lecturas/datos cada pocos segundos (el lecturas-service no es accesible
// directamente desde el navegador).
app.get("/lecturas", requireAuth, async (req, res) => {
  try {
    const { data: parcelas } = await axios.get(`${FINCAS_URL}/api/parcelas`);
    res.render("lecturas", { active: "lecturas", parcelas, error: null });
  } catch (err) {
    console.error(err.message);
    res.render("lecturas", { active: "lecturas", parcelas: [], error: "No se pudieron cargar las parcelas" });
  }
});

app.get("/lecturas/datos", requireAuth, async (req, res) => {
  const filtro = {};
  if (req.query.parcela_id) filtro.parcela_id = req.query.parcela_id;
  else if (req.query.finca_id) filtro.finca_id = req.query.finca_id;

  try {
    const [{ data: lecturas }, { data: alertas }, grafica] = await Promise.all([
      axios.get(`${LECTURAS_URL}/api/lecturas/recientes`, { params: { ...filtro, limit: 50 } }),
      axios.get(`${LECTURAS_URL}/api/alertas/recientes`, { params: { ...filtro, limit: 20, vigentes: 1 } }),
      // la gráfica solo se dibuja para una parcela concreta, con más puntos que la tabla
      filtro.parcela_id
        ? axios.get(`${LECTURAS_URL}/api/lecturas/recientes`, { params: { parcela_id: filtro.parcela_id, limit: 200 } })
        : Promise.resolve({ data: [] }),
    ]);
    res.json({ lecturas, alertas, grafica: grafica.data });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "No se pudieron obtener las lecturas" });
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

// --- Respaldos y exportación de datos (solo admin) ---
// Los respaldos contienen hashes de contraseñas y api_key_hash: solo el admin
// puede crearlos, descargarlos, restaurarlos o borrarlos.

const MENSAJES_RESPALDO = {
  creado: "Respaldo creado",
  restaurado: "Base restaurada. Antes se guardó un respaldo de seguridad del estado anterior",
  eliminado: "Respaldo eliminado",
};

async function cargarRespaldosView(extra = {}) {
  const [{ data: respaldos }, { data: config }, { data: parcelas }] = await Promise.all([
    backupApi.get("/backups"),
    backupApi.get("/backups/config"),
    axios.get(`${FINCAS_URL}/api/parcelas`),
  ]);
  const fincas = [];
  parcelas.forEach((p) => {
    if (!fincas.some((f) => f.id === p.finca_id)) fincas.push({ id: p.finca_id, nombre: p.finca_nombre, parcelas: [] });
    fincas.find((f) => f.id === p.finca_id).parcelas.push(p);
  });
  return { active: "respaldos", respaldos, config, fincas, mensaje: null, error: null, ...extra };
}

async function renderRespaldos(res, extra) {
  try {
    res.render("respaldos", await cargarRespaldosView(extra));
  } catch (err) {
    console.error(err.message);
    res.render("respaldos", {
      active: "respaldos", respaldos: [], config: null, fincas: [], mensaje: null,
      error: extra.error || "No se pudo contactar al servicio de respaldos",
    });
  }
}

app.get("/respaldos", requireAuth, requireAdmin, async (req, res) => {
  const mensaje = MENSAJES_RESPALDO[req.query.ok] ? `${MENSAJES_RESPALDO[req.query.ok]}${req.query.nombre ? `: ${req.query.nombre}` : ""}.` : null;
  await renderRespaldos(res, { mensaje });
});

app.post("/respaldos", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = await backupApi.post("/backups");
    res.redirect(`/respaldos?ok=creado&nombre=${encodeURIComponent(data.nombre)}`);
  } catch (err) {
    console.error(err.message);
    await renderRespaldos(res, { error: err.response?.data?.error || "No se pudo crear el respaldo" });
  }
});

app.get("/respaldos/:nombre/descargar", requireAuth, requireAdmin, async (req, res) => {
  try {
    const respuesta = await backupApi.get(`/backups/${encodeURIComponent(req.params.nombre)}/descargar`, { responseType: "stream" });
    res.set("Content-Type", "application/gzip");
    res.set("Content-Disposition", `attachment; filename="${req.params.nombre.replace(/[^\w.-]/g, "")}"`);
    respuesta.data.pipe(res);
  } catch (err) {
    console.error(err.message);
    await renderRespaldos(res, { error: "No se pudo descargar el respaldo" });
  }
});

// Restaurar exige escribir RESTAURAR (también se valida aquí, no solo en el navegador)
app.post("/respaldos/:nombre/restaurar", requireAuth, requireAdmin, async (req, res) => {
  if (req.body.confirmacion !== "RESTAURAR") {
    return renderRespaldos(res, { error: "Para restaurar tienes que escribir RESTAURAR (en mayúsculas) en la confirmación." });
  }
  try {
    const { data } = await backupApi.post(`/backups/${encodeURIComponent(req.params.nombre)}/restaurar`);
    res.redirect(`/respaldos?ok=restaurado&nombre=${encodeURIComponent(data.seguridad)}`);
  } catch (err) {
    console.error(err.message);
    await renderRespaldos(res, { error: err.response?.data?.error || "No se pudo restaurar el respaldo" });
  }
});

app.post("/respaldos/:nombre/eliminar", requireAuth, requireAdmin, async (req, res) => {
  try {
    await backupApi.delete(`/backups/${encodeURIComponent(req.params.nombre)}`);
    res.redirect(`/respaldos?ok=eliminado&nombre=${encodeURIComponent(req.params.nombre)}`);
  } catch (err) {
    console.error(err.message);
    await renderRespaldos(res, { error: err.response?.data?.error || "No se pudo eliminar el respaldo" });
  }
});

// --- Exportación CSV ---

// Hora local (APP_TIMEZONE) para las columnas de fecha real (TIMESTAMP)
function fechaLocal(valor) {
  if (!valor) return "";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(fecha);
}

// CSV con BOM (para que Excel lea bien los acentos), comillas cuando hace falta
// y protección contra inyección de fórmulas en celdas de texto
function aCsv(columnas, filas) {
  const celda = (v) => {
    if (v === null || v === undefined) return "";
    let texto = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(texto) && Number.isNaN(Number(texto))) texto = `'${texto}`;
    return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const lineas = [columnas.map(([titulo]) => titulo).join(",")];
  filas.forEach((f) => lineas.push(columnas.map(([, valor]) => celda(valor(f))).join(",")));
  return "\uFEFF" + lineas.join("\r\n") + "\r\n";
}

const EXPORTACIONES = {
  lecturas: {
    async cargar({ parcela, desde, hasta }) {
      const r = await axios.get(`${LECTURAS_URL}/api/lecturas/exportar`, {
        params: { parcela_id: parcela || undefined, desde: desde || undefined, hasta: hasta || undefined, limit: 50000 },
      });
      return { filas: r.data, truncado: r.headers["x-export-truncado"] };
    },
    columnas: [
      ["fecha", (l) => fechaLocal(l.fecha)],
      ["finca", (l) => l.finca_nombre],
      ["parcela", (l) => l.parcela_nombre],
      ["estacion", (l) => l.estacion_codigo],
      ["humedad_suelo_pct", (l) => l.humedad_suelo],
      ["temperatura_c", (l) => l.temperatura],
      ["humedad_ambiental_pct", (l) => l.humedad_ambiental],
    ],
  },
  alertas: {
    async cargar({ parcela, desde, hasta }) {
      const limite = 10000;
      const r = await axios.get(`${LECTURAS_URL}/api/alertas`, {
        params: { parcela_id: parcela || undefined, desde: desde || undefined, hasta: hasta || undefined, limit: limite },
      });
      return { filas: r.data, truncado: r.data.length === limite ? String(limite) : null };
    },
    columnas: [
      ["inicio", (a) => fechaLocal(a.fecha)],
      ["ultima_vez", (a) => fechaLocal(a.ultima_lectura_en)],
      ["finca", (a) => a.finca_nombre],
      ["parcela", (a) => a.parcela_nombre],
      ["tipo", (a) => a.tipo],
      ["categoria", (a) => a.categoria],
      ["severidad", (a) => a.severidad],
      ["estado", (a) => a.estado],
      ["detalle", (a) => a.detalle],
      ["repeticiones", (a) => a.repeticiones],
      ["atendida_por", (a) => a.atendida_por_nombre],
      ["atendida_en", (a) => fechaLocal(a.atendida_en)],
      ["resuelta_en", (a) => fechaLocal(a.resuelta_en)],
    ],
  },
  cultivos: {
    // el rango de fechas se aplica a la fecha de siembra
    async cargar({ parcela, desde, hasta }) {
      const r = await axios.get(`${FINCAS_URL}/api/cultivos`, { params: { parcela_id: parcela || undefined } });
      const filas = r.data.filter((c) => (!desde || c.fecha_siembra >= desde) && (!hasta || c.fecha_siembra <= hasta));
      return { filas, truncado: null };
    },
    columnas: [
      ["finca", (c) => c.finca_nombre],
      ["parcela", (c) => c.parcela_nombre || "Toda la finca"],
      ["tipo", (c) => c.tipo],
      ["variedad", (c) => c.variedad],
      ["fecha_siembra", (c) => c.fecha_siembra],
      ["fecha_cosecha_estimada", (c) => c.fecha_cosecha_estimada],
      ["cantidad", (c) => c.cantidad],
      ["unidad", (c) => c.unidad],
      ["estado", (c) => c.estado],
      ["notas", (c) => c.notas],
    ],
  },
  riego: {
    async cargar({ parcela, desde, hasta }) {
      const limite = 5000;
      const r = await axios.get(`${FINCAS_URL}/api/riego/eventos`, {
        params: { parcela_id: parcela || undefined, desde: desde || undefined, hasta: hasta || undefined, limit: limite },
      });
      return { filas: r.data.slice().reverse(), truncado: r.data.length === limite ? String(limite) : null };
    },
    // inicio/fin están en la hora local del motor de riego (Guatemala)
    columnas: [
      ["inicio", (e) => e.inicio],
      ["fin", (e) => e.fin],
      ["finca", (e) => e.finca_nombre],
      ["parcela", (e) => e.parcela_nombre],
      ["origen", (e) => e.origen],
      ["programacion", (e) => e.programacion_nombre],
      ["duracion_minutos", (e) => e.duracion_minutos],
      ["estado", (e) => e.estado],
      ["motivo", (e) => e.motivo],
    ],
  },
};

app.get("/respaldos/exportar", requireAuth, requireAdmin, async (req, res) => {
  const tipo = req.query.tipo;
  const exportacion = EXPORTACIONES[tipo];
  const fechaOk = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!exportacion || !fechaOk(req.query.desde) || !fechaOk(req.query.hasta)) {
    return renderRespaldos(res, { error: "Elige qué datos exportar y fechas válidas." });
  }
  if (req.query.desde && req.query.hasta && req.query.desde > req.query.hasta) {
    return renderRespaldos(res, { error: "La fecha \"desde\" no puede ser posterior a \"hasta\"." });
  }
  try {
    const { filas, truncado } = await exportacion.cargar({
      parcela: req.query.parcela,
      desde: req.query.desde,
      hasta: req.query.hasta,
    });
    const partes = ["agrosense", tipo, req.query.desde || "inicio", req.query.hasta || "hoy"];
    if (truncado) partes.push(`primeras-${truncado}`);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${partes.join("_")}.csv"`);
    res.send(aCsv(exportacion.columnas, filas));
  } catch (err) {
    console.error(err.message);
    await renderRespaldos(res, { error: "No se pudieron exportar los datos" });
  }
});

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

app.post("/usuarios/:id/desbloquear", requireAuth, requireAdmin, async (req, res) => {
  try {
    await axios.put(`${AUTH_URL}/api/auth/usuarios/${req.params.id}/desbloquear`);
    res.redirect("/usuarios");
  } catch (err) {
    console.error(err.message);
    const mensaje = err.response?.data?.error || "No se pudo desbloquear la cuenta";
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
  res.cookie("usuario", JSON.stringify(perfilCookie), OPCIONES_COOKIE);
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
    uploadAvatar.single("foto")(req, res, (err) =>
      conSesion(req, res, () => {
        if (err) return renderConfiguracion(req, res, { section: "foto", error: err.message });
        next();
      })
    );
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
  cerrarSesion(res);
  res.redirect("/login");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`web-admin escuchando en puerto ${PORT}`);
});
