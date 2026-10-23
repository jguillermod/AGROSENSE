/// Modelos de datos de AgroSense, uno por cada entidad expuesta por los
/// microservicios (fincas-service / lecturas-service).
library;

class Finca {
  final int id;
  final String nombre;
  final String? ubicacion;
  final int? usuarioId;
  final DateTime? creadoEn;

  Finca({
    required this.id,
    required this.nombre,
    this.ubicacion,
    this.usuarioId,
    this.creadoEn,
  });

  factory Finca.fromJson(Map<String, dynamic> json) {
    return Finca(
      id: json['id'] as int,
      nombre: json['nombre'] as String,
      ubicacion: json['ubicacion'] as String?,
      usuarioId: json['usuario_id'] as int?,
      creadoEn: json['creado_en'] != null ? DateTime.tryParse(json['creado_en']) : null,
    );
  }
}

class Parcela {
  final int id;
  final String nombre;
  final int fincaId;
  final double humedadMin;
  final double humedadMax;
  final double temperaturaMax;
  final double? humedadActual;
  final double? temperaturaActual;
  final String? estado;
  final DateTime? creadoEn;
  final bool riegoAutomatico;

  /// Solo viene informado en el listado de "mis parcelas" del agrónomo
  /// (GET /api/usuarios/:id/parcelas), que junta varias fincas a la vez.
  final String? fincaNombre;

  Parcela({
    required this.id,
    required this.nombre,
    required this.fincaId,
    required this.humedadMin,
    required this.humedadMax,
    required this.temperaturaMax,
    this.humedadActual,
    this.temperaturaActual,
    this.estado,
    this.creadoEn,
    this.fincaNombre,
    this.riegoAutomatico = false,
  });

  factory Parcela.fromJson(Map<String, dynamic> json) {
    double? parseNum(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return Parcela(
      id: json['id'] as int,
      nombre: json['nombre'] as String,
      fincaId: json['finca_id'] as int,
      humedadMin: parseNum(json['humedad_min']) ?? 30,
      humedadMax: parseNum(json['humedad_max']) ?? 85,
      temperaturaMax: parseNum(json['temperatura_max']) ?? 38,
      humedadActual: parseNum(json['humedad_actual']),
      temperaturaActual: parseNum(json['temperatura_actual']),
      estado: json['estado'] as String?,
      creadoEn: json['creado_en'] != null ? DateTime.tryParse(json['creado_en']) : null,
      fincaNombre: json['finca_nombre'] as String?,
      riegoAutomatico: json['riego_automatico'] == true || json['riego_automatico'] == 1,
    );
  }
}

class Estacion {
  final int id;
  final String codigo;
  final int? parcelaId;
  final String? parcelaNombre;
  final String? fincaNombre;
  final double? humedadSuelo;
  final double? temperatura;
  final double? humedadAmbiental;
  final DateTime? ultimaLectura;
  final DateTime? creadoEn;

  Estacion({
    required this.id,
    required this.codigo,
    this.parcelaId,
    this.parcelaNombre,
    this.fincaNombre,
    this.humedadSuelo,
    this.temperatura,
    this.humedadAmbiental,
    this.ultimaLectura,
    this.creadoEn,
  });

  factory Estacion.fromJson(Map<String, dynamic> json) {
    double? parseNum(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return Estacion(
      id: json['id'] as int,
      codigo: json['codigo'] as String,
      parcelaId: json['parcela_id'] as int?,
      parcelaNombre: json['parcela_nombre'] as String?,
      fincaNombre: json['finca_nombre'] as String?,
      humedadSuelo: parseNum(json['humedad_suelo']),
      temperatura: parseNum(json['temperatura']),
      humedadAmbiental: parseNum(json['humedad_ambiental']),
      ultimaLectura: json['ultima_lectura'] != null ? DateTime.tryParse(json['ultima_lectura']) : null,
      creadoEn: json['creado_en'] != null ? DateTime.tryParse(json['creado_en']) : null,
    );
  }
}

class Lectura {
  final int id;
  final int estacionId;
  final double humedadSuelo;
  final double temperatura;
  final double humedadAmbiental;
  final DateTime fecha;

  Lectura({
    required this.id,
    required this.estacionId,
    required this.humedadSuelo,
    required this.temperatura,
    required this.humedadAmbiental,
    required this.fecha,
  });

  factory Lectura.fromJson(Map<String, dynamic> json) {
    double parseNum(dynamic v) {
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0;
    }

    return Lectura(
      id: json['id'] as int,
      estacionId: json['estacion_id'] as int,
      humedadSuelo: parseNum(json['humedad_suelo']),
      temperatura: parseNum(json['temperatura']),
      humedadAmbiental: parseNum(json['humedad_ambiental']),
      fecha: DateTime.tryParse(json['fecha'].toString()) ?? DateTime.now(),
    );
  }
}

/// Alerta de sensor o climática. Una por (parcela, tipo) mientras dura:
/// activa (sin atender) → atendida (alguien se hizo cargo) → resuelta (la
/// condición terminó, se cierra sola). Las climáticas no tienen estación.
class Alerta {
  static const severidades = {'alta': 'Alta', 'media': 'Media', 'info': 'Info'};
  static const estados = {'activa': 'Activa', 'atendida': 'Atendida', 'resuelta': 'Resuelta'};

  final int id;
  final int parcelaId;
  final String? parcelaNombre;
  final String? fincaNombre;
  final int? estacionId;
  final String? estacionCodigo;
  final String tipo;
  final String categoria;
  final String severidad;
  final String estado;
  final String? detalle;
  final int repeticiones;
  final DateTime fecha;
  final DateTime? ultimaLecturaEn;
  final String? atendidaPorNombre;
  final DateTime? atendidaEn;
  final DateTime? resueltaEn;

  Alerta({
    required this.id,
    required this.parcelaId,
    this.parcelaNombre,
    this.fincaNombre,
    this.estacionId,
    this.estacionCodigo,
    required this.tipo,
    this.categoria = 'sensor',
    this.severidad = 'media',
    this.estado = 'activa',
    this.detalle,
    this.repeticiones = 1,
    required this.fecha,
    this.ultimaLecturaEn,
    this.atendidaPorNombre,
    this.atendidaEn,
    this.resueltaEn,
  });

  bool get esClimatica => categoria == 'climatica';
  String get severidadTexto => severidades[severidad] ?? severidad;
  String get estadoTexto => estados[estado] ?? estado;

  factory Alerta.fromJson(Map<String, dynamic> json) {
    // Los TIMESTAMP llegan en UTC (ISO): se muestran en la hora del teléfono
    DateTime? fecha(dynamic v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
    return Alerta(
      id: json['id'] as int,
      parcelaId: json['parcela_id'] as int,
      parcelaNombre: json['parcela_nombre'] as String?,
      fincaNombre: json['finca_nombre'] as String?,
      estacionId: json['estacion_id'] as int?,
      estacionCodigo: json['estacion_codigo'] as String?,
      tipo: json['tipo'] as String,
      categoria: json['categoria'] as String? ?? 'sensor',
      severidad: json['severidad'] as String? ?? 'media',
      estado: json['estado'] as String? ?? 'activa',
      detalle: json['detalle'] as String?,
      repeticiones: (json['repeticiones'] as num?)?.toInt() ?? 1,
      fecha: fecha(json['fecha']) ?? DateTime.now(),
      ultimaLecturaEn: fecha(json['ultima_lectura_en']),
      atendidaPorNombre: json['atendida_por_nombre'] as String?,
      atendidaEn: fecha(json['atendida_en']),
      resueltaEn: fecha(json['resuelta_en']),
    );
  }
}

/// Alertas activas (sin atender) por severidad, para la insignia del dashboard.
class AlertasConteo {
  final int activas;
  final int atendidas;
  final int alta;
  final int media;
  final int info;

  AlertasConteo({required this.activas, required this.atendidas, required this.alta, required this.media, required this.info});

  factory AlertasConteo.fromJson(Map<String, dynamic> json) {
    final s = json['por_severidad'] as Map<String, dynamic>? ?? {};
    int n(dynamic v) => (v as num?)?.toInt() ?? 0;
    return AlertasConteo(
      activas: n(json['activas']),
      atendidas: n(json['atendidas']),
      alta: n(s['alta']),
      media: n(s['media']),
      info: n(s['info']),
    );
  }
}

/// Una hora de clima (actual o del pronóstico). La hora viene "de pared" en
/// el reloj de la simulación (sin zona horaria).
class ClimaHora {
  final DateTime fechaHora;
  final double temperatura;
  final double lluviaMm;
  final int vientoKmh;
  final String condicion;
  final String? evento;

  ClimaHora({
    required this.fechaHora,
    required this.temperatura,
    required this.lluviaMm,
    required this.vientoKmh,
    required this.condicion,
    this.evento,
  });

  factory ClimaHora.fromJson(Map<String, dynamic> json) {
    final evento = json['evento'];
    return ClimaHora(
      fechaHora: DateTime.tryParse(json['fecha_hora'].toString()) ?? DateTime.now(),
      temperatura: (json['temperatura'] as num).toDouble(),
      lluviaMm: (json['lluvia_mm'] as num).toDouble(),
      vientoKmh: (json['viento_kmh'] as num).toInt(),
      condicion: json['condicion'] as String,
      evento: evento is Map ? evento['tipo'] as String? : evento as String?,
    );
  }
}

class ClimaEvento {
  static const nombres = {'lluvia': 'Lluvia', 'helada': 'Helada', 'ola_calor': 'Ola de calor', 'viento': 'Viento fuerte'};

  final String tipo;
  final DateTime desde;
  final DateTime hasta;
  final bool enCurso;

  ClimaEvento({required this.tipo, required this.desde, required this.hasta, required this.enCurso});

  String get nombre => nombres[tipo] ?? tipo;

  factory ClimaEvento.fromJson(Map<String, dynamic> json) {
    return ClimaEvento(
      tipo: json['tipo'] as String,
      desde: DateTime.tryParse(json['desde'].toString()) ?? DateTime.now(),
      hasta: DateTime.tryParse(json['hasta'].toString()) ?? DateTime.now(),
      enCurso: json['en_curso'] == true,
    );
  }
}

/// Clima de la finca (GET /api/clima de lecturas-service).
class Clima {
  final String? fincaNombre;
  final ClimaHora ahora;
  final List<ClimaHora> pronostico;
  final List<ClimaEvento> eventos;

  Clima({this.fincaNombre, required this.ahora, required this.pronostico, required this.eventos});

  factory Clima.fromJson(Map<String, dynamic> json) {
    return Clima(
      fincaNombre: (json['finca'] as Map<String, dynamic>?)?['nombre'] as String?,
      ahora: ClimaHora.fromJson(json['ahora'] as Map<String, dynamic>),
      pronostico: (json['pronostico'] as List<dynamic>).map((e) => ClimaHora.fromJson(e as Map<String, dynamic>)).toList(),
      eventos: (json['eventos'] as List<dynamic>? ?? []).map((e) => ClimaEvento.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}

/// Registro manual de campo (humedad/temperatura observadas a ojo y/o
/// anotaciones libres), independiente de las lecturas de los sensores.
class RegistroManual {
  final int id;
  final int parcelaId;
  final int usuarioId;
  final String? usuarioNombre;
  final double? humedadSuelo;
  final double? temperatura;
  final String? anotaciones;
  final DateTime fecha;

  RegistroManual({
    required this.id,
    required this.parcelaId,
    required this.usuarioId,
    this.usuarioNombre,
    this.humedadSuelo,
    this.temperatura,
    this.anotaciones,
    required this.fecha,
  });

  factory RegistroManual.fromJson(Map<String, dynamic> json) {
    double? parseNum(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return RegistroManual(
      id: json['id'] as int,
      parcelaId: json['parcela_id'] as int,
      usuarioId: json['usuario_id'] as int,
      usuarioNombre: json['usuario_nombre'] as String?,
      humedadSuelo: parseNum(json['humedad_suelo']),
      temperatura: parseNum(json['temperatura']),
      anotaciones: json['anotaciones'] as String?,
      fecha: DateTime.tryParse(json['fecha'].toString()) ?? DateTime.now(),
    );
  }
}

class Usuario {
  final int id;
  final String nombre;
  final String email;
  final String rol;
  final String? fotoUrl;
  final DateTime? creadoEn;
  /// Bloqueada por intentos fallidos (solo viene en el listado de admin)
  final bool bloqueado;
  final int segundosBloqueo;

  Usuario({
    required this.id,
    required this.nombre,
    required this.email,
    required this.rol,
    this.fotoUrl,
    this.creadoEn,
    this.bloqueado = false,
    this.segundosBloqueo = 0,
  });

  factory Usuario.fromJson(Map<String, dynamic> json) {
    return Usuario(
      id: json['id'] as int,
      nombre: json['nombre'] as String,
      email: json['email'] as String,
      rol: json['rol'] as String,
      fotoUrl: json['foto_url'] as String?,
      creadoEn: json['creado_en'] != null ? DateTime.tryParse(json['creado_en']) : null,
      bloqueado: json['bloqueado'] == true,
      segundosBloqueo: (json['segundos_bloqueo'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Parcela "plana" (sin anidar en una finca), tal como la devuelve
/// GET /api/parcelas: se usa para selects y checklists (vincular sensor,
/// asignar parcelas a un usuario).
class ParcelaResumen {
  final int id;
  final String nombre;
  final int fincaId;
  final String fincaNombre;

  ParcelaResumen({
    required this.id,
    required this.nombre,
    required this.fincaId,
    required this.fincaNombre,
  });

  factory ParcelaResumen.fromJson(Map<String, dynamic> json) {
    return ParcelaResumen(
      id: json['id'] as int,
      nombre: json['nombre'] as String,
      fincaId: json['finca_id'] as int,
      fincaNombre: json['finca_nombre'] as String,
    );
  }
}

class Asignacion {
  final int usuarioId;
  final int parcelaId;
  final String parcelaNombre;
  final String fincaNombre;

  Asignacion({
    required this.usuarioId,
    required this.parcelaId,
    required this.parcelaNombre,
    required this.fincaNombre,
  });

  factory Asignacion.fromJson(Map<String, dynamic> json) {
    return Asignacion(
      usuarioId: json['usuario_id'] as int,
      parcelaId: json['parcela_id'] as int,
      parcelaNombre: json['parcela_nombre'] as String,
      fincaNombre: json['finca_nombre'] as String,
    );
  }
}

class SensorToken {
  final int id;
  final String token;
  final String estado;
  final DateTime creadoEn;
  final DateTime expiraEn;
  final DateTime? usadoEn;
  final String parcelaNombre;
  final String fincaNombre;

  SensorToken({
    required this.id,
    required this.token,
    required this.estado,
    required this.creadoEn,
    required this.expiraEn,
    this.usadoEn,
    required this.parcelaNombre,
    required this.fincaNombre,
  });

  factory SensorToken.fromJson(Map<String, dynamic> json) {
    return SensorToken(
      id: json['id'] as int,
      token: json['token'] as String,
      estado: json['estado'] as String,
      creadoEn: DateTime.tryParse(json['creado_en'].toString()) ?? DateTime.now(),
      expiraEn: DateTime.tryParse(json['expira_en'].toString()) ?? DateTime.now(),
      usadoEn: json['usado_en'] != null ? DateTime.tryParse(json['usado_en']) : null,
      parcelaNombre: json['parcela_nombre'] as String,
      fincaNombre: json['finca_nombre'] as String,
    );
  }
}

class DashboardResumen {
  final int estacionesActivas;
  final int alertasHoy;
  final double? humedadPromedio;
  final double? temperaturaPromedio;

  /// Cultivos no cosechados (para el agrónomo, solo los de sus parcelas).
  final int cultivosActivos;

  /// Riegos en curso (para el agrónomo, solo los de sus parcelas).
  final int riegosEnCurso;

  DashboardResumen({
    required this.estacionesActivas,
    required this.alertasHoy,
    this.humedadPromedio,
    this.temperaturaPromedio,
    this.cultivosActivos = 0,
    this.riegosEnCurso = 0,
  });

  factory DashboardResumen.fromJson(Map<String, dynamic> json) {
    double? parseNum(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return DashboardResumen(
      estacionesActivas: (json['estaciones_activas'] as num?)?.toInt() ?? 0,
      alertasHoy: (json['alertas_hoy'] as num?)?.toInt() ?? 0,
      humedadPromedio: parseNum(json['humedad_promedio']),
      temperaturaPromedio: parseNum(json['temperatura_promedio']),
      cultivosActivos: (json['cultivos_activos'] as num?)?.toInt() ?? 0,
      riegosEnCurso: (json['riegos_en_curso'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Un cultivo del inventario de una parcela. Las fechas llegan como texto
/// YYYY-MM-DD (sin hora) y se interpretan como fecha local.
class Cultivo {
  static const estados = {
    'sembrado': 'Sembrado',
    'en_crecimiento': 'En crecimiento',
    'cosechado': 'Cosechado',
  };
  static const unidades = ['plantas', 'kg', 'quintales'];

  final int id;
  final int parcelaId;
  final String? parcelaNombre;
  final String? fincaNombre;
  final String tipo;
  final String? variedad;
  final DateTime fechaSiembra;
  final DateTime? fechaCosechaEstimada;
  final double cantidad;
  final String unidad;
  final String estado;
  final String? notas;

  Cultivo({
    required this.id,
    required this.parcelaId,
    this.parcelaNombre,
    this.fincaNombre,
    required this.tipo,
    this.variedad,
    required this.fechaSiembra,
    this.fechaCosechaEstimada,
    required this.cantidad,
    required this.unidad,
    required this.estado,
    this.notas,
  });

  String get estadoTexto => estados[estado] ?? estado;

  factory Cultivo.fromJson(Map<String, dynamic> json) {
    final cantidad = json['cantidad'];
    return Cultivo(
      id: json['id'] as int,
      parcelaId: json['parcela_id'] as int,
      parcelaNombre: json['parcela_nombre'] as String?,
      fincaNombre: json['finca_nombre'] as String?,
      tipo: json['tipo'] as String,
      variedad: json['variedad'] as String?,
      fechaSiembra: DateTime.tryParse(json['fecha_siembra'].toString()) ?? DateTime.now(),
      fechaCosechaEstimada: json['fecha_cosecha_estimada'] != null
          ? DateTime.tryParse(json['fecha_cosecha_estimada'].toString())
          : null,
      cantidad: cantidad is num ? cantidad.toDouble() : double.tryParse(cantidad.toString()) ?? 0,
      unidad: json['unidad'] as String? ?? 'plantas',
      estado: json['estado'] as String? ?? 'sembrado',
      notas: json['notas'] as String?,
    );
  }
}

/// Las horas de riego vienen "de pared" en el reloj del motor de riego
/// (el simulado durante la demo), como texto "YYYY-MM-DD HH:MM[:SS]".
DateTime? _fechaRiego(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());

/// Un riego de la bitácora (en curso, completado o detenido).
class RiegoEvento {
  static const origenes = {'programado': 'Programado', 'manual': 'Manual', 'automatico': 'Automático'};
  static const estados = {'en_curso': 'En curso', 'completado': 'Completado', 'cancelado': 'Detenido', 'omitido': 'Omitido'};

  final int id;
  final int parcelaId;
  final String origen;
  final String? programacionNombre;
  final DateTime inicio;
  final DateTime? fin;
  final DateTime? finPrevisto;
  final int duracionMinutos;
  final String estado;

  /// Por qué no se hizo (p. ej. "Omitido por lluvia…"), solo en omitidos.
  final String? motivo;

  RiegoEvento({
    required this.id,
    required this.parcelaId,
    required this.origen,
    this.programacionNombre,
    required this.inicio,
    this.fin,
    this.finPrevisto,
    required this.duracionMinutos,
    required this.estado,
    this.motivo,
  });

  String get origenTexto => origenes[origen] ?? origen;
  String get estadoTexto => estados[estado] ?? estado;

  factory RiegoEvento.fromJson(Map<String, dynamic> json) {
    return RiegoEvento(
      id: json['id'] as int,
      parcelaId: json['parcela_id'] as int,
      origen: json['origen'] as String,
      programacionNombre: json['programacion_nombre'] as String?,
      inicio: _fechaRiego(json['inicio']) ?? DateTime.now(),
      fin: _fechaRiego(json['fin']),
      finPrevisto: _fechaRiego(json['fin_previsto']),
      duracionMinutos: (json['duracion_minutos'] as num).toInt(),
      estado: json['estado'] as String,
      motivo: json['motivo'] as String?,
    );
  }
}

class RiegoProgramacion {
  final int id;
  final String nombre;
  final List<String> dias;
  final String horaInicio;
  final int duracionMinutos;
  final bool activa;
  final DateTime? proximaEjecucion;

  RiegoProgramacion({
    required this.id,
    required this.nombre,
    required this.dias,
    required this.horaInicio,
    required this.duracionMinutos,
    required this.activa,
    this.proximaEjecucion,
  });

  factory RiegoProgramacion.fromJson(Map<String, dynamic> json) {
    return RiegoProgramacion(
      id: json['id'] as int,
      nombre: json['nombre'] as String,
      dias: (json['dias_semana'] as String).split(','),
      horaInicio: json['hora_inicio'] as String,
      duracionMinutos: (json['duracion_minutos'] as num).toInt(),
      activa: json['activa'] == true || json['activa'] == 1,
      proximaEjecucion: _fechaRiego(json['proxima_ejecucion']),
    );
  }
}

/// Todo lo de riego de una parcela (GET /api/parcelas/:id/riego).
class RiegoResumen {
  final bool riegoAutomatico;
  final RiegoEvento? riegoEnCurso;
  final List<RiegoProgramacion> programaciones;
  final List<RiegoEvento> ultimosRiegos;

  /// Hora actual del motor de riego (null si el reloj del simulador no responde).
  final DateTime? reloj;

  RiegoResumen({
    required this.riegoAutomatico,
    this.riegoEnCurso,
    required this.programaciones,
    required this.ultimosRiegos,
    this.reloj,
  });

  factory RiegoResumen.fromJson(Map<String, dynamic> json) {
    return RiegoResumen(
      riegoAutomatico: json['riego_automatico'] == true,
      riegoEnCurso: json['riego_en_curso'] != null
          ? RiegoEvento.fromJson(json['riego_en_curso'] as Map<String, dynamic>)
          : null,
      programaciones: (json['programaciones'] as List<dynamic>)
          .map((e) => RiegoProgramacion.fromJson(e as Map<String, dynamic>))
          .toList(),
      ultimosRiegos: (json['ultimos_riegos'] as List<dynamic>)
          .map((e) => RiegoEvento.fromJson(e as Map<String, dynamic>))
          .toList(),
      reloj: _fechaRiego(json['reloj']),
    );
  }
}

/// Un punto del historial de humedad por finca (para la gráfica del
/// dashboard): varias filas por día, una por cada finca.
class HistorialPunto {
  final String finca;
  final DateTime dia;
  final double humedad;

  HistorialPunto({required this.finca, required this.dia, required this.humedad});

  factory HistorialPunto.fromJson(Map<String, dynamic> json) {
    final humedad = json['humedad'];
    return HistorialPunto(
      finca: json['finca'] as String,
      dia: DateTime.tryParse(json['dia'].toString()) ?? DateTime.now(),
      humedad: humedad is num ? humedad.toDouble() : double.tryParse(humedad.toString()) ?? 0,
    );
  }
}
