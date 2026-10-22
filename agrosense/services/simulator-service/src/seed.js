// Datos demo del simulador: 1 finca, 3 parcelas con umbrales distintos y
// 2 estaciones por parcela.
//
// Las estaciones se dan de alta con el MISMO flujo que un sensor físico
// (ver fincas-service): se pide un token de un solo uso y se consume en
// POST /api/estaciones/vincular, que devuelve la api_key en texto plano una
// única vez (en la base solo queda su hash sha256). Por eso guardamos esas
// api_keys en un archivo del volumen del simulador: sin ellas no podríamos
// autenticar las lecturas.
//
// Los datos demo se reconocen por el nombre de la finca y el prefijo SIM-
// del código de estación; nunca se modifican fincas, parcelas ni
// estaciones reales.

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const pool = require("./db");

const FINCAS_URL = process.env.FINCAS_SERVICE_URL || "http://fincas-service:3000";
const FINCA_NOMBRE = process.env.SIM_FINCA_NOMBRE || "Finca Demo (Simulador)";
const KEYS_FILE = process.env.SIM_KEYS_FILE || "/data/estaciones-demo.json";
const PREFIJO_CODIGO = "SIM-";
const ESTACIONES_POR_PARCELA = 2;

const PARCELAS_DEMO = [
  { nombre: "Demo - Tomate", humedad_min: 35, humedad_max: 80, temperatura_max: 32 },
  { nombre: "Demo - Maíz", humedad_min: 25, humedad_max: 70, temperatura_max: 36 },
  { nombre: "Demo - Fresa", humedad_min: 45, humedad_max: 85, temperatura_max: 30 },
];

async function api(method, ruta, body) {
  const res = await fetch(`${FINCAS_URL}${ruta}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${ruta} -> ${res.status} ${data.error || ""}`.trim());
  return data;
}

async function leerKeys() {
  try {
    return JSON.parse(await fs.readFile(KEYS_FILE, "utf8"));
  } catch (err) {
    return {};
  }
}

async function guardarKeys(keys) {
  await fs.mkdir(path.dirname(KEYS_FILE), { recursive: true });
  await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
}

// Si se perdió el archivo de keys pero la estación demo sigue en la base,
// se le asigna una api_key nueva con el mismo esquema de fincas-service
// (24 bytes aleatorios en hex, guardada como sha256). El filtro por código
// SIM- garantiza que nunca se toque una estación real.
async function rotarApiKey(estacionId) {
  const apiKey = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const [result] = await pool.query(
    "UPDATE estaciones SET api_key_hash = ? WHERE id = ? AND codigo LIKE ?",
    [hash, estacionId, `${PREFIJO_CODIGO}%`]
  );
  return result.affectedRows === 1 ? apiKey : null;
}

async function vincularEstacion(parcelaId, codigo) {
  const { token } = await api("POST", "/api/sensores/tokens", { parcela_id: parcelaId });
  const estacion = await api("POST", "/api/estaciones/vincular", { token, codigo });
  return { id: estacion.estacion_id, codigo, apiKey: estacion.api_key };
}

// Crea lo que falte de los datos demo y devuelve la finca, sus parcelas
// (con umbrales) y las estaciones con su api_key en texto plano.
async function prepararDatosDemo() {
  const fincas = await api("GET", "/api/fincas");
  let finca = fincas.find((f) => f.nombre === FINCA_NOMBRE);
  if (!finca) {
    finca = await api("POST", "/api/fincas", {
      nombre: FINCA_NOMBRE,
      ubicacion: "Datos simulados (no es una finca real)",
      usuario_id: null,
    });
    console.log(`[sim] Finca demo creada (id ${finca.id})`);
  }

  let parcelas = await api("GET", `/api/fincas/${finca.id}/parcelas`);
  for (const def of PARCELAS_DEMO) {
    if (!parcelas.some((p) => p.nombre === def.nombre)) {
      const creada = await api("POST", "/api/parcelas", { ...def, finca_id: finca.id });
      console.log(`[sim] Parcela demo creada: ${def.nombre} (id ${creada.id})`);
    }
  }
  parcelas = (await api("GET", `/api/fincas/${finca.id}/parcelas`)).filter((p) =>
    PARCELAS_DEMO.some((def) => def.nombre === p.nombre)
  );

  const keys = await leerKeys();
  const resultado = [];

  for (const p of parcelas) {
    const existentes = (await api("GET", `/api/parcelas/${p.id}/estaciones`)).filter((e) =>
      e.codigo.startsWith(PREFIJO_CODIGO)
    );
    const estaciones = [];

    for (const e of existentes) {
      let apiKey = keys[e.id];
      if (!apiKey) {
        apiKey = await rotarApiKey(e.id);
        if (!apiKey) continue;
        console.log(`[sim] api_key regenerada para ${e.codigo} (no estaba en ${KEYS_FILE})`);
      }
      estaciones.push({ id: e.id, codigo: e.codigo, apiKey });
    }

    for (let n = 1; estaciones.length < ESTACIONES_POR_PARCELA; n++) {
      const codigo = `${PREFIJO_CODIGO}P${p.id}-${n}`;
      if (existentes.some((e) => e.codigo === codigo)) continue;
      const nueva = await vincularEstacion(p.id, codigo);
      console.log(`[sim] Estación demo vinculada: ${codigo} (id ${nueva.id})`);
      estaciones.push(nueva);
    }

    resultado.push({
      id: p.id,
      nombre: p.nombre,
      humedad_min: Number(p.humedad_min),
      humedad_max: Number(p.humedad_max),
      temperatura_max: Number(p.temperatura_max),
      estaciones,
    });
  }

  const nuevasKeys = {};
  for (const p of resultado) for (const e of p.estaciones) nuevasKeys[e.id] = e.apiKey;
  await guardarKeys(nuevasKeys);

  return { finca: { id: finca.id, nombre: finca.nombre }, parcelas: resultado };
}

// Umbrales actuales de las parcelas demo (por si alguien los edita desde
// el panel web o la app, el simulador se adapta sin reiniciarse).
async function leerUmbrales(fincaId) {
  return api("GET", `/api/fincas/${fincaId}/parcelas`);
}

module.exports = { prepararDatosDemo, leerUmbrales };
