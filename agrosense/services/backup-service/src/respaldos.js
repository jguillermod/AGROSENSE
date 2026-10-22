// Crear, listar, restaurar, borrar y rotar respaldos de la base.
//
// Cada respaldo es un mariadb-dump comprimido (.sql.gz) en BACKUP_DIR (un
// volumen de Docker propio, nunca dentro del repo: contiene hashes de
// contraseñas y api_key_hash). La contraseña de la base se pasa por la
// variable MYSQL_PWD y no por argumentos, para que no aparezca en `ps`.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");

const DIR = path.resolve(process.env.BACKUP_DIR || "/backups");
const ZONA = process.env.APP_TIMEZONE || "America/Guatemala";
const RETENCION_DIAS = Number(process.env.BACKUP_RETENTION_DAYS) || 7;

// agrosense_20261021-221530_manual.sql.gz (fecha y hora locales)
const PATRON = /^agrosense_(\d{8})-(\d{6})_(manual|automatico|seguridad)\.sql\.gz$/;
const TIPOS = { manual: "manual", automatico: "automatico", seguridad: "automatico" };
const MOTIVOS = { manual: "Creado a mano", automatico: "Programado", seguridad: "Antes de restaurar" };

class ErrorRespaldo extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

let ocupado = null; // operación en curso, para no correr dos a la vez

function conexion() {
  return {
    args: [
      "--skip-ssl",
      "-h", process.env.DB_HOST || "mysql",
      "-P", String(process.env.DB_PORT || 3306),
      "-u", process.env.DB_USER,
    ],
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || "" },
    base: process.env.DB_NAME,
  };
}

function marcaDeTiempo() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

// Valida que el nombre sea uno de nuestros respaldos y que la ruta quede
// dentro de BACKUP_DIR (sin "../", barras ni rutas absolutas)
function rutaSegura(nombre) {
  if (typeof nombre !== "string" || !PATRON.test(nombre)) throw new ErrorRespaldo("Nombre de respaldo inválido");
  const ruta = path.resolve(DIR, nombre);
  if (path.dirname(ruta) !== DIR) throw new ErrorRespaldo("Nombre de respaldo inválido");
  return ruta;
}

async function existe(ruta) {
  try {
    await fsp.access(ruta);
    return true;
  } catch {
    return false;
  }
}

function describir(nombre, stat) {
  const [, , , clase] = nombre.match(PATRON);
  return {
    nombre,
    fecha: stat.mtime.toISOString(),
    tamano_bytes: stat.size,
    tipo: TIPOS[clase],
    motivo: MOTIVOS[clase],
  };
}

async function listar() {
  await fsp.mkdir(DIR, { recursive: true });
  const nombres = (await fsp.readdir(DIR)).filter((n) => PATRON.test(n));
  const respaldos = await Promise.all(nombres.map(async (n) => describir(n, await fsp.stat(path.join(DIR, n)))));
  return respaldos.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

async function conCandado(operacion, fn) {
  if (ocupado) throw new ErrorRespaldo(`Hay otra operación en curso (${ocupado}); intenta en unos segundos`, 409);
  ocupado = operacion;
  try {
    return await fn();
  } finally {
    ocupado = null;
  }
}

// Ejecuta mariadb-dump y comprime la salida a un archivo temporal que solo se
// renombra si todo salió bien (un respaldo a medias nunca queda en la lista)
async function volcar(clase) {
  await fsp.mkdir(DIR, { recursive: true });
  const nombre = `agrosense_${marcaDeTiempo()}_${clase}.sql.gz`;
  const destino = path.join(DIR, nombre);
  if (await existe(destino)) throw new ErrorRespaldo("Ya existe un respaldo con esa hora; espera un segundo", 409);
  const temporal = `${destino}.tmp`;
  const { args, env, base } = conexion();
  const dump = spawn(
    "mariadb-dump",
    [...args, "--single-transaction", "--quick", "--routines", "--triggers", "--no-tablespaces",
     "--default-character-set=utf8mb4", base],
    { env }
  );
  let errores = "";
  dump.stderr.on("data", (d) => (errores += d));
  const terminado = new Promise((resolve) => dump.on("close", resolve));
  try {
    await pipeline(dump.stdout, zlib.createGzip(), fs.createWriteStream(temporal));
    const codigo = await terminado;
    if (codigo !== 0) throw new Error(errores.trim() || `mariadb-dump terminó con código ${codigo}`);
    await fsp.rename(temporal, destino);
  } catch (err) {
    await fsp.rm(temporal, { force: true });
    throw new ErrorRespaldo(`No se pudo crear el respaldo: ${err.message}`, 500);
  }
  return describir(nombre, await fsp.stat(destino));
}

async function rotar() {
  const limite = Date.now() - RETENCION_DIAS * 24 * 3600 * 1000;
  const borrados = [];
  for (const r of await listar()) {
    if (new Date(r.fecha).getTime() < limite) {
      await fsp.rm(path.join(DIR, r.nombre), { force: true });
      borrados.push(r.nombre);
    }
  }
  if (borrados.length) console.log(`[backup] Rotación (${RETENCION_DIAS} días): borrados ${borrados.join(", ")}`);
  return borrados;
}

async function crear(clase) {
  return conCandado(`respaldo ${clase}`, async () => {
    const respaldo = await volcar(clase);
    console.log(`[backup] Respaldo ${clase} creado: ${respaldo.nombre} (${respaldo.tamano_bytes} bytes)`);
    const rotados = await rotar();
    return { ...respaldo, rotados };
  });
}

// Restaura un respaldo: antes guarda uno "de seguridad" del estado actual
async function restaurar(nombre) {
  const ruta = rutaSegura(nombre);
  if (!(await existe(ruta))) throw new ErrorRespaldo("Ese respaldo no existe", 404);
  return conCandado(`restauración de ${nombre}`, async () => {
    const seguridad = await volcar("seguridad");
    const { args, env, base } = conexion();
    const cliente = spawn("mariadb", [...args, "--default-character-set=utf8mb4", base], { env });
    let errores = "";
    cliente.stderr.on("data", (d) => (errores += d));
    const terminado = new Promise((resolve) => cliente.on("close", resolve));
    try {
      await pipeline(fs.createReadStream(ruta), zlib.createGunzip(), cliente.stdin);
    } catch (err) {
      errores += err.message;
    }
    const codigo = await terminado;
    if (codigo !== 0) {
      throw new ErrorRespaldo(
        `La restauración falló (${errores.trim() || `código ${codigo}`}). El estado anterior quedó en ${seguridad.nombre}`,
        500
      );
    }
    console.log(`[backup] Restaurado ${nombre} (respaldo de seguridad previo: ${seguridad.nombre})`);
    return { restaurado: nombre, seguridad: seguridad.nombre };
  });
}

async function eliminar(nombre) {
  const ruta = rutaSegura(nombre);
  if (!(await existe(ruta))) throw new ErrorRespaldo("Ese respaldo no existe", 404);
  await fsp.rm(ruta);
  return { eliminado: nombre };
}

module.exports = { listar, crear, restaurar, eliminar, rotar, rutaSegura, existe, ErrorRespaldo, RETENCION_DIAS, DIR };
