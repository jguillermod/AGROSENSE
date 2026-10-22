// Reloj simulado: fecha y hora "de pared" (sin zona horaria, en un Date cuyos
// campos UTC son la hora local) que avanza SIM_TIME_SCALE veces más rápido
// que la real. Lo usan el propio simulador (ciclo día/noche) y el motor de
// riego de fincas-service (GET /reloj), para que las programaciones se
// disparen en pocos minutos reales.
//
// Arranca hoy a las 06:00 (hora local de APP_TIMEZONE) y se guarda en el
// volumen del simulador: al reiniciar continúa donde iba en vez de volver
// atrás, así la bitácora de riego nunca queda con horas desordenadas.

const fs = require("fs/promises");
const path = require("path");

const ARCHIVO = process.env.SIM_RELOJ_FILE || "/data/reloj.json";
const ZONA = process.env.APP_TIMEZONE || "America/Guatemala";
const HORA_MS = 3600 * 1000;
const DIA_MS = 24 * HORA_MS;

function hoyALas6() {
  const [anio, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date()).split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia, 6, 0, 0);
}

class RelojSimulado {
  constructor() {
    this.ms = hoyALas6();
    this.inicioMs = this.ms; // para contar "día 1, día 2…"
  }

  async cargar() {
    try {
      const guardado = JSON.parse(await fs.readFile(ARCHIVO, "utf8"));
      if (Number.isFinite(guardado.ms) && Number.isFinite(guardado.inicioMs)) {
        this.ms = guardado.ms;
        this.inicioMs = guardado.inicioMs;
      }
    } catch (err) {
      // primera vez: arranca hoy a las 06:00
    }
  }

  async avanzar(horas) {
    this.ms += horas * HORA_MS;
    try {
      await fs.mkdir(path.dirname(ARCHIVO), { recursive: true });
      await fs.writeFile(ARCHIVO, JSON.stringify({ ms: this.ms, inicioMs: this.inicioMs }));
    } catch (err) {
      console.error(`[sim] No se pudo guardar el reloj: ${err.message}`);
    }
  }

  // Hora del día (0–24, con decimales) en un instante dado
  static horaDelDia(ms) {
    return (((ms % DIA_MS) + DIA_MS) % DIA_MS) / HORA_MS;
  }

  describir(ms) {
    const fecha = new Date(ms);
    const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const inicioDia = this.inicioMs - (((this.inicioMs % DIA_MS) + DIA_MS) % DIA_MS);
    return {
      fecha_hora: fecha.toISOString().slice(0, 19),
      dia: Math.floor((ms - inicioDia) / DIA_MS) + 1,
      dia_semana: dias[fecha.getUTCDay()],
      hora: fecha.toISOString().slice(11, 16),
    };
  }
}

module.exports = { RelojSimulado };
