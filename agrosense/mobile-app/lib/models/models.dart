/// Modelos de datos de AgroSense, uno por cada entidad expuesta por los
/// microservicios (fincas-service / lecturas-service).
library;

import 'json.dart';

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
      id: jsonEntero(json['id']),
      nombre: jsonTexto(json['nombre']),
      ubicacion: jsonTextoOpt(json['ubicacion']),
      usuarioId: jsonEnteroOpt(json['usuario_id']),
      creadoEn: jsonFecha(json['creado_en']),
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
    return Parcela(
      id: jsonEntero(json['id']),
      nombre: jsonTexto(json['nombre']),
      fincaId: jsonEntero(json['finca_id']),
      humedadMin: jsonDecimal(json['humedad_min'], 30),
      humedadMax: jsonDecimal(json['humedad_max'], 85),
      temperaturaMax: jsonDecimal(json['temperatura_max'], 38),
      humedadActual: jsonDecimalOpt(json['humedad_actual']),
      temperaturaActual: jsonDecimalOpt(json['temperatura_actual']),
      estado: jsonTextoOpt(json['estado']),
      creadoEn: jsonFecha(json['creado_en']),
      fincaNombre: jsonTextoOpt(json['finca_nombre']),
      riegoAutomatico: jsonBool(json['riego_automatico']),
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
    return Estacion(
      id: jsonEntero(json['id']),
      codigo: jsonTexto(json['codigo']),
      parcelaId: jsonEnteroOpt(json['parcela_id']),
      parcelaNombre: jsonTextoOpt(json['parcela_nombre']),
      fincaNombre: jsonTextoOpt(json['finca_nombre']),
      humedadSuelo: jsonDecimalOpt(json['humedad_suelo']),
      temperatura: jsonDecimalOpt(json['temperatura']),
      humedadAmbiental: jsonDecimalOpt(json['humedad_ambiental']),
      ultimaLectura: jsonFecha(json['ultima_lectura']),
      creadoEn: jsonFecha(json['creado_en']),
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
    return Lectura(
      id: jsonEntero(json['id']),
      estacionId: jsonEntero(json['estacion_id']),
      humedadSuelo: jsonDecimal(json['humedad_suelo']),
      temperatura: jsonDecimal(json['temperatura']),
      humedadAmbiental: jsonDecimal(json['humedad_ambiental']),
      fecha: jsonFecha(json['fecha']) ?? DateTime.now(),
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
    DateTime? fecha(dynamic v) => jsonFecha(v)?.toLocal();
    return Alerta(
      id: jsonEntero(json['id']),
      parcelaId: jsonEntero(json['parcela_id']),
      parcelaNombre: jsonTextoOpt(json['parcela_nombre']),
      fincaNombre: jsonTextoOpt(json['finca_nombre']),
      estacionId: jsonEnteroOpt(json['estacion_id']),
      estacionCodigo: jsonTextoOpt(json['estacion_codigo']),
      tipo: jsonTexto(json['tipo']),
      categoria: jsonTexto(json['categoria'], 'sensor'),
      severidad: jsonTexto(json['severidad'], 'media'),
      estado: jsonTexto(json['estado'], 'activa'),
      detalle: jsonTextoOpt(json['detalle']),
      repeticiones: jsonEntero(json['repeticiones'], 1),
      fecha: fecha(json['fecha']) ?? DateTime.now(),
      ultimaLecturaEn: fecha(json['ultima_lectura_en']),
      atendidaPorNombre: jsonTextoOpt(json['atendida_por_nombre']),
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
    final s = jsonMapa(json['por_severidad']);
    return AlertasConteo(
      activas: jsonEntero(json['activas']),
      atendidas: jsonEntero(json['atendidas']),
      alta: jsonEntero(s['alta']),
      media: jsonEntero(s['media']),
      info: jsonEntero(s['info']),
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
      fechaHora: jsonFecha(json['fecha_hora']) ?? DateTime.now(),
      temperatura: jsonDecimal(json['temperatura']),
      lluviaMm: jsonDecimal(json['lluvia_mm']),
      vientoKmh: jsonEntero(json['viento_kmh']),
      condicion: jsonTexto(json['condicion']),
      evento: jsonTextoOpt(evento is Map ? evento['tipo'] : evento),
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
      tipo: jsonTexto(json['tipo']),
      desde: jsonFecha(json['desde']) ?? DateTime.now(),
      hasta: jsonFecha(json['hasta']) ?? DateTime.now(),
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
    // Sin el clima actual no hay nada que mostrar (antes que un "0°C" inventado):
    // el dashboard atrapa el error y pone "Sin datos de clima".
    if (json['ahora'] is! Map) throw const FormatException('La respuesta de clima no trae el clima actual');
    return Clima(
      fincaNombre: jsonTextoOpt(jsonMapa(json['finca'])['nombre']),
      ahora: ClimaHora.fromJson(jsonMapa(json['ahora'])),
      pronostico: jsonLista(json['pronostico']).map(ClimaHora.fromJson).toList(),
      eventos: jsonLista(json['eventos']).map(ClimaEvento.fromJson).toList(),
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
    return RegistroManual(
      id: jsonEntero(json['id']),
      parcelaId: jsonEntero(json['parcela_id']),
      usuarioId: jsonEntero(json['usuario_id']),
      usuarioNombre: jsonTextoOpt(json['usuario_nombre']),
      humedadSuelo: jsonDecimalOpt(json['humedad_suelo']),
      temperatura: jsonDecimalOpt(json['temperatura']),
      anotaciones: jsonTextoOpt(json['anotaciones']),
      fecha: jsonFecha(json['fecha']) ?? DateTime.now(),
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
      id: jsonEntero(json['id']),
      nombre: jsonTexto(json['nombre']),
      email: jsonTexto(json['email']),
      rol: jsonTexto(json['rol'], 'agricultor'),
      fotoUrl: jsonTextoOpt(json['foto_url']),
      creadoEn: jsonFecha(json['creado_en']),
      bloqueado: jsonBool(json['bloqueado']),
      segundosBloqueo: jsonEntero(json['segundos_bloqueo']),
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
      id: jsonEntero(json['id']),
      nombre: jsonTexto(json['nombre']),
      fincaId: jsonEntero(json['finca_id']),
      fincaNombre: jsonTexto(json['finca_nombre']),
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
      usuarioId: jsonEntero(json['usuario_id']),
      parcelaId: jsonEntero(json['parcela_id']),
      parcelaNombre: jsonTexto(json['parcela_nombre']),
      fincaNombre: jsonTexto(json['finca_nombre']),
    );
  }
}

/// Token de un solo uso para vincular un sensor a una parcela
/// (POST/GET /api/sensores/tokens de fincas-service).
class SensorToken {
  final int id;
  final String token;

  /// Estado guardado en la base: pendiente, usado o expirado.
  final String estado;
  final DateTime? creadoEn;
  final DateTime? expiraEn;
  final DateTime? usadoEn;
  final int? parcelaId;
  final String? parcelaNombre;
  final String? fincaNombre;

  SensorToken({
    required this.id,
    required this.token,
    this.estado = 'pendiente',
    this.creadoEn,
    this.expiraEn,
    this.usadoEn,
    this.parcelaId,
    this.parcelaNombre,
    this.fincaNombre,
  });

  /// Pendiente y sin vencer. La base solo pasa a "expirado" los vencidos
  /// cuando alguien lista los tokens, así que aquí se mira también la hora.
  bool get vigente => estado == 'pendiente' && (expiraEn == null || expiraEn!.isAfter(DateTime.now()));

  /// Lo que se muestra: vigente, usado o expirado.
  String get estadoTexto {
    if (estado == 'usado') return 'usado';
    return vigente ? 'vigente' : 'expirado';
  }

  /// "Finca · Parcela", con lo que haya llegado.
  String get ubicacion {
    final partes = [fincaNombre, parcelaNombre].whereType<String>().where((p) => p.isNotEmpty);
    if (partes.isNotEmpty) return partes.join(' · ');
    return parcelaId != null ? 'Parcela #$parcelaId' : 'Parcela sin nombre';
  }

  /// Los primeros caracteres, para identificarlo en la lista sin mostrarlo entero.
  String get tokenCorto => token.length > 8 ? '${token.substring(0, 8)}…' : token;

  factory SensorToken.fromJson(Map<String, dynamic> json) {
    // Los TIMESTAMP llegan en UTC (ISO): se muestran en la hora del teléfono
    DateTime? fecha(dynamic v) => jsonFecha(v)?.toLocal();
    return SensorToken(
      id: jsonEntero(json['id']),
      token: jsonTexto(json['token']),
      estado: jsonTexto(json['estado'], 'pendiente'),
      creadoEn: fecha(json['creado_en']),
      expiraEn: fecha(json['expira_en']),
      usadoEn: fecha(json['usado_en']),
      parcelaId: jsonEnteroOpt(json['parcela_id']),
      parcelaNombre: jsonTextoOpt(json['parcela_nombre']),
      fincaNombre: jsonTextoOpt(json['finca_nombre']),
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
    return DashboardResumen(
      estacionesActivas: jsonEntero(json['estaciones_activas']),
      alertasHoy: jsonEntero(json['alertas_hoy']),
      humedadPromedio: jsonDecimalOpt(json['humedad_promedio']),
      temperaturaPromedio: jsonDecimalOpt(json['temperatura_promedio']),
      cultivosActivos: jsonEntero(json['cultivos_activos']),
      riegosEnCurso: jsonEntero(json['riegos_en_curso']),
    );
  }
}

/// Un cultivo del inventario: siempre de una finca y, opcionalmente, de una
/// de sus parcelas (sin parcela = "Toda la finca": varias parcelas o la
/// finca completa). Las fechas llegan como texto YYYY-MM-DD (sin hora) y se
/// interpretan como fecha local.
class Cultivo {
  static const estados = {
    'sembrado': 'Sembrado',
    'en_crecimiento': 'En crecimiento',
    'cosechado': 'Cosechado',
  };
  static const unidades = ['plantas', 'kg', 'quintales'];

  final int id;
  final int fincaId;
  final String? fincaNombre;
  final int? parcelaId;
  final String? parcelaNombre;
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
    required this.fincaId,
    this.fincaNombre,
    this.parcelaId,
    this.parcelaNombre,
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

  /// Cultivo de la finca completa (o de varias parcelas), sin parcela propia.
  bool get esDeFinca => parcelaId == null;

  /// Nombre de la parcela, o "Toda la finca".
  String get parcelaTexto => esDeFinca ? 'Toda la finca' : (parcelaNombre ?? 'Parcela #$parcelaId');

  /// "Finca / Parcela" o "Finca / Toda la finca".
  String get ubicacion => '${fincaNombre ?? 'Finca #$fincaId'} / $parcelaTexto';

  factory Cultivo.fromJson(Map<String, dynamic> json) {
    return Cultivo(
      id: jsonEntero(json['id']),
      fincaId: jsonEntero(json['finca_id']),
      fincaNombre: jsonTextoOpt(json['finca_nombre']),
      parcelaId: jsonEnteroOpt(json['parcela_id']),
      parcelaNombre: jsonTextoOpt(json['parcela_nombre']),
      tipo: jsonTexto(json['tipo']),
      variedad: jsonTextoOpt(json['variedad']),
      fechaSiembra: jsonFecha(json['fecha_siembra']) ?? DateTime.now(),
      fechaCosechaEstimada: jsonFecha(json['fecha_cosecha_estimada']),
      cantidad: jsonDecimal(json['cantidad']),
      unidad: jsonTexto(json['unidad'], 'plantas'),
      estado: jsonTexto(json['estado'], 'sembrado'),
      notas: jsonTextoOpt(json['notas']),
    );
  }
}

/// Las horas de riego vienen "de pared" en el reloj del motor de riego
/// (el simulado durante la demo), como texto "YYYY-MM-DD HH:MM[:SS]".
DateTime? _fechaRiego(dynamic v) => jsonFecha(v);

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
      id: jsonEntero(json['id']),
      parcelaId: jsonEntero(json['parcela_id']),
      origen: jsonTexto(json['origen']),
      programacionNombre: jsonTextoOpt(json['programacion_nombre']),
      inicio: _fechaRiego(json['inicio']) ?? DateTime.now(),
      fin: _fechaRiego(json['fin']),
      finPrevisto: _fechaRiego(json['fin_previsto']),
      duracionMinutos: jsonEntero(json['duracion_minutos']),
      estado: jsonTexto(json['estado']),
      motivo: jsonTextoOpt(json['motivo']),
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
      id: jsonEntero(json['id']),
      nombre: jsonTexto(json['nombre']),
      dias: jsonTexto(json['dias_semana']).split(',').where((d) => d.isNotEmpty).toList(),
      horaInicio: jsonTexto(json['hora_inicio']),
      duracionMinutos: jsonEntero(json['duracion_minutos']),
      activa: jsonBool(json['activa']),
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
      riegoAutomatico: jsonBool(json['riego_automatico']),
      riegoEnCurso: json['riego_en_curso'] is Map ? RiegoEvento.fromJson(jsonMapa(json['riego_en_curso'])) : null,
      programaciones: jsonLista(json['programaciones']).map(RiegoProgramacion.fromJson).toList(),
      ultimosRiegos: jsonLista(json['ultimos_riegos']).map(RiegoEvento.fromJson).toList(),
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
    return HistorialPunto(
      finca: jsonTexto(json['finca']),
      dia: jsonFecha(json['dia']) ?? DateTime.now(),
      humedad: jsonDecimal(json['humedad']),
    );
  }
}
