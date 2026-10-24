// Envío de lecturas de las estaciones: cada 30 a 60 segundos manda una
// lectura por estación al lecturas-service, igual que lo haría un ESP32
// (POST /api/lecturas con la cabecera x-api-key).
//
// El modelo está en modelo.js (temperatura del lugar con ciclo día/noche,
// humedad ambiental y del suelo). La humedad del suelo baja por evaporación
// y sube mientras el motor de riego de fincas-service tiene un riego en curso
// en la parcela (programado, manual o automático) o mientras llueve. El clima
// de cada finca (clima.js) aporta los eventos de lluvia, helada, ola de calor
// y viento. Las alertas no se deciden aquí: las abre y resuelve
// lecturas-service con los umbrales de cada parcela.
//
// Todo el estado sale de la base (estaciones.js): al arrancar, o si
// lecturas-service rechaza una llave (p. ej. tras restaurar un respaldo), se
// vuelve a preparar sin pasos manuales.

const estaciones = require("./estaciones");
const modelo = require("./modelo");
const { Reloj } = require("./reloj");
const { ClimaFinca, ALEATORIOS } = require("./clima");
const { cabeceraServicio } = require("./verificarJWT");

const LECTURAS_URL = process.env.LECTURAS_SERVICE_URL || "http://lecturas-service:3000";
const FINCAS_URL = process.env.FINCAS_SERVICE_URL || "http://fincas-service:3000";
// "normal" o un escenario forzado para ensayar alertas (POST /scenario)
const ESCENARIOS = ["normal", "sequia", "ola_calor", "exceso_lluvia"];
const EVENTO_DE_ESCENARIO = { sequia: "sequia", ola_calor: "ola_calor", exceso_lluvia: "lluvia" };
const TICKS_ENTRE_REFRESCOS = 10;
const ESPERA_SIN_ESTACIONES_MS = 60 * 1000;

class Simulador {
  // intervalo: { min, max } en segundos
  constructor({ intervalo, escala, escenario, pausado }) {
    this.intervalo = intervalo;
    this.escenario = ESCENARIOS.includes(escenario) ? escenario : "normal";
    this.pausado = pausado;
    this.estado = "inicializando";
    this.reloj = new Reloj(escala);
    this.climas = new Map(); // finca_id -> ClimaFinca
    this.aleatorios = ALEATORIOS;
    this.ultimoTickMs = null;
    this.regando = new Set(); // ids de parcelas con un riego en curso
    this.estaciones = [];
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
        this.registrarError(`No se pudieron preparar las estaciones: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    this.estado = "listo";
    console.log(
      `[estaciones] Listo: ${this.estaciones.length} estaciones en ${this.climas.size} fincas, ` +
        `cada ${this.intervalo.min}-${this.intervalo.max} s, reloj ${this.reloj.modo}` +
        (this.pausado ? " (pausado)" : "")
    );
    this.programar();
  }

  // Lee de la base las estaciones (con llave nueva y el hueco rellenado) y
  // arma el clima de cada finca; conserva los eventos de clima ya anunciados.
  async sincronizar() {
    const { estaciones: lista, perfiles } = await estaciones.preparar();
    const climas = new Map();
    for (const e of lista) {
      if (climas.has(e.finca_id)) continue;
      const previo = this.climas.get(e.finca_id);
      const clima = new ClimaFinca({ id: e.finca_id, nombre: e.finca_nombre }, perfiles.get(e.finca_id));
      if (previo) {
        clima.eventos = previo.eventos;
        clima.siguienteId = previo.siguienteId;
      }
      climas.set(e.finca_id, clima);
    }
    this.climas = climas;
    this.estaciones = lista.map((e) => ({ ...e, ultimaLectura: null, ultimaAlerta: null, enviadas: 0, errores: 0 }));
    this.ultimoTickMs = this.reloj.ahora();
    this.requiereResync = false;
  }

  siguienteIntervaloMs() {
    const { min, max } = this.intervalo;
    return (min + Math.random() * (max - min)) * 1000;
  }

  programar(esperaMs = this.siguienteIntervaloMs()) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.enCurso = true;
      try {
        await this.tick();
      } catch (err) {
        this.registrarError(err.message);
      } finally {
        this.enCurso = false;
        this.programar(this.estaciones.length ? undefined : ESPERA_SIN_ESTACIONES_MS);
      }
    }, esperaMs);
  }

  async tick() {
    if (this.pausado) return;
    this.ticks++;

    if (!this.requiereResync && (this.ticks % TICKS_ENTRE_REFRESCOS === 0 || this.estaciones.length === 0)) {
      await this.refrescar();
    }
    if (this.requiereResync) {
      await this.sincronizar();
      console.log(`[estaciones] Re-sincronizadas: ${this.estaciones.length} estaciones con llave nueva`);
    }
    if (this.estaciones.length === 0) return;

    const ahora = this.reloj.ahora();
    const dtH = Math.max(0, ahora - this.ultimoTickMs) / modelo.HORA_MS;
    for (const clima of this.climas.values()) clima.avanzar(this.ultimoTickMs, ahora, this.aleatorios);
    this.ultimoTickMs = ahora;
    await this.leerRiegosActivos();

    await Promise.allSettled(
      this.estaciones.map((e) => this.enviar(e, this.generarLectura(e, dtH, ahora)))
    );
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

  // Relee umbrales (por si se editaron en la web o la app). Si cambió el
  // conjunto de estaciones, se vuelve a preparar todo.
  async refrescar() {
    try {
      const actuales = await estaciones.leerUmbrales();
      const ids = (lista) => lista.map((e) => e.id).sort().join(",");
      if (ids(actuales) !== ids(this.estaciones)) {
        this.requiereResync = true; // se vuelve a preparar en esta misma vuelta
        return;
      }
      for (const e of this.estaciones) {
        const a = actuales.find((x) => x.id === e.id);
        Object.assign(e, {
          humedad_min: a.humedad_min,
          humedad_max: a.humedad_max,
          temperatura_max: a.temperatura_max,
          temperatura_min: a.temperatura_min,
          riego_automatico: a.riego_automatico,
        });
      }
    } catch (err) {
      this.registrarError(`No se pudieron refrescar las estaciones: ${err.message}`);
    }
  }

  generarLectura(e, dtH, ahora) {
    const clima = this.climas.get(e.finca_id);
    const evento = clima.activo(ahora)?.tipo || EVENTO_DE_ESCENARIO[this.escenario] || null;
    const desfase = clima.perfil.desfaseParcela.get(e.parcela_id) || 0;
    const temp = modelo.ajusteEvento(modelo.temperaturaLugar(clima.perfil, e.finca_id, ahora) + desfase, evento);
    e.suelo = modelo.pasoSuelo(e.suelo, dtH, { temp, regando: this.regando.has(e.parcela_id), evento, parcela: e });
    return modelo.lectura({ estacionId: e.id, suelo: e.suelo, temp, evento });
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
    console.error(`[estaciones] ${mensaje}`);
  }

  // --- Clima ---

  // Clima de una finca (o de la primera), con la lista de fincas
  climaPublico(fincaId) {
    const clima = this.climas.get(Number(fincaId)) || this.climas.values().next().value;
    if (!clima) return null;
    return {
      ...clima.snapshot(this.reloj.ahora(), this.aleatorios),
      fincas: [...this.climas.values()].map((c) => c.finca),
    };
  }

  // Fincas a las que aplica un evento manual: una o todas
  climasDe(fincaId) {
    if (fincaId === undefined || fincaId === null || fincaId === "") return [...this.climas.values()];
    const clima = this.climas.get(Number(fincaId));
    return clima ? [clima] : [];
  }

  relojPublico() {
    return {
      modo: this.reloj.modo,
      ...this.reloj.describir(this.reloj.ahora()),
      escala: this.reloj.escala,
      pausado: this.pausado || this.estado !== "listo",
    };
  }

  // --- Control ---

  setEscenario(nombre) {
    this.escenario = nombre;
    console.log(`[estaciones] Escenario -> ${nombre}`);
  }

  pausar() {
    this.pausado = true;
  }

  reanudar() {
    this.pausado = false;
    this.ultimoTickMs = this.reloj.ahora();
  }

  setIntervalo(segundos) {
    this.intervalo = { min: segundos, max: segundos };
    // si hay una vuelta en curso, la siguiente ya se programa con el nuevo intervalo
    if (this.estado === "listo" && !this.enCurso) this.programar();
  }

  status() {
    return {
      estado: this.estado === "listo" ? (this.pausado ? "pausado" : "corriendo") : this.estado,
      escenario: this.escenario,
      escenarios_disponibles: ESCENARIOS,
      intervalo_segundos: this.intervalo,
      reloj: this.relojPublico(),
      ticks: this.ticks,
      lecturas_enviadas: this.lecturasEnviadas,
      alertas_disparadas: this.alertasDisparadas,
      errores: this.errores,
      ultimo_error: this.ultimoError,
      fincas: [...this.climas.values()].map((c) => {
        const ev = c.activo(this.reloj.ahora());
        return {
          ...c.finca,
          perfil_clima: { media: modelo.redondear(c.perfil.media), amplitud: modelo.redondear(c.perfil.amplitud) },
          clima_evento: ev ? c.describirEvento(ev, this.reloj.ahora()) : null,
        };
      }),
      estaciones: this.estaciones.map((e) => ({
        id: e.id,
        codigo: e.codigo,
        finca: e.finca_nombre,
        parcela: e.parcela_nombre,
        regando: this.regando.has(e.parcela_id),
        ultima_lectura: e.ultimaLectura,
        ultima_alerta: e.ultimaAlerta,
        enviadas: e.enviadas,
        errores: e.errores,
      })),
    };
  }
}

module.exports = { Simulador, ESCENARIOS };
