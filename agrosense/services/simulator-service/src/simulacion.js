// Motor de la simulación: mantiene el estado de cada estación demo y cada
// intervalo envía una lectura por estación al lecturas-service, igual que
// lo haría un ESP32 (POST /api/lecturas con la cabecera x-api-key).
//
// Modelo (en horas simuladas; SIM_TIME_SCALE convierte tiempo real a
// simulado, p. ej. 144 = un día simulado cada 10 minutos reales):
// - Humedad de suelo: random walk que baja por evaporación (más rápido con
//   calor) y sube con riegos automáticos cuando se acerca al mínimo.
// - Temperatura: ciclo día/noche senoidal (máxima ~15:00, mínima ~03:00)
//   más ruido pequeño.
// - Humedad ambiental: inversa a la temperatura.
// Los escenarios no cambian los valores de golpe: mueven gradualmente
// objetivos/desfases hasta cruzar los umbrales de cada parcela, así las
// alertas que se disparan son las reales del lecturas-service.

const { prepararDatosDemo, leerUmbrales } = require("./seed");

const LECTURAS_URL = process.env.LECTURAS_SERVICE_URL || "http://lecturas-service:3000";
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
    this.horasSimuladas = 6; // arranca el día 1 a las 06:00
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
    this.horasSimuladas += dtH;
    const hora = this.horasSimuladas % 24;

    const envios = [];
    for (const p of this.parcelas) {
      this.avanzarParcela(p, dtH);
      for (const e of p.estaciones) {
        envios.push(this.enviar(e, this.generarLectura(p, e, dtH, hora)));
      }
    }
    await Promise.allSettled(envios);
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

  // Mueve gradualmente los desfases de temperatura y humedad ambiental
  // hacia lo que pide el escenario actual.
  avanzarParcela(p, dtH) {
    const objetivos = {
      normal: { temp: 0, hr: 0 },
      sequia: { temp: 3, hr: -12 },
      // la media del día termina por encima del umbral: las tardes lo
      // superan con holgura y las noches bajan de él
      ola_calor: { temp: p.temperatura_max + 3 - this.tempMedia(p), hr: -8 },
      exceso_lluvia: { temp: -3, hr: 25 },
    }[this.escenario];
    p.desfaseTemp += (objetivos.temp - p.desfaseTemp) * acercar(dtH, 0.35);
    p.desfaseHr += (objetivos.hr - p.desfaseHr) * acercar(dtH, 0.35);
  }

  generarLectura(p, e, dtH, hora) {
    const amplitud = this.escenario === "exceso_lluvia" ? 3 : 6;
    const ciclo = Math.sin((2 * Math.PI * (hora - 9)) / 24); // pico a las 15:00
    const temperatura = this.tempMedia(p) + p.desfaseTemp + amplitud * ciclo + e.sesgoTemp + ruido(0.3);

    if (this.escenario === "sequia") {
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
      // normal / ola_calor: evaporación según temperatura + riego automático
      const factorCalor = clamp(1 + (temperatura - 22) / 12, 0.3, 2.5);
      e.suelo -= 0.5 * factorCalor * dtH;
      if (e.suelo > p.humedad_max - 2) {
        e.suelo -= (e.suelo - (p.humedad_max - 5)) * acercar(dtH, 0.2); // drenaje
      }
      if (e.suelo < p.humedad_min + 4 && e.riegoPendiente <= 0) {
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
    const dia = Math.floor(this.horasSimuladas / 24) + 1;
    const minutos = Math.floor((this.horasSimuladas % 24) * 60);
    const hora = `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
    return {
      estado: this.estado === "listo" ? (this.pausado ? "pausado" : "corriendo") : this.estado,
      escenario: this.escenario,
      escenarios_disponibles: ESCENARIOS,
      intervalo_segundos: this.intervalo,
      escala_tiempo: this.escala,
      minutos_reales_por_dia_simulado: redondear((24 * 60) / this.escala),
      reloj_simulado: { dia, hora },
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
