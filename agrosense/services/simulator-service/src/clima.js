// Clima simulado de la finca demo: estado actual, pronóstico de las próximas
// 24 h simuladas y eventos (lluvia, helada, ola de calor, viento) que se
// crean a mano (POST /clima/evento) o al azar con el reloj simulado.
//
// Los eventos aleatorios se programan con varias horas de anticipación, así
// aparecen primero en el pronóstico (y lecturas-service puede avisar "helada
// esta noche") y después ocurren. El pronóstico es "perfecto": conoce los
// eventos programados.

const HORA_MS = 3600 * 1000;
const TIPOS = ["lluvia", "helada", "ola_calor", "viento"];
const ALEATORIOS = process.env.SIM_CLIMA_ALEATORIO !== "false";
// Eventos aleatorios por día simulado (en promedio)
const EVENTOS_POR_DIA = Number(process.env.SIM_CLIMA_EVENTOS_POR_DIA) || 1;

const redondear = (v) => Math.round(v * 10) / 10;
const horaDelDia = (ms) => (((ms % (24 * HORA_MS)) + 24 * HORA_MS) % (24 * HORA_MS)) / HORA_MS;
const aTexto = (ms) => new Date(ms).toISOString().slice(0, 19);

class ClimaSimulado {
  constructor() {
    this.eventos = []; // { id, tipo, inicioMs, finMs, origen }
    this.siguienteId = 1;
    this.aleatorios = ALEATORIOS;
  }

  // Programa un evento que empieza dentro de enHoras (0 = ahora)
  programar({ tipo, duracionHoras, enHoras = 0, origen = "manual" }, ahoraMs) {
    const inicioMs = ahoraMs + enHoras * HORA_MS;
    const evento = { id: this.siguienteId++, tipo, inicioMs, finMs: inicioMs + duracionHoras * HORA_MS, origen };
    this.eventos.push(evento);
    this.eventos.sort((a, b) => a.inicioMs - b.inicioMs);
    console.log(`[sim] Evento de clima ${tipo} (${origen}) ${enHoras ? `en ${enHoras} h` : "ahora"}, ${duracionHoras} h`);
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

  // Avance del reloj: descarta eventos terminados y, con cierta
  // probabilidad por hora simulada, programa uno nuevo para dentro de unas horas
  avanzar(desdeMs, hastaMs) {
    this.eventos = this.eventos.filter((e) => e.finMs > hastaMs);
    if (!this.aleatorios) return;
    const horas = (hastaMs - desdeMs) / HORA_MS;
    if (Math.random() >= (EVENTOS_POR_DIA / 24) * horas) return;
    if (this.eventos.some((e) => e.inicioMs > hastaMs)) return; // ya hay uno anunciado
    const tipo = TIPOS[Math.floor(Math.random() * TIPOS.length)];
    // helada: de madrugada; ola de calor: desde media mañana; el resto, en 6–14 h
    let enHoras = 6 + Math.random() * 8;
    let duracion = 2 + Math.random() * 4;
    if (tipo === "helada" || tipo === "ola_calor") {
      const objetivo = tipo === "helada" ? 2 : 11;
      enHoras = (objetivo - horaDelDia(hastaMs) + 24) % 24;
      if (enHoras < 4) enHoras += 24;
      duracion = tipo === "helada" ? 4 : 7;
    }
    this.programar({ tipo, duracionHoras: redondear(duracion), enHoras: redondear(enHoras), origen: "aleatorio" }, hastaMs);
  }

  // Condición del clima en un instante (de la "zona", no de una parcela)
  condicionEn(ms) {
    const h = horaDelDia(ms);
    let temperatura = 22 + 6 * Math.sin((2 * Math.PI * (h - 9)) / 24);
    let lluvia = 0;
    let probLluvia = 10;
    let viento = 8 + 6 * Math.max(0, Math.sin((2 * Math.PI * (h - 10)) / 24));
    const evento = this.activo(ms);
    if (evento?.tipo === "lluvia") {
      lluvia = 4;
      probLluvia = 95;
      temperatura -= 4;
    } else if (evento?.tipo === "helada") {
      temperatura = Math.min(temperatura, 0);
    } else if (evento?.tipo === "ola_calor") {
      temperatura += 12;
    } else if (evento?.tipo === "viento") {
      viento = 60;
    }
    const condicion = { lluvia: "Lluvia", helada: "Helada", ola_calor: "Ola de calor", viento: "Viento fuerte" }[evento?.tipo]
      || (h >= 6 && h < 18 ? "Despejado" : "Noche despejada");
    return {
      fecha_hora: aTexto(ms),
      temperatura: redondear(temperatura),
      lluvia_mm: lluvia,
      prob_lluvia: probLluvia,
      viento_kmh: Math.round(viento),
      condicion,
      evento: evento ? evento.tipo : null,
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
  snapshot(ahoraMs, finca) {
    const inicioHora = Math.floor(ahoraMs / HORA_MS) * HORA_MS;
    const evento = this.activo(ahoraMs);
    return {
      finca,
      ahora: { ...this.condicionEn(ahoraMs), evento: evento ? this.describirEvento(evento, ahoraMs) : null },
      pronostico: Array.from({ length: 24 }, (_, i) => this.condicionEn(inicioHora + (i + 1) * HORA_MS)),
      eventos: this.eventos.map((e) => this.describirEvento(e, ahoraMs)),
      eventos_aleatorios: this.aleatorios,
      tipos_evento: TIPOS,
    };
  }
}

module.exports = { ClimaSimulado, TIPOS_EVENTO: TIPOS };
