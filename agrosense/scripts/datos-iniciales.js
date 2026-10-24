// Datos iniciales de AgroSense: borra los datos de operación y carga un
// conjunto coherente de usuarios, fincas, parcelas, estaciones, cultivos,
// programaciones y 14 días de historial (lecturas, riegos, alertas y
// registros de campo). Es repetible: cada corrida deja la base igual.
//
// - Conserva a los usuarios administradores tal cual (correo, contraseña y rol).
// - Las contraseñas de los usuarios nuevos se generan al azar en cada corrida,
//   se registran con auth-service (que guarda solo el hash) y se muestran una
//   única vez en la salida. No se escriben en ningún archivo.
// - El historial usa el mismo modelo que el servicio de estaciones
//   (services/simulator-service/src/modelo.js): al arrancar, éste continúa
//   desde la última lectura sin saltos.
//
// Se corre dentro de la imagen del servicio de estaciones (trae mysql2, las
// variables de la base y el secreto para hablar con auth-service), con ese
// servicio detenido para que no envíe lecturas mientras tanto:
//
//   docker compose stop simulator-service
//   docker compose run --rm --no-deps -T simulator-service node - --confirmar < scripts/datos-iniciales.js
//   docker compose exec etl-service python etl.py --dias 15 --una-vez
//   docker compose start simulator-service
//
// Sin --confirmar solo describe lo que haría. Con --simular calcula el
// historial y muestra un resumen sin tocar la base.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = fs.existsSync("/app/src/modelo.js")
  ? "/app/src"
  : path.join(__dirname, "..", "services", "simulator-service", "src");
const modelo = require(path.join(BASE, "modelo.js"));
const { aTexto } = require(path.join(BASE, "clima.js"));

const ARGS = process.argv.slice(2);
const CONFIRMAR = ARGS.includes("--confirmar");
const SIMULAR = ARGS.includes("--simular");

const DOMINIO = "agrosense.com.gt";
const DIAS_HISTORIAL = 14;
const PASO_MIN = 5;
const PASO_MS = PASO_MIN * 60000;
const MIN_MS = 60000;
const HORA_MS = modelo.HORA_MS;
const DIA_MS = modelo.DIA_MS;
const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

// --- Definición de los datos ---------------------------------------------

const USUARIOS = {
  agricultor: { nombre: "Carlos Enrique Morales Cúmez", email: `carlos.morales@${DOMINIO}` },
  agronomo: { nombre: "Ana Lucía Pérez Sicán", email: `ana.perez@${DOMINIO}` },
};

// perfil: clima del lugar ({ media, amplitud } °C); lluvias: [día relativo, hora local de inicio, horas]
// En cada parcela: umbrales según el cultivo, desfase de temperatura (microclima),
// riego automático o programaciones [nombre, días, hora, minutos], y si la
// tiene asignada la agrónoma.
const FINCAS = [
  {
    nombre: "Finca El Mirador",
    ubicacion: "Aldea Xepatán, Patzicía, Chimaltenango",
    codigo: "PTZ",
    perfil: { media: 15.5, amplitud: 6.5 },
    lluvias: [[-11, 15.0, 2.5], [-6, 14.5, 1.5], [-2, 16.0, 1.0]],
    parcelas: [
      { nombre: "Lote Norte", min: 35, max: 70, tMax: 30, tMin: 3, auto: false,
        programas: [["Riego de la mañana", "L,X,V", "06:00", 40]] },
      { nombre: "Lote Las Brisas", min: 40, max: 70, tMax: 29, tMin: 4, auto: true,
        programas: [["Riego de apoyo", "M,J,S", "06:00", 30]] },
      { nombre: "Invernadero 1", min: 45, max: 75, tMax: 34, tMin: 8, desfase: 4, auto: false, agronoma: true,
        programas: [["Goteo diario", "L,M,X,J,V,S,D", "07:00", 30], ["Goteo de la tarde", "L,X,V", "16:00", 20]] },
      { nombre: "Lote El Arenal", min: 45, max: 75, tMax: 28, tMin: 3, auto: false,
        programas: [["Aspersión temprana", "L,M,X,J,V,S", "06:30", 35]] },
    ],
  },
  {
    nombre: "Finca Santa Lucía",
    ubicacion: "Caserío El Cerro, Barberena, Santa Rosa",
    codigo: "BRB",
    perfil: { media: 21.5, amplitud: 5.5 },
    lluvias: [[-12, 15.5, 2.0], [-8, 14.0, 3.0], [-3, 15.0, 1.5]],
    parcelas: [
      { nombre: "Pante El Cerro", min: 45, max: 75, tMax: 32, tMin: 8, auto: true, agronoma: true, programas: [] },
      { nombre: "Pante La Ceiba", min: 45, max: 75, tMax: 32, tMin: 8, desfase: -1, auto: false,
        programas: [["Riego de la mañana", "M,J,S", "06:00", 60]] },
      { nombre: "Lote La Joya", min: 35, max: 70, tMax: 33, tMin: 6, auto: false,
        programas: [["Riego de la tarde", "L,X,V", "17:00", 40]] },
    ],
  },
  {
    nombre: "Finca Las Delicias",
    ubicacion: "Aldea El Tamarindo, Asunción Mita, Jutiapa",
    codigo: "AMT",
    perfil: { media: 27.5, amplitud: 5.5 },
    lluvias: [[-9, 15.0, 2.0], [-4, 16.5, 1.5]],
    parcelas: [
      { nombre: "Lote Río Ostúa", min: 45, max: 75, tMax: 37, tMin: 12, auto: true, agronoma: true, programas: [] },
      { nombre: "Lote El Jícaro", min: 45, max: 75, tMax: 37, tMin: 12, auto: false, agronoma: true,
        programas: [["Goteo de la mañana", "L,M,X,J,V,S,D", "06:00", 50], ["Goteo de la tarde", "L,M,X,J,V,S,D", "17:30", 30]] },
      { nombre: "Lote La Vega", min: 35, max: 70, tMax: 38, tMin: 12, auto: false, agronoma: true,
        programas: [["Riego por gravedad", "L,M,X,J,V,S,D", "06:00", 60]] },
      { nombre: "Lote Tamarindo", min: 45, max: 75, tMax: 36, tMin: 12, auto: true, programas: [] },
    ],
  },
];

// [finca, parcela o null (toda la finca), tipo, variedad, siembra (días), cosecha (días), cantidad, unidad, notas]
const CULTIVOS = [
  ["Finca El Mirador", "Lote Norte", "Maíz", "ICTA B-7", -150, 40, 18000, "plantas", "Segunda fertilización con urea aplicada en agosto."],
  ["Finca El Mirador", "Lote Las Brisas", "Frijol negro", "ICTA Hunapú", -62, 23, 9500, "plantas", "Inicio de llenado de vaina."],
  ["Finca El Mirador", "Invernadero 1", "Tomate", "Retana", -75, 15, 2400, "plantas", "Tutorado con rafia; control de mosca blanca con trampas amarillas."],
  ["Finca El Mirador", "Lote El Arenal", "Arveja china", "Oregon Sugar Pod II", -45, 25, 14000, "plantas", "Para exportación; cosecha escalonada."],
  ["Finca El Mirador", "Lote El Arenal", "Brócoli", "Avenger", -160, -70, 45, "quintales", "Ciclo anterior, entregado al centro de acopio."],
  ["Finca El Mirador", null, "Frijol de enredo", "ICTA Labor Ovalle", -120, 30, 6000, "plantas", "Asociado con el maíz en varias parcelas."],
  ["Finca Santa Lucía", "Pante El Cerro", "Café", "Catuaí rojo", -1900, 45, 3200, "plantas", "Sombra de gravilea; poda de mantenimiento en marzo."],
  ["Finca Santa Lucía", "Pante La Ceiba", "Café", "Bourbon", -3300, 60, 2800, "plantas", "Se observa buena carga de fruto."],
  ["Finca Santa Lucía", "Lote La Joya", "Maíz", "ICTA HB-83", -110, 20, 12000, "plantas", "Dobla prevista para la primera semana de noviembre."],
  ["Finca Santa Lucía", null, "Café", "Anacafé 14", -140, 760, 1500, "plantas", "Renovación de cafetal en varios pantes."],
  ["Finca Las Delicias", "Lote Río Ostúa", "Tomate", "Shanty", -58, 17, 5200, "plantas", "Riego por goteo con fertirriego semanal."],
  ["Finca Las Delicias", "Lote El Jícaro", "Chile pimiento", "Nathalie", -70, 10, 4800, "plantas", "Primer corte programado."],
  ["Finca Las Delicias", "Lote La Vega", "Maíz", "ICTA B-15", -125, -8, 85, "quintales", "Cosecha de primera."],
  ["Finca Las Delicias", "Lote La Vega", "Frijol rojo", "ICTA Ligero", -18, 55, 7000, "plantas", "Siembra de postrera."],
  ["Finca Las Delicias", "Lote Tamarindo", "Pepino", "Poinsett 76", -35, 5, 3600, "plantas", "Espaldera de dos hilos."],
  ["Finca Las Delicias", null, "Chile jalapeño", "M", -40, 35, 2000, "plantas", "En bordes de varias parcelas."],
];

const NOTAS_CAMPO = [
  "Plantas con buen vigor; sin presencia de plagas.",
  "Se observa leve marchitez en horas de calor; revisar goteros.",
  "Aplicación de fertilizante foliar con micronutrientes.",
  "Inicio de floración en la mayoría de plantas.",
  "Monitoreo de trips: población baja, sin aplicación.",
  "Suelo húmedo al tacto a 15 cm de profundidad.",
  "Se limpiaron filtros del sistema de riego.",
  "Presencia aislada de gusano cogollero; se marcó para seguimiento.",
];

// --- Utilidades -----------------------------------------------------------

const aSqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const aSqlLocal = (ms) => aTexto(ms).replace("T", " ");
const aFecha = (ms) => aTexto(ms).slice(0, 10);
const r1 = (v) => Math.round(Number(v) * 10) / 10;
const azar = (min, max) => min + Math.random() * (max - min);
const elegir = (lista) => lista[Math.floor(Math.random() * lista.length)];

// Minutos a sumar a UTC para la hora local (Guatemala, sin horario de verano: -360)
const DESFASE_MIN = (() => {
  const ahora = new Date();
  const local = new Date(ahora.toLocaleString("en-US", { timeZone: modelo.ZONA }));
  const utc = new Date(ahora.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local - utc) / 60000);
})();
// Instante de una hora local (y, m, d, h, min)
const instanteLocal = (y, m, d, h, min) => Date.UTC(y, m - 1, d, h, min) - DESFASE_MIN * MIN_MS;
// Medianoche local del día de un instante, desplazada `dias`
function medianocheLocal(ms, dias = 0) {
  const [y, m, d] = aFecha(ms).split("-").map(Number);
  return instanteLocal(y, m, d + dias, 0, 0);
}

function contrasena() {
  const grupos = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%&*?-_+="];
  const todos = grupos.join("");
  const letras = grupos.map((g) => g[crypto.randomInt(g.length)]);
  while (letras.length < 16) letras.push(todos[crypto.randomInt(todos.length)]);
  for (let i = letras.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [letras[i], letras[j]] = [letras[j], letras[i]];
  }
  return letras.join("");
}

// --- Historial --------------------------------------------------------------

// Inicios de las programaciones de una parcela entre dos instantes
function iniciosProgramados(parcela, desde, hasta) {
  const inicios = [];
  for (const [nombre, dias, hora, minutos] of parcela.programas) {
    const [h, m] = hora.split(":").map(Number);
    for (let dia = medianocheLocal(desde, -1); dia <= hasta; dia += DIA_MS) {
      const [y, mes, d] = aFecha(dia + 12 * HORA_MS).split("-").map(Number);
      const t = instanteLocal(y, mes, d, h, m);
      const letra = LETRAS_DIA[new Date(Date.UTC(y, mes - 1, d)).getUTCDay()];
      if (t > desde && t <= hasta && dias.split(",").includes(letra)) inicios.push({ t, nombre, minutos });
    }
  }
  return inicios.sort((a, b) => a.t - b.t);
}

// Episodios de lluvia de una finca en instantes
function lluviasDe(finca, fin) {
  return finca.lluvias.map(([dia, hora, horas]) => {
    const base = medianocheLocal(fin, dia);
    const inicio = base + Math.round(hora * 60) * MIN_MS;
    return { inicio, fin: inicio + Math.round(horas * 60) * MIN_MS };
  });
}

// Simula una parcela de `inicio` a `fin`; devuelve lecturas, riegos y alertas de sensor.
// objetivoFinal: si se da, la humedad termina bajo el mínimo (alerta vigente al final).
function simularParcela(finca, parcela, inicio, fin, objetivoFinal) {
  const lluvias = lluviasDe(finca, fin);
  const programados = iniciosProgramados(parcela, inicio, fin);
  const datos = { humedad_min: parcela.min, humedad_max: parcela.max };
  const lecturas = [];
  const riegos = [];
  const alertas = [];
  const vigentes = new Map(); // tipo -> alerta
  let suelo = azar(parcela.min + 8, parcela.max - 8);
  let riego = null; // en curso
  let bajoMinimoDesde = null;
  let ultima = suelo; // humedad de la última lectura (con ella decide el motor, como el real)
  const omitidasPorLluvia = new Set(); // el automático anota una sola omisión por episodio de lluvia
  const ventanaFinal = fin - 9 * HORA_MS;
  // lluvia en curso o anunciada para las próximas 12 h: el motor no riega
  const alertaLluvia = (t) => lluvias.find((l) => t >= l.inicio - 12 * HORA_MS && t < l.fin);

  for (let t = inicio; t <= fin; t += PASO_MS) {
    const lluvia = lluvias.find((l) => t >= l.inicio && t < l.fin);
    const evento = lluvia ? "lluvia" : null;
    const forzar = objetivoFinal && t >= ventanaFinal;

    // motor de riego
    if (riego && t >= riego.inicio + riego.minutos * MIN_MS) {
      riego.estado = "completado";
      riego = null;
    }
    for (const p of programados.filter((x) => x.t > t - PASO_MS && x.t <= t)) {
      const ll = alertaLluvia(p.t);
      if (ll) {
        const tipo = p.t >= ll.inicio ? "lluvia en curso" : "lluvia intensa prevista";
        riegos.push({ origen: "programado", programa: p.nombre, inicio: p.t, minutos: 0, estado: "omitido",
          motivo: `Omitido por lluvia (${tipo}); estaba programado por ${p.minutos} min` });
      } else if (!riego && !forzar) {
        riego = { origen: "programado", programa: p.nombre, inicio: p.t, minutos: p.minutos, estado: "en_curso" };
        riegos.push(riego);
      }
    }
    if (!riego && !forzar && !parcela.auto && !alertaLluvia(t)) {
      // riego de apoyo a media mañana, de vez en cuando, si la humedad va por debajo de la mitad del rango
      const h = modelo.horaLocal(t);
      if (h >= 9.5 && h < 9.5 + PASO_MIN / 60 && ultima < (parcela.min + parcela.max) / 2 && Math.random() < 0.15) {
        riego = { origen: "manual", inicio: t, minutos: elegir([25, 30, 40]), estado: "en_curso" };
        riegos.push(riego);
      }
    }
    if (!riego && !forzar && parcela.auto && ultima < parcela.min && alertaLluvia(t)) {
      const ll = alertaLluvia(t);
      if (!omitidasPorLluvia.has(ll)) {
        omitidasPorLluvia.add(ll);
        const tipo = t >= ll.inicio ? "lluvia en curso" : "lluvia intensa prevista";
        riegos.push({ origen: "automatico", inicio: t, minutos: 0, estado: "omitido",
          motivo: `Omitido por lluvia (${tipo}); humedad ${ultima.toFixed(1)}% bajo el mínimo` });
      }
    }
    if (!riego && !forzar && ultima < parcela.min && !alertaLluvia(t)) {
      if (parcela.auto) {
        riego = { origen: "automatico", inicio: t + MIN_MS, minutos: 60, estado: "en_curso" };
        riegos.push(riego);
      } else if (bajoMinimoDesde && t - bajoMinimoDesde >= 60 * MIN_MS) {
        // alguien vio la alerta y regó a mano (de día, o en cualquier momento cerca del final)
        const h = modelo.horaLocal(t);
        if ((h >= 6.5 && h < 18.5) || t > fin - 3 * HORA_MS) {
          riego = { origen: "manual", inicio: t, minutos: elegir([30, 40, 45]), estado: "en_curso" };
          riegos.push(riego);
        }
      }
    }

    // estado de la parcela y lectura
    const temp = modelo.ajusteEvento(
      modelo.temperaturaLugar(finca.perfil, finca.id, t) + (parcela.desfase || 0),
      evento
    );
    suelo = modelo.pasoSuelo(suelo, PASO_MIN / 60, { temp, regando: Boolean(riego), evento, parcela: datos });
    if (forzar) {
      // termina unos puntos bajo el mínimo, bajando de a poco
      const avance = (t - ventanaFinal) / (fin - ventanaFinal);
      const meta = parcela.min - 3.5 + (1 - avance) * 6;
      if (suelo > meta) suelo += (meta - suelo) * 0.08;
    }
    const l = modelo.lectura({ estacionId: null, suelo, temp, evento });
    lecturas.push({ t, ...l });
    ultima = l.humedad_suelo;
    bajoMinimoDesde = l.humedad_suelo < parcela.min ? bajoMinimoDesde ?? t : null;

    // alertas de sensor, con las mismas reglas que lecturas-service
    const h = l.humedad_suelo;
    const tc = l.temperatura;
    const condiciones = [
      { tipo: "Necesita riego", activa: h < parcela.min, omitir: Boolean(riego),
        severidad: h < parcela.min - 10 ? "alta" : "media", detalle: `Humedad de suelo ${r1(h)}% (mínimo ${r1(parcela.min)}%)`, valor: h },
      { tipo: "Riesgo de exceso de humedad", activa: h > parcela.max, severidad: "media",
        detalle: `Humedad de suelo ${r1(h)}% (máximo ${r1(parcela.max)}%)`, valor: h },
      { tipo: "Riesgo de estrés hídrico por calor", activa: tc > parcela.tMax, severidad: tc > parcela.tMax + 3 ? "alta" : "media",
        detalle: `Temperatura ${r1(tc)} °C (máximo ${r1(parcela.tMax)} °C)`, valor: tc },
      { tipo: "Riesgo de helada", activa: tc < parcela.tMin, severidad: "alta",
        detalle: `Temperatura ${r1(tc)} °C (mínimo ${r1(parcela.tMin)} °C)`, valor: tc },
    ];
    for (const c of condiciones) {
      const a = vigentes.get(c.tipo);
      if (c.activa) {
        if (c.omitir) continue;
        if (a) Object.assign(a, { repeticiones: a.repeticiones + 1, severidad: c.severidad, detalle: c.detalle, valor: c.valor, ultima: t });
        else {
          const nueva = { tipo: c.tipo, categoria: "sensor", severidad: c.severidad, detalle: c.detalle, valor: c.valor,
            fecha: t, ultima: t, repeticiones: 1, estado: "activa" };
          vigentes.set(c.tipo, nueva);
          alertas.push(nueva);
        }
      } else if (a) {
        a.estado = "resuelta";
        a.resuelta = t;
        vigentes.delete(c.tipo);
      }
    }
  }
  return { lecturas, riegos, alertas, lluvias, sueloFinal: suelo };
}

// Alertas climáticas de lluvia de una parcela (como las abre lecturas-service)
function alertasDeLluvia(lluvias, fin) {
  const alertas = [];
  for (const l of lluvias) {
    const desde = Math.max(l.inicio - 12 * HORA_MS, fin - (DIAS_HISTORIAL + 1) * DIA_MS);
    const hora = aTexto(Math.ceil(l.inicio / HORA_MS) * HORA_MS).slice(11, 16);
    alertas.push({ tipo: "Lluvia intensa prevista: posponer riego", categoria: "climatica", severidad: "media",
      detalle: `Lluvia de hasta 4 mm/h desde las ${hora}: conviene posponer el riego`, valor: 4,
      fecha: desde, ultima: l.inicio, repeticiones: Math.round((l.inicio - desde) / 10000), estado: "resuelta", resuelta: l.inicio });
    alertas.push({ tipo: "Lluvia en curso: riego pospuesto", categoria: "climatica", severidad: "info",
      detalle: "Lluvia de 4 mm/h: los riegos se omiten mientras llueva", valor: 4,
      fecha: l.inicio, ultima: l.fin, repeticiones: Math.round((l.fin - l.inicio) / 10000), estado: "resuelta", resuelta: l.fin });
  }
  return alertas;
}

// Parcelas que terminan con la alerta "Necesita riego" vigente: sin riego
// automático y sin programación en las últimas 9 h ni en la próxima hora.
// Una sin la agrónoma (queda activa) y otra de la agrónoma (queda atendida).
function elegirObjetivos(fin) {
  const candidatas = [];
  for (const f of FINCAS) for (const p of f.parcelas) {
    if (p.auto) continue;
    if (iniciosProgramados(p, fin - 9 * HORA_MS, fin + HORA_MS).length) continue;
    candidatas.push(p);
  }
  const activa = candidatas.find((p) => !p.agronoma);
  const atendida = candidatas.find((p) => p.agronoma);
  return { activa, atendida };
}

// Historial completo; reintenta hasta que el final quede como se pide
function generarHistorial(fin) {
  const inicio = medianocheLocal(fin, -DIAS_HISTORIAL);
  const objetivos = elegirObjetivos(fin);
  for (let intento = 1; intento <= 40; intento++) {
    const resultado = [];
    let valido = true;
    for (const f of FINCAS) {
      for (const p of f.parcelas) {
        const objetivo = p === objetivos.activa || p === objetivos.atendida;
        const sim = simularParcela(f, p, inicio, fin, objetivo);
        const vigentes = sim.alertas.filter((a) => a.estado === "activa");
        const humedades = sim.lecturas.map((l) => l.humedad_suelo);
        const promedio = humedades.reduce((a, b) => a + b, 0) / humedades.length;
        if (objetivo ? vigentes.length !== 1 || vigentes[0].tipo !== "Necesita riego" : vigentes.length > 0) valido = false;
        if (promedio < 40 || promedio > 70) valido = false;
        resultado.push({ finca: f, parcela: p, objetivo, ...sim, promedio });
      }
    }
    if (valido) return { inicio, resultado, objetivos, intentos: intento };
  }
  throw new Error("No se logró un historial coherente; revisa los parámetros de las parcelas");
}

// --- Base de datos -----------------------------------------------------------

async function limpiar(conn) {
  // orden según las llaves foráneas; los administradores no se tocan
  const tablas = [
    "lecturas", "alertas", "reportes_diarios", "registros_manuales", "riego_eventos", "riego_programaciones",
    "cultivos", "sensor_tokens", "usuario_parcelas", "estaciones", "parcelas", "fincas",
  ];
  const borrados = {};
  for (const t of tablas) {
    const [r] = await conn.query(`DELETE FROM ${t}`);
    borrados[t] = r.affectedRows;
  }
  const [pr] = await conn.query(
    "DELETE pr FROM password_resets pr JOIN usuarios u ON u.id = pr.usuario_id WHERE u.rol <> 'admin'"
  );
  borrados.password_resets = pr.affectedRows;
  const [u] = await conn.query("DELETE FROM usuarios WHERE rol <> 'admin'");
  borrados.usuarios = u.affectedRows;
  return borrados;
}

// Crea un usuario con auth-service (valida y guarda el hash de la contraseña)
async function crearUsuario(admin, datos) {
  const jwt = require("jsonwebtoken");
  const token = jwt.sign({ id: admin.id, rol: "admin", email: admin.email }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const url = process.env.AUTH_SERVICE_URL || "http://auth-service:3000";
  const res = await fetch(`${url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(datos),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (res.status !== 201) throw new Error(`auth-service no creó a ${datos.email}: ${res.status} ${cuerpo.error || ""}`);
  return cuerpo.id;
}

async function insertarEnLotes(conn, sql, filas, tam = 2000) {
  for (let i = 0; i < filas.length; i += tam) await conn.query(sql, [filas.slice(i, i + tam)]);
}

function estadoCultivo(siembra, cosecha) {
  if (cosecha !== null && cosecha < 0) return "cosechado";
  if (siembra > -21) return "sembrado";
  return "en_crecimiento";
}

async function cargar() {
  const pool = require(path.join(BASE, "db.js"));
  const conn = await pool.getConnection();
  const fin = Math.floor(Date.now() / PASO_MS) * PASO_MS;
  try {
    const [admins] = await conn.query("SELECT id, email FROM usuarios WHERE rol = 'admin' ORDER BY id");
    if (admins.length === 0) throw new Error("No hay ningún usuario administrador: no se borra nada");

    console.log("Borrando datos de operación (se conservan los administradores)...");
    await conn.beginTransaction();
    const borrados = await limpiar(conn);
    await conn.commit();
    console.log("  Borrado:", Object.entries(borrados).map(([t, n]) => `${t} ${n}`).join(", "));

    console.log("Creando usuarios con auth-service...");
    const credenciales = [];
    const ids = {};
    for (const [rol, u] of Object.entries(USUARIOS)) {
      const password = contrasena();
      ids[rol] = await crearUsuario(admins[0], { ...u, rol, password });
      credenciales.push({ rol, nombre: u.nombre, email: u.email, password });
    }

    console.log("Generando historial de 14 días...");
    for (const f of FINCAS) f.id = 0; // se asigna al insertar; el modelo solo lo usa como semilla
    // las fincas se insertan antes de simular para que la variación diaria use su id real
    await conn.beginTransaction();
    const creado = (dias) => aSqlUtc(fin - dias * DIA_MS);
    for (const f of FINCAS) {
      const [r] = await conn.query("INSERT INTO fincas (nombre, ubicacion, usuario_id, creado_en) VALUES (?, ?, ?, ?)", [
        f.nombre, f.ubicacion, ids.agricultor, creado(200),
      ]);
      f.id = r.insertId;
    }
    const historial = generarHistorial(fin);

    let n = 0;
    const lecturas = [];
    const alertas = [];
    const riegos = [];
    const registros = [];
    for (const h of historial.resultado) {
      const { finca: f, parcela: p } = h;
      n++;
      const [rp] = await conn.query(
        `INSERT INTO parcelas (nombre, finca_id, humedad_min, humedad_max, temperatura_max, temperatura_min, riego_automatico, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.nombre, f.id, p.min, p.max, p.tMax, p.tMin, p.auto, creado(190)]
      );
      p.id = rp.insertId;
      const codigo = `AGS-${f.codigo}-${String(f.parcelas.indexOf(p) + 1).padStart(2, "0")}`;
      const [re] = await conn.query(
        "INSERT INTO estaciones (codigo, parcela_id, api_key_hash, creado_en) VALUES (?, ?, ?, ?)",
        [codigo, p.id, crypto.createHash("sha256").update(crypto.randomBytes(24)).digest("hex"), creado(DIAS_HISTORIAL + 6)]
      );
      p.estacionId = re.insertId;
      // token de vinculación ya usado (así quedó registrada la estación)
      await conn.query(
        `INSERT INTO sensor_tokens (token, parcela_id, estado, creado_en, expira_en, usado_en, estacion_id)
         VALUES (?, ?, 'usado', ?, ?, ?, ?)`,
        [crypto.randomBytes(16).toString("hex"), p.id, creado(DIAS_HISTORIAL + 6.01), aSqlUtc(fin - (DIAS_HISTORIAL + 6.01) * DIA_MS + 30 * MIN_MS),
         creado(DIAS_HISTORIAL + 6), p.estacionId]
      );
      if (p.agronoma) await conn.query("INSERT INTO usuario_parcelas (usuario_id, parcela_id) VALUES (?, ?)", [ids.agronomo, p.id]);

      p.programaIds = {};
      for (const [nombre, dias, hora, minutos] of p.programas) {
        const [rg] = await conn.query(
          `INSERT INTO riego_programaciones (parcela_id, nombre, dias_semana, hora_inicio, duracion_minutos, activa, creado_en)
           VALUES (?, ?, ?, ?, ?, TRUE, ?)`,
          [p.id, nombre, dias, `${hora}:00`, minutos, creado(40)]
        );
        p.programaIds[nombre] = rg.insertId;
      }

      for (const l of h.lecturas) {
        lecturas.push([p.estacionId, l.humedad_suelo, l.temperatura, l.humedad_ambiental, aSqlUtc(l.t)]);
      }
      for (const r of h.riegos) {
        const terminado = r.estado !== "en_curso" || r.inicio + r.minutos * MIN_MS <= fin;
        const estado = r.estado === "omitido" ? "omitido" : terminado ? "completado" : "en_curso";
        const finRiego = estado === "omitido" ? r.inicio : estado === "completado" ? r.inicio + r.minutos * MIN_MS : null;
        riegos.push([p.id, r.programa ? p.programaIds[r.programa] : null, r.origen, aSqlLocal(r.inicio),
          finRiego === null ? null : aSqlLocal(finRiego), r.minutos, estado, r.motivo || null, aSqlUtc(r.inicio)]);
      }

      // quién atiende: la agrónoma en sus parcelas, si no el agricultor
      const responsable = p.agronoma ? ids.agronomo : ids.agricultor;
      const deSensor = h.alertas.map((a) => {
        if (a.estado === "activa" && h.objetivo && p === historial.objetivos.atendida) {
          return { ...a, estado: "atendida", atendidaPor: ids.agronomo, atendidaEn: Math.min(a.fecha + 35 * MIN_MS, fin - 10 * MIN_MS) };
        }
        if (a.estado === "resuelta" && a.tipo === "Necesita riego" && a.resuelta - a.fecha > 40 * MIN_MS && Math.random() < 0.4) {
          return { ...a, atendidaPor: responsable, atendidaEn: a.fecha + Math.round(azar(15, 35)) * MIN_MS };
        }
        return a;
      });
      for (const a of [...deSensor, ...alertasDeLluvia(h.lluvias, fin)]) {
        const repeticiones = a.categoria === "sensor" ? Math.max(1, Math.round(a.repeticiones * 6.5)) : a.repeticiones;
        alertas.push([p.id, a.categoria === "sensor" ? p.estacionId : null, a.tipo, a.categoria, a.severidad, a.estado, a.detalle,
          repeticiones, r1(a.valor), aSqlUtc(a.ultima), a.atendidaPor || null, a.atendidaEn ? aSqlUtc(a.atendidaEn) : null,
          a.resuelta ? aSqlUtc(a.resuelta) : null, aSqlUtc(a.fecha)]);
      }

      // registros de campo: dos por semana, a media mañana
      for (let d = DIAS_HISTORIAL - 1; d >= 1; d -= Math.random() < 0.5 ? 3 : 4) {
        const t = medianocheLocal(fin, -d) + Math.round(azar(9, 11.5) * 60) * MIN_MS;
        const l = h.lecturas.reduce((cerca, x) => (Math.abs(x.t - t) < Math.abs(cerca.t - t) ? x : cerca));
        registros.push([p.id, responsable, Math.round(l.humedad_suelo + azar(-3, 3)), r1(l.temperatura + azar(-1, 1)), elegir(NOTAS_CAMPO), aSqlUtc(t)]);
      }
    }

    for (const [finca, parcela, tipo, variedad, siembra, cosecha, cantidad, unidad, notas] of CULTIVOS) {
      const f = FINCAS.find((x) => x.nombre === finca);
      const p = parcela ? f.parcelas.find((x) => x.nombre === parcela) : null;
      await conn.query(
        `INSERT INTO cultivos (finca_id, parcela_id, tipo, variedad, fecha_siembra, fecha_cosecha_estimada, cantidad, unidad, estado, notas, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.id, p ? p.id : null, tipo, variedad, aFecha(fin + siembra * DIA_MS), cosecha === null ? null : aFecha(fin + cosecha * DIA_MS),
          cantidad, unidad, estadoCultivo(siembra, cosecha), notas, aSqlUtc(fin + Math.max(siembra, -DIAS_HISTORIAL) * DIA_MS)]
      );
    }

    // lecturas en orden de tiempo (los listados de "recientes" ordenan por id)
    lecturas.sort((a, b) => (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0));
    await insertarEnLotes(conn, "INSERT INTO lecturas (estacion_id, humedad_suelo, temperatura, humedad_ambiental, fecha) VALUES ?", lecturas);
    alertas.sort((a, b) => (a[13] < b[13] ? -1 : 1));
    await insertarEnLotes(conn,
      `INSERT INTO alertas (parcela_id, estacion_id, tipo, categoria, severidad, estado, detalle, repeticiones, ultimo_valor,
                            ultima_lectura_en, atendida_por, atendida_en, resuelta_en, fecha) VALUES ?`, alertas);
    riegos.sort((a, b) => (a[8] < b[8] ? -1 : 1));
    await insertarEnLotes(conn,
      `INSERT INTO riego_eventos (parcela_id, programacion_id, origen, inicio, fin, duracion_minutos, estado, motivo, creado_en) VALUES ?`, riegos);
    registros.sort((a, b) => (a[5] < b[5] ? -1 : 1));
    await insertarEnLotes(conn,
      "INSERT INTO registros_manuales (parcela_id, usuario_id, humedad_suelo, temperatura, anotaciones, fecha) VALUES ?", registros);
    await conn.commit();

    console.log(`Listo (${historial.intentos} intento(s) de historial):`);
    console.log(`  ${FINCAS.length} fincas, ${n} parcelas y estaciones, ${CULTIVOS.length} cultivos`);
    console.log(`  ${lecturas.length} lecturas, ${riegos.length} riegos, ${alertas.length} alertas, ${registros.length} registros de campo`);
    console.log(`  Alerta vigente: ${historial.objetivos.activa?.nombre || "—"} (activa), ${historial.objetivos.atendida?.nombre || "—"} (atendida)`);
    console.log("\nCredenciales (se muestran solo esta vez; no se guardan en ningún archivo):");
    for (const c of credenciales) console.log(`  ${c.rol.padEnd(11)} ${c.email.padEnd(32)} ${c.password}`);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

// Solo calcula el historial y muestra un resumen (no toca la base)
function simular() {
  FINCAS.forEach((f, i) => (f.id = i + 1));
  const fin = Math.floor(Date.now() / PASO_MS) * PASO_MS;
  const h = generarHistorial(fin);
  console.log(`Historial desde ${aSqlLocal(h.inicio)} hasta ${aSqlLocal(fin)} (hora local), ${h.intentos} intento(s)`);
  console.log(`Vigentes al final: ${h.objetivos.activa?.nombre} (activa), ${h.objetivos.atendida?.nombre} (atendida)`);
  for (const r of h.resultado) {
    const hs = r.lecturas.map((l) => l.humedad_suelo);
    const ts = r.lecturas.map((l) => l.temperatura);
    const cuenta = (o) => r.riegos.filter((x) => x.origen === o && x.estado !== "omitido").length;
    console.log(
      `${r.finca.nombre.padEnd(19)} ${r.parcela.nombre.padEnd(16)} hum ${Math.min(...hs).toFixed(0)}-${Math.max(...hs).toFixed(0)} ` +
        `(prom ${r.promedio.toFixed(1)}, final ${hs[hs.length - 1].toFixed(1)}) temp ${Math.min(...ts).toFixed(1)}-${Math.max(...ts).toFixed(1)} | ` +
        `riegos prog ${cuenta("programado")} auto ${cuenta("automatico")} manual ${cuenta("manual")} ` +
        `omit ${r.riegos.filter((x) => x.estado === "omitido").length} | alertas ${r.alertas.length} ` +
        `(${[...new Set(r.alertas.map((a) => a.tipo))].join("; ")})`
    );
  }
}

if (SIMULAR) {
  simular();
} else if (!CONFIRMAR) {
  console.log("Borra los datos de operación (todo salvo los administradores) y carga los datos iniciales.");
  console.log("Para hacerlo, vuelve a correrlo con --confirmar (o con --simular para ver el historial sin tocar la base).");
  process.exitCode = 1;
} else {
  cargar().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
