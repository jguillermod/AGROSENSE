// Reloj de las estaciones y del motor de riego (GET /reloj).
//
// Con SIM_TIME_SCALE=1 (por defecto) es la hora real: cada consulta toma
// Date.now(), así nunca se adelanta ni acumula desfase, y la fecha que se
// publica es la hora local de APP_TIMEZONE (America/Guatemala).
// Con una escala mayor (solo para ensayar a mano) el tiempo avanza esa
// cantidad de veces más rápido desde el arranque; no se guarda en ningún
// archivo: al reiniciar vuelve a la hora real.

const { aTexto } = require("./clima");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

class Reloj {
  constructor(escala) {
    this.escala = escala;
    this.inicioReal = Date.now();
  }

  // Instante actual del reloj (ms UTC)
  ahora() {
    if (this.escala === 1) return Date.now();
    return this.inicioReal + (Date.now() - this.inicioReal) * this.escala;
  }

  get modo() {
    return this.escala === 1 ? "real" : "acelerado";
  }

  describir(ms) {
    const fechaHora = aTexto(ms);
    const [anio, mes, dia] = fechaHora.slice(0, 10).split("-").map(Number);
    return {
      fecha_hora: fechaHora,
      dia_semana: DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()],
      hora: fechaHora.slice(11, 16),
    };
  }
}

module.exports = { Reloj };
