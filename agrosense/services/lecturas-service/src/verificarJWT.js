// Autenticación de los microservicios de AgroSense.
//
// COPIA IDÉNTICA en auth, fincas, lecturas, simulator y backup
// (services/*/src/verificarJWT.js): si cambias una, copia el archivo a las demás.
//
// - verificarJWT: exige "Authorization: Bearer <token>" firmado con JWT_SECRET
//   (el mismo con el que firma auth-service) y deja req.usuario = { id, rol }.
// - verificarJWTOServicio: igual, pero también acepta llamadas internas entre
//   servicios con la cabecera X-Service-Token = SERVICE_TOKEN; en ese caso
//   req.usuario = { id: null, rol: "servicio" }. Nunca se reenvía el JWT de un usuario.
// - soloRoles / soloAdmin: 403 si el rol no alcanza (el servicio interno pasa).
// - cabeceraServicio(): cabeceras para llamar a otro servicio de AgroSense.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "";
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || "";

if (!JWT_SECRET) console.error("[auth] Falta JWT_SECRET: se rechazarán todas las peticiones con token de sesión");

// El 401 de sesión lleva WWW-Authenticate: así la web y la app lo distinguen de
// otros 401 (p. ej. "la contraseña actual no es correcta") y cierran sesión.
function sesionInvalida(res, mensaje) {
  res.set("WWW-Authenticate", 'Bearer realm="agrosense"');
  return res.status(401).json({ error: mensaje });
}

function verificarJWT(req, res, next) {
  const [esquema, token] = (req.get("authorization") || "").split(" ");
  if (esquema !== "Bearer" || !token) {
    return sesionInvalida(res, "Falta el token de sesión (cabecera Authorization: Bearer <token>)");
  }
  if (!JWT_SECRET) return res.status(500).json({ error: "El servicio no tiene JWT_SECRET configurado" });
  try {
    const { id, rol } = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (!id || !rol) return sesionInvalida(res, "Token de sesión inválido");
    req.usuario = { id, rol };
    next();
  } catch (err) {
    return sesionInvalida(
      res,
      err.name === "TokenExpiredError" ? "La sesión expiró: vuelve a iniciar sesión" : "Token de sesión inválido"
    );
  }
}

// Compara hashes para que el tiempo no dependa de cuántos caracteres coinciden
const digest = (valor) => crypto.createHash("sha256").update(String(valor)).digest();
const esTokenDeServicio = (valor) =>
  Boolean(SERVICE_TOKEN) && crypto.timingSafeEqual(digest(valor), digest(SERVICE_TOKEN));

function verificarJWTOServicio(req, res, next) {
  const tokenServicio = req.get("x-service-token");
  if (tokenServicio === undefined) return verificarJWT(req, res, next);
  if (!esTokenDeServicio(tokenServicio)) return res.status(401).json({ error: "Token de servicio inválido" });
  req.usuario = { id: null, rol: "servicio" };
  next();
}

const soloRoles = (...roles) => (req, res, next) => {
  const rol = req.usuario && req.usuario.rol;
  if (rol === "servicio" || roles.includes(rol)) return next();
  res.status(403).json({ error: `Esta acción requiere rol ${roles.join(" o ")}` });
};
const soloAdmin = soloRoles("admin");

const cabeceraServicio = () => (SERVICE_TOKEN ? { "X-Service-Token": SERVICE_TOKEN } : {});

module.exports = { verificarJWT, verificarJWTOServicio, soloRoles, soloAdmin, cabeceraServicio };
