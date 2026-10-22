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
const LECTURAS_URL = process.env.LECTURAS_SERVICE_URL;

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

// Igual que requireAuth pero para clientes de API (la app móvil): no hay
// cookies de sesión, así que la identidad viaja en la cabecera
// Authorization: Bearer <token> y la respuesta es siempre JSON.
function requireBearerAuth(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Falta el token de autenticación" });
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

// Sube la foto de perfil desde la app móvil y reutiliza exactamente el
// mismo almacenamiento (uploadAvatar) y el mismo PUT de perfil que usa
// /configuracion/foto en el panel web, para que ambos clientes vean
// siempre la misma foto.
app.post(
  "/api/perfil/foto",
  requireBearerAuth,
  (req, res, next) => {
    uploadAvatar.single("foto")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
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
      axios.get(`${FINCAS_URL}/api/dashboard/resumen`, { params: { usuario_id: req.usuario.id } }),
      axios.get(`${FINCAS_URL}/api/dashboard/humedad-historial?dias=7`),
    ]);
    res.render("dashboard", { active: "dashboard", resumen, historial });
  } catch (err) {
    console.error(err.message);
    res.render("dashboard", {
      active: "dashboard",
      resumen: { estaciones_activas: 0, alertas_hoy: 0, humedad_promedio: 0, temperatura_promedio: 0, cultivos_activos: 0, riegos_en_curso: 0 },
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

// --- Inventario de cultivos ---
// Admin y agricultor ven y gestionan los cultivos de todas las parcelas
// (el mismo acceso que ya tienen sobre parcelas); el agrónomo solo los de
// sus parcelas asignadas. Por eso se manda siempre el usuario_id: el
// fincas-service aplica esa regla también al crear, editar y eliminar.

const ESTADOS_CULTIVO = { sembrado: "Sembrado", en_crecimiento: "En crecimiento", cosechado: "Cosechado" };
const UNIDADES_CULTIVO = ["plantas", "kg", "quintales"];
const CAMPOS_CULTIVO = [
  "parcela_id", "tipo", "variedad", "fecha_siembra", "fecha_cosecha_estimada", "cantidad", "unidad", "estado", "notas",
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

async function cargarCultivosView(usuario, filtros, extra = {}) {
  const parcelas = await parcelasDisponibles(usuario);
  const params = { usuario_id: usuario.id };
  if (filtros.finca) params.finca_id = filtros.finca;
  if (filtros.parcela) params.parcela_id = filtros.parcela;
  if (filtros.estado) params.estado = filtros.estado;
  const { data: cultivos } = await axios.get(`${FINCAS_URL}/api/cultivos`, { params });

  const fincas = [];
  parcelas.forEach((p) => {
    if (!fincas.some((f) => f.id === p.finca_id)) fincas.push({ id: p.finca_id, nombre: p.finca_nombre });
  });

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

function datosCultivo(body, usuarioId) {
  const datos = { usuario_id: usuarioId };
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
    await axios.post(`${FINCAS_URL}/api/cultivos`, datosCultivo(req.body, req.usuario.id));
    res.redirect(urlCultivos(filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado })));
  } catch (err) {
    await renderErrorCultivo(req, res, err, "No se pudo crear el cultivo");
  }
});

app.post("/cultivos/:id/editar", requireAuth, async (req, res) => {
  try {
    await axios.put(`${FINCAS_URL}/api/cultivos/${req.params.id}`, datosCultivo(req.body, req.usuario.id));
    res.redirect(urlCultivos(filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado })));
  } catch (err) {
    await renderErrorCultivo(req, res, err, "No se pudo editar el cultivo", req.params.id);
  }
});

app.post("/cultivos/:id/eliminar", requireAuth, async (req, res) => {
  const filtros = filtrosCultivos({ finca: req.body.f_finca, parcela: req.body.f_parcela, estado: req.body.f_estado });
  try {
    await axios.delete(`${FINCAS_URL}/api/cultivos/${req.params.id}`, { params: { usuario_id: req.usuario.id } });
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
      axios.get(`${LECTURAS_URL}/api/alertas/recientes`, { params: { ...filtro, limit: 20 } }),
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
