// Clima de una finca: estado actual, pronóstico de las próximas 24 h y
// eventos (lluvia, helada, ola de calor, viento) que se crean a mano
// (POST /clima/evento) o al azar.
//
// La temperatura sale del mismo modelo que las lecturas de las estaciones
// (modelo.js), con el perfil de la finca (media y amplitud del día), así el
// pronóstico y lo que miden los sensores coinciden. Los eventos aleatorios
// son los propios del lugar (heladas solo en fincas frías, olas de calor en
// las cálidas, lluvias de tarde) y se anuncian con horas de anticipación:
// primero aparecen en el pronóstico (lecturas-service avisa "helada esta
// noche") y después ocurren. El pronóstico conoce los eventos programados.

const { HORA_MS, ZONA, horaLocal, temperaturaLugar, ajusteEvento } = require("./modelo");

const TIPOS = ["lluvia", "helada", "ola_calor", "viento"];
const ALEATORIOS = process.env.SIM_CLIMA_ALEATORIO !== "false";
// Eventos aleatorios por día y por finca (en promedio)
const EVENTOS_POR_DIA = Number(process.env.SIM_CLIMA_EVENTOS_POR_DIA) || 0.5;

const redondear = (v) => Math.round(v * 10) / 10;

const formatoFecha = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
// "YYYY-MM-DDTHH:MM:SS" en hora local (la que ve la gente)
function aTexto(ms) {
  const p = Object.fromEntries(formatoFecha.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

// Horas que faltan para la próxima vez que el reloj local marque `hora`
const horasHasta = (ms, hora) => (hora - horaLocal(ms) + 24) % 24;

class ClimaFinca {
  // perfil: { media, amplitud } en °C
  constructor(finca, perfil) {
    this.finca = finca; // { id, nombre }
    this.perfil = perfil;
    this.eventos = []; // { id, tipo, inicioMs, finMs, origen }
    this.siguienteId = 1;
  }

  // Programa un evento que empieza dentro de enHoras (0 = ahora)
  programar({ tipo, duracionHoras, enHoras = 0, origen = "manual" }, ahoraMs) {
    const inicioMs = ahoraMs + enHoras * HORA_MS;
    const evento = { id: this.siguienteId++, tipo, inicioMs, finMs: inicioMs + duracionHoras * HORA_MS, origen };
    this.eventos.push(evento);
    this.eventos.sort((a, b) => a.inicioMs - b.inicioMs);
    console.log(
      `[clima] ${this.finca.nombre}: ${tipo} (${origen}) ${enHoras ? `en ${redondear(enHoras)} h` : "ahora"}, ${duracionHoras} h`
    );
    return evento;
  }

  limpiar() {
    const cantidad = this.eventos.length;
    this.eventos = [];
    return cantidad;
  }

  activo(ms) {
    const vigentes = this.eventos.filter((e) => e.inicioMs <= ms && ms < e.finMs);
    return vigentes[vigentes.length - 1] || null;
  }

  // Eventos posibles en este lugar, con su peso
  tiposDelLugar() {
    const tipos = [["lluvia", 6], ["viento", 1]];
    if (this.perfil.media < 17) tipos.push(["helada", 1]);
    if (this.perfil.media >= 24) tipos.push(["ola_calor", 1]);
    return tipos;
  }

  // Descarta eventos terminados y, con cierta probabilidad por hora, anuncia
  // uno nuevo para dentro de unas horas
  avanzar(desdeMs, hastaMs, aleatorios) {
    this.eventos = this.eventos.filter((e) => e.finMs > hastaMs);
    if (!aleatorios) return;
    const horas = (hastaMs - desdeMs) / HORA_MS;
    if (Math.random() >= (EVENTOS_POR_DIA / 24) * horas) return;
    if (this.eventos.some((e) => e.inicioMs > hastaMs)) return; // ya hay uno anunciado
    const tipos = this.tiposDelLugar();
    let r = Math.random() * tipos.reduce((n, [, peso]) => n + peso, 0);
    const [tipo] = tipos.find(([, peso]) => (r -= peso) < 0) || tipos[0];
    // lluvia de tarde, helada de madrugada, calor desde media mañana; viento a media tarde
    const inicio = { lluvia: 14 + Math.random() * 3, helada: 2, ola_calor: 11, viento: 13 }[tipo];
    let enHoras = horasHasta(hastaMs, inicio);
    if (enHoras < 4) enHoras += 24;
    const duracion = { lluvia: 1.5 + Math.random() * 2.5, helada: 4, ola_calor: 7, viento: 2 + Math.random() * 2 }[tipo];
    this.programar({ tipo, duracionHoras: redondear(duracion), enHoras: redondear(enHoras), origen: "aleatorio" }, hastaMs);
  }

  // Condición del clima de la finca en un instante
  condicionEn(ms) {
    const h = horaLocal(ms);
    const evento = this.activo(ms);
    const tipo = evento ? evento.tipo : null;
    const temperatura = ajusteEvento(temperaturaLugar(this.perfil, this.finca.id, ms), tipo);
    let viento = 6 + 8 * Math.max(0, Math.sin((2 * Math.PI * (h - 10)) / 24));
    if (tipo === "viento") viento = 60;
    const condicion = { lluvia: "Lluvia", helada: "Helada", ola_calor: "Ola de calor", viento: "Viento fuerte" }[tipo]
      || (h >= 6 && h < 18 ? "Despejado" : "Noche despejada");
    return {
      fecha_hora: aTexto(ms),
      temperatura: redondear(temperatura),
      lluvia_mm: tipo === "lluvia" ? 4 : 0,
      prob_lluvia: tipo === "lluvia" ? 95 : 10,
      viento_kmh: Math.round(viento),
      condicion,
      evento: tipo,
    };
  }

  describirEvento(e, ahoraMs) {
    return {
      id: e.id,
      tipo: e.tipo,
      desde: aTexto(e.inicioMs),
      hasta: aTexto(e.finMs),
      origen: e.origen,
      en_curso: e.inicioMs <= ahoraMs && ahoraMs < e.finMs,
    };
  }

  // Respuesta de GET /clima
  snapshot(ahoraMs, aleatorios) {
    const inicioHora = Math.floor(ahoraMs / HORA_MS) * HORA_MS;
    const evento = this.activo(ahoraMs);
    return {
      finca: this.finca,
      ahora: { ...this.condicionEn(ahoraMs), evento: evento ? this.describirEvento(evento, ahoraMs) : null },
      pronostico: Array.from({ length: 24 }, (_, i) => this.condicionEn(inicioHora + (i + 1) * HORA_MS)),
      eventos: this.eventos.map((e) => this.describirEvento(e, ahoraMs)),
      eventos_aleatorios: aleatorios,
      tipos_evento: TIPOS,
    };
  }
}

module.exports = { ClimaFinca, TIPOS_EVENTO: TIPOS, ALEATORIOS, aTexto };
