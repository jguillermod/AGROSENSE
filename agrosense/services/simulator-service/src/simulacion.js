// Motor de la simulación: mantiene el estado de cada estación demo y cada
// intervalo envía una lectura por estación al lecturas-service, igual que
// lo haría un ESP32 (POST /api/lecturas con la cabecera x-api-key).
//
// Modelo (en horas simuladas; SIM_TIME_SCALE convierte tiempo real a
// simulado, p. ej. 144 = un día simulado cada 10 minutos reales):
// - Humedad de suelo: random walk que baja por evaporación (más rápido con
//   calor). Sube mientras la parcela tiene un riego en curso en el motor de
//   riego de fincas-service (programado, manual o automático). Si la parcela
//   no tiene riego automático, en "normal"/"ola_calor" además se simula un
//   riego implícito (lluvia/riego no registrado) que la mantiene en rango.
// - Temperatura: ciclo día/noche senoidal (máxima ~15:00, mínima ~03:00)
//   más ruido pequeño.
// - Humedad ambiental: inversa a la temperatura.
// - Clima (clima.js): los eventos de lluvia, helada, ola de calor y viento se
//   suman al escenario: la lluvia sube la humedad de suelo y ambiental y baja
//   la temperatura; la helada la lleva bajo la mínima de cada parcela; la ola
//   de calor la sube sobre la máxima; el viento seca el aire y el suelo.
// Los escenarios no cambian los valores de golpe: mueven gradualmente
// objetivos/desfases hasta cruzar los umbrales de cada parcela, así las
// alertas que se disparan son las reales del lecturas-service.

const { prepararDatosDemo, leerUmbrales } = require("./seed");
const { RelojSimulado } = require("./reloj");
const { ClimaSimulado } = require("./clima");

const { cabeceraServicio } = require("./verificarJWT");

const LECTURAS_URL = process.env.LECTURAS_SERVICE_URL || "http://lecturas-service:3000";
const FINCAS_URL = process.env.FINCAS_SERVICE_URL || "http://fincas-service:3000";
const ESCENARIOS = ["normal", "sequia", "ola_calor", "exceso_lluvia"];
const TICKS_ENTRE_REFRESCOS = 6;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const redondear = (v) => Math.round(v * 100) / 100;
// Ruido gaussiano (Box-Muller)
const ruido = (sigma) => sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
// Fracción del camino hacia un objetivo en dtH horas con tasa k (1/h);
// no depende del intervalo elegido.
const acercar = (dtH, k) => 1 - Math.exp(-k * dtH);

class Simulador {
  constructor({ intervalo, escala, escenario, pausado }) {
    this.intervalo = intervalo;
    this.escala = escala;
    this.escenario = ESCENARIOS.includes(escenario) ? escenario : "normal";
    this.pausado = pausado;
    this.estado = "inicializando";
    this.reloj = new RelojSimulado();
    this.clima = new ClimaSimulado();
    this.ultimoTickReal = Date.now();
    this.regando = new Set(); // ids de parcelas con un riego en curso
    this.finca = null;
    this.parcelas = [];
    this.ticks = 0;
    this.lecturasEnviadas = 0;
    this.alertasDisparadas = 0;
    this.errores = 0;
    this.ultimoError = null;
    this.requiereResync = false;
    this.timer = null;
    this.enCurso = false;
  }

  async iniciar() {
    await this.reloj.cargar();
    for (;;) {
      try {
        await this.sincronizar();
        break;
      } catch (err) {
        this.registrarError(`No se pudieron preparar los datos demo: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    this.estado = "listo";
    console.log(
      `[sim] Listo: ${this.parcelas.length} parcelas, ${this.totalEstaciones()} estaciones, ` +
        `intervalo ${this.intervalo}s, escala x${this.escala}, escenario "${this.escenario}"` +
        (this.pausado ? " (pausado)" : "")
    );
    this.programar();
  }

  // Carga (o recrea) los datos demo conservando el estado simulado de las
  // estaciones que ya existían.
  async sincronizar() {
    const { finca, parcelas } = await prepararDatosDemo();
    const previas = new Map(this.parcelas.map((p) => [p.id, p]));
    this.finca = finca;
    this.parcelas = parcelas.map((p) => {
      const previa = previas.get(p.id);
      const estadosPrevios = new Map((previa?.estaciones || []).map((e) => [e.id, e]));
      return {
        ...p,
        riego_automatico: Boolean(p.riego_automatico),
        temperatura_min: p.temperatura_min,
        desfaseTemp: previa?.desfaseTemp ?? 0,
        desfaseHr: previa?.desfaseHr ?? 0,
        estaciones: p.estaciones.map((e) => {
          const prev = estadosPrevios.get(e.id);
          if (prev) return { ...prev, apiKey: e.apiKey };
          return {
            ...e,
            suelo: (p.humedad_min + p.humedad_max) / 2 + (Math.random() * 6 - 3),
            sesgoTemp: Math.random() - 0.5,
            riegoPendiente: 0,
            ultimaLectura: null,
            ultimaAlerta: null,
            enviadas: 0,
            errores: 0,
          };
        }),
      };
    });
    this.requiereResync = false;
  }

  programar() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.enCurso = true;
      try {
        await this.tick();
      } finally {
        this.enCurso = false;
        this.programar();
      }
    }, this.intervalo * 1000);
  }

  async tick() {
    if (this.pausado) return;
    this.ticks++;

    if (this.requiereResync || this.ticks % TICKS_ENTRE_REFRESCOS === 0) {
      await this.refrescar();
    }

    const dtH = (this.intervalo * this.escala) / 3600;
    const antes = this.reloj.ms;
    await this.reloj.avanzar(dtH);
    this.ultimoTickReal = Date.now();
    this.clima.avanzar(antes, this.reloj.ms);
    const hora = RelojSimulado.horaDelDia(this.reloj.ms);
    const evento = this.clima.activo(this.reloj.ms);
    await this.leerRiegosActivos();

    const envios = [];
    for (const p of this.parcelas) {
      this.avanzarParcela(p, dtH, hora, evento);
      for (const e of p.estaciones) {
        envios.push(this.enviar(e, this.generarLectura(p, e, dtH, hora, evento)));
      }
    }
    await Promise.allSettled(envios);
  }

  // Parcelas que el motor de riego (fincas-service) está regando ahora
  async leerRiegosActivos() {
    try {
      const res = await fetch(`${FINCAS_URL}/api/riego/activos`, {
        headers: cabeceraServicio(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`fincas-service respondió ${res.status}`);
      this.regando = new Set((await res.json()).map((r) => r.parcela_id));
    } catch (err) {
      this.regando = new Set();
      this.registrarError(`No se pudieron leer los riegos en curso: ${err.message}`);
    }
  }

  // Hora simulada actual. Entre vueltas se interpola con el tiempo real
  // transcurrido (sin pasar de un intervalo), para que el motor de riego vea
  // avanzar el reloj de forma continua y no a saltos de 24 minutos.
  horaActualMs() {
    if (this.estado !== "listo" || this.pausado) return this.reloj.ms;
    const transcurrido = Math.min(Date.now() - this.ultimoTickReal, this.intervalo * 1000);
    return this.reloj.ms + transcurrido * this.escala;
  }

  climaPublico() {
    return this.clima.snapshot(this.horaActualMs(), this.finca);
  }

  relojPublico() {
    return {
      modo: "simulado",
      ...this.reloj.describir(this.horaActualMs()),
      escala: this.escala,
      pausado: this.pausado || this.estado !== "listo",
    };
  }

  // Relee umbrales (por si se editaron en el panel). Si faltan los datos
  // demo o alguna api_key dejó de servir, los vuelve a preparar.
  async refrescar() {
    try {
      if (this.requiereResync) {
        await this.sincronizar();
        console.log("[sim] Datos demo re-sincronizados");
        return;
      }
      const actuales = await leerUmbrales(this.finca.id);
      for (const p of this.parcelas) {
        const a = actuales.find((x) => x.id === p.id);
        if (!a) {
          this.requiereResync = true;
          continue;
        }
        p.humedad_min = Number(a.humedad_min);
        p.humedad_max = Number(a.humedad_max);
        p.temperatura_max = Number(a.temperatura_max);
        p.riego_automatico = Boolean(a.riego_automatico);
        p.temperatura_min = a.temperatura_min === null ? null : Number(a.temperatura_min);
      }
    } catch (err) {
      this.registrarError(`No se pudieron refrescar los datos demo: ${err.message}`);
    }
  }

  // Temperatura media del lugar: templada, pero siempre por debajo del
  // umbral de la parcela para que en "normal" no salten alertas de calor.
  tempMedia(p) {
    return Math.min(24, p.temperatura_max - 10);
  }

  amplitud() {
    return this.escenario === "exceso_lluvia" ? 3 : 6;
  }

  // Mueve gradualmente los desfases de temperatura y humedad ambiental
  // hacia lo que piden el escenario actual y el evento de clima en curso.
  avanzarParcela(p, dtH, hora, evento) {
    const objetivos = {
      normal: { temp: 0, hr: 0 },
      sequia: { temp: 3, hr: -12 },
      // la media del día termina por encima del umbral: las tardes lo
      // superan con holgura y las noches bajan de él
      ola_calor: { temp: p.temperatura_max + 3 - this.tempMedia(p), hr: -8 },
      exceso_lluvia: { temp: -3, hr: 25 },
    }[this.escenario];
    let { temp, hr } = objetivos;
    let k = 0.35;
    // temperatura "normal" de esta hora, para fijar el objetivo de los eventos
    const base = this.tempMedia(p) + this.amplitud() * Math.sin((2 * Math.PI * (hora - 9)) / 24);
    if (evento?.tipo === "helada") {
      const tMin = p.temperatura_min ?? 5;
      temp = tMin - 3 - base;
      k = 1.2;
    } else if (evento?.tipo === "ola_calor") {
      temp = p.temperatura_max + 4 - base;
      hr -= 10;
      k = 1;
    } else if (evento?.tipo === "lluvia") {
      temp -= 4;
      hr += 20;
      k = 1;
    } else if (evento?.tipo === "viento") {
      hr -= 10;
      k = 1;
    }
    p.desfaseTemp += (temp - p.desfaseTemp) * acercar(dtH, k);
    p.desfaseHr += (hr - p.desfaseHr) * acercar(dtH, k);
  }

  generarLectura(p, e, dtH, hora, evento) {
    const amplitud = this.amplitud();
    const ciclo = Math.sin((2 * Math.PI * (hora - 9)) / 24); // pico a las 15:00
    const temperatura = this.tempMedia(p) + p.desfaseTemp + amplitud * ciclo + e.sesgoTemp + ruido(0.3);

    const lluvia = evento?.tipo === "lluvia";
    if (this.regando.has(p.id) || lluvia) {
      // riego en curso: el agua sube la humedad poco a poco hasta un tope
      // realista (capacidad de campo, algo por debajo del máximo de la
      // parcela). La lluvia sigue sumando y puede encharcar sobre el máximo.
      const tope = lluvia ? Math.min(98, p.humedad_max + 5) : Math.min(95, p.humedad_max - 3);
      if (e.suelo < tope) e.suelo += (tope - e.suelo) * acercar(dtH, lluvia ? 0.6 : 0.9);
      e.riegoPendiente = 0;
    } else if (this.escenario === "sequia") {
      // sin riego y con evaporación fuerte: tiende muy por debajo del mínimo
      const objetivo = Math.max(5, p.humedad_min - 12);
      e.suelo += (objetivo - e.suelo) * acercar(dtH, 0.25);
      e.riegoPendiente = 0;
    } else if (this.escenario === "exceso_lluvia") {
      // lluvia constante: el suelo se satura por encima del máximo
      const objetivo = Math.min(98, p.humedad_max + 10);
      e.suelo += (objetivo - e.suelo) * acercar(dtH, 0.3);
      e.riegoPendiente = 0;
    } else {
      // normal / ola_calor: evaporación según temperatura
      const factorCalor = clamp(1 + (temperatura - 22) / 12, 0.3, 2.5);
      const factorViento = evento?.tipo === "viento" ? 1.6 : 1;
      e.suelo -= 0.5 * factorCalor * factorViento * dtH;
      if (e.suelo > p.humedad_max - 2) {
        e.suelo -= (e.suelo - (p.humedad_max - 5)) * acercar(dtH, 0.2); // drenaje
      }
      // riego implícito solo sin riego automático: con él activo es el motor
      // de riego quien decide cuándo regar
      if (p.riego_automatico) e.riegoPendiente = 0;
      else if (e.suelo < p.humedad_min + 4 && e.riegoPendiente <= 0) {
        e.riegoPendiente = (p.humedad_max - p.humedad_min) * 0.45;
      }
      if (e.riegoPendiente > 0) {
        const aporte = Math.min(e.riegoPendiente, 12 * dtH);
        e.suelo += aporte;
        e.riegoPendiente -= aporte;
      }
    }
    e.suelo = clamp(e.suelo + ruido(0.25), 3, 100);

    const humedadAmbiental = clamp(85 - 2.2 * (temperatura - 12) + p.desfaseHr + ruido(1), 15, 99);

    return {
      estacion_id: e.id,
      humedad_suelo: redondear(e.suelo),
      temperatura: redondear(temperatura),
      humedad_ambiental: redondear(humedadAmbiental),
    };
  }

  async enviar(e, lectura) {
    try {
      const res = await fetch(`${LECTURAS_URL}/api/lecturas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": e.apiKey },
        body: JSON.stringify(lectura),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) this.requiereResync = true;
        throw new Error(`${res.status} ${data.error || ""}`.trim());
      }
      e.ultimaLectura = { ...lectura, fecha: new Date().toISOString() };
      e.enviadas++;
      this.lecturasEnviadas++;
      if (data.alerta) {
        e.ultimaAlerta = { tipo: data.alerta, fecha: e.ultimaLectura.fecha };
        this.alertasDisparadas++;
      }
    } catch (err) {
      e.errores++;
      this.registrarError(`Lectura de ${e.codigo}: ${err.message}`);
    }
  }

  registrarError(mensaje) {
    this.errores++;
    this.ultimoError = { mensaje, fecha: new Date().toISOString() };
    console.error(`[sim] ${mensaje}`);
  }

  // --- Control ---

  setEscenario(nombre) {
    this.escenario = nombre;
    console.log(`[sim] Escenario -> ${nombre}`);
  }

  pausar() {
    this.pausado = true;
  }

  reanudar() {
    this.pausado = false;
    this.ultimoTickReal = Date.now();
  }

  setIntervalo(segundos) {
    this.intervalo = segundos;
    // si hay un tick en curso, el siguiente ya se programa con el nuevo intervalo
    if (this.estado === "listo" && !this.enCurso) this.programar();
  }

  totalEstaciones() {
    return this.parcelas.reduce((n, p) => n + p.estaciones.length, 0);
  }

  status() {
    const { dia, hora, fecha_hora, dia_semana } = this.reloj.describir(this.horaActualMs());
    return {
      estado: this.estado === "listo" ? (this.pausado ? "pausado" : "corriendo") : this.estado,
      escenario: this.escenario,
      escenarios_disponibles: ESCENARIOS,
      intervalo_segundos: this.intervalo,
      escala_tiempo: this.escala,
      minutos_reales_por_dia_simulado: redondear((24 * 60) / this.escala),
      reloj_simulado: { dia, hora, fecha_hora, dia_semana },
      clima_evento: (() => {
        const ev = this.clima.activo(this.horaActualMs());
        return ev ? this.clima.describirEvento(ev, this.horaActualMs()) : null;
      })(),
      ticks: this.ticks,
      lecturas_enviadas: this.lecturasEnviadas,
      alertas_disparadas: this.alertasDisparadas,
      errores: this.errores,
      ultimo_error: this.ultimoError,
      finca: this.finca,
      parcelas: this.parcelas.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        umbrales: { humedad_min: p.humedad_min, humedad_max: p.humedad_max, temperatura_max: p.temperatura_max },
        regando: this.regando.has(p.id),
        riego_automatico: Boolean(p.riego_automatico),
        estaciones: p.estaciones.map((e) => ({
          id: e.id,
          codigo: e.codigo,
          ultima_lectura: e.ultimaLectura,
          ultima_alerta: e.ultimaAlerta,
          enviadas: e.enviadas,
          errores: e.errores,
        })),
      })),
    };
  }
}

module.exports = { Simulador, ESCENARIOS };
