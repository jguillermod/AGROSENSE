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

class Alerta {
  final int id;
  final int parcelaId;
  final int estacionId;
  final String tipo;
  final DateTime fecha;

  Alerta({
    required this.id,
    required this.parcelaId,
    required this.estacionId,
    required this.tipo,
    required this.fecha,
  });

  factory Alerta.fromJson(Map<String, dynamic> json) {
    return Alerta(
      id: json['id'] as int,
      parcelaId: json['parcela_id'] as int,
      estacionId: json['estacion_id'] as int,
      tipo: json['tipo'] as String,
      fecha: DateTime.tryParse(json['fecha'].toString()) ?? DateTime.now(),
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

  Usuario({
    required this.id,
    required this.nombre,
    required this.email,
    required this.rol,
    this.fotoUrl,
    this.creadoEn,
  });

  factory Usuario.fromJson(Map<String, dynamic> json) {
    return Usuario(
      id: json['id'] as int,
      nombre: json['nombre'] as String,
      email: json['email'] as String,
      rol: json['rol'] as String,
      fotoUrl: json['foto_url'] as String?,
      creadoEn: json['creado_en'] != null ? DateTime.tryParse(json['creado_en']) : null,
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

  DashboardResumen({
    required this.estacionesActivas,
    required this.alertasHoy,
    this.humedadPromedio,
    this.temperaturaPromedio,
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
