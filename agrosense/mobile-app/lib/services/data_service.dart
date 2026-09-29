import 'dart:convert';
import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import '../models/models.dart';
import 'api_exception.dart';

/// Consume fincas-service (fincas/parcelas/estaciones/sensores/dashboard)
/// y lecturas-service (historial de lecturas y alertas). Los mismos
/// endpoints REST que usa el panel web, llamados directo desde el
/// celular (ninguno de ellos exige sesión: la app confía en que solo
/// quien inició sesión llega a estas pantallas).
class DataService {
  static const _jsonHeaders = {'Content-Type': 'application/json'};

  // --- Fincas ---

  Future<List<Finca>> getFincas() async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas'));
    _checkOk(res, 'No se pudieron cargar las fincas');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Finca.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Devuelve el id de la finca creada (el backend ya lo entrega en la
  /// respuesta, así que no hace falta un segundo viaje a buscarlo).
  Future<int> crearFinca({required String nombre, String? ubicacion, required int usuarioId}) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas'),
      headers: _jsonHeaders,
      body: jsonEncode({'nombre': nombre, 'ubicacion': ubicacion, 'usuario_id': usuarioId}),
    );
    _checkCreated(res, 'No se pudo crear la finca');
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return data['id'] as int;
  }

  Future<void> editarFinca(int id, {required String nombre, String? ubicacion}) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({'nombre': nombre, 'ubicacion': ubicacion}),
    );
    _checkOk(res, 'No se pudo editar la finca');
  }

  Future<void> eliminarFinca(int id) async {
    final res = await http.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas/$id'));
    _checkOk(res, 'No se pudo eliminar la finca');
  }

  // --- Parcelas ---

  Future<List<Parcela>> getParcelas(int fincaId) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas/$fincaId/parcelas'),
    );
    _checkOk(res, 'No se pudieron cargar las parcelas');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Parcela.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Todas las parcelas de todas las fincas (para selects/checklists).
  Future<List<ParcelaResumen>> getParcelasFlat() async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas'));
    _checkOk(res, 'No se pudieron cargar las parcelas');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => ParcelaResumen.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Devuelve el id de la parcela creada (el backend ya lo entrega en la
  /// respuesta), útil para asignársela de una a quien la registró.
  Future<int> crearParcela({
    required String nombre,
    required int fincaId,
    required double humedadMin,
    required double humedadMax,
    required double temperaturaMax,
  }) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'nombre': nombre,
        'finca_id': fincaId,
        'humedad_min': humedadMin,
        'humedad_max': humedadMax,
        'temperatura_max': temperaturaMax,
      }),
    );
    _checkCreated(res, 'No se pudo crear la parcela');
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return data['id'] as int;
  }

  Future<void> editarParcela(
    int id, {
    required String nombre,
    required double humedadMin,
    required double humedadMax,
    required double temperaturaMax,
  }) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'nombre': nombre,
        'humedad_min': humedadMin,
        'humedad_max': humedadMax,
        'temperatura_max': temperaturaMax,
      }),
    );
    _checkOk(res, 'No se pudo editar la parcela');
  }

  Future<void> eliminarParcela(int id) async {
    final res = await http.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$id'));
    _checkOk(res, 'No se pudo eliminar la parcela');
  }

  /// Parcelas asignadas a un usuario (rol agrónomo): a diferencia de
  /// [getParcelas], no está acotado a una finca -- trae de todas las
  /// fincas, pero solo las que el admin le asignó en usuario_parcelas.
  Future<List<Parcela>> getParcelasAsignadas(int usuarioId) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/usuarios/$usuarioId/parcelas'),
    );
    _checkOk(res, 'No se pudieron cargar tus parcelas');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Parcela.fromJson(e as Map<String, dynamic>)).toList();
  }

  // --- Sensores / estaciones ---

  Future<List<Estacion>> getEstaciones(int parcelaId) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/estaciones'),
    );
    _checkOk(res, 'No se pudieron cargar los sensores');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Estacion.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Todos los sensores (de todas las parcelas), con su última lectura.
  Future<List<Estacion>> getEstacionesFlat() async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/estaciones'));
    _checkOk(res, 'No se pudieron cargar los sensores');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Estacion.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> editarEstacion(int id, {required String codigo}) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/estaciones/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({'codigo': codigo}),
    );
    _checkOk(res, 'No se pudo editar el sensor');
  }

  Future<void> eliminarEstacion(int id) async {
    final res = await http.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/estaciones/$id'));
    _checkOk(res, 'No se pudo eliminar el sensor');
  }

  // --- Tokens de vinculación de sensores ---

  Future<SensorToken> generarTokenSensor(int parcelaId) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/sensores/tokens'),
      headers: _jsonHeaders,
      body: jsonEncode({'parcela_id': parcelaId}),
    );
    _checkCreated(res, 'No se pudo generar el token');
    return SensorToken.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  Future<List<SensorToken>> getTokensSensor() async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/sensores/tokens'));
    _checkOk(res, 'No se pudieron cargar los tokens');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => SensorToken.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> revocarTokenSensor(int id) async {
    final res = await http.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/sensores/tokens/$id'));
    _checkOk(res, 'No se pudo revocar el token');
  }

  // --- Alertas y lecturas ---

  Future<List<Alerta>> getAlertas(int parcelaId) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/parcelas/$parcelaId/alertas'),
    );
    _checkOk(res, 'No se pudieron cargar las alertas');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Alerta.fromJson(e as Map<String, dynamic>)).toList();
  }

  // --- Registros manuales de campo (humedad/temperatura + anotaciones) ---

  Future<List<RegistroManual>> getRegistros(int parcelaId) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/parcelas/$parcelaId/registros'),
    );
    _checkOk(res, 'No se pudieron cargar los registros');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => RegistroManual.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> crearRegistro({
    required int parcelaId,
    required int usuarioId,
    double? humedadSuelo,
    double? temperatura,
    String? anotaciones,
  }) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/parcelas/$parcelaId/registros'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'usuario_id': usuarioId,
        if (humedadSuelo != null) 'humedad_suelo': humedadSuelo,
        if (temperatura != null) 'temperatura': temperatura,
        if (anotaciones != null && anotaciones.isNotEmpty) 'anotaciones': anotaciones,
      }),
    );
    _checkCreated(res, 'No se pudo guardar el registro');
  }

  Future<List<Lectura>> getLecturas(int estacionId) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/estaciones/$estacionId/lecturas'),
    );
    _checkOk(res, 'No se pudo cargar el historial');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Lectura.fromJson(e as Map<String, dynamic>)).toList();
  }

  // --- Asignación de parcelas a usuarios ---

  Future<List<Asignacion>> getAsignaciones() async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/asignaciones'));
    _checkOk(res, 'No se pudieron cargar las asignaciones');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Asignacion.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Asignaciones de un solo usuario (a diferencia de [getAsignaciones],
  /// que trae las de todos). La usa el agrónomo para saber qué parcelas
  /// ya tiene antes de agregarse una nueva sin perder las anteriores,
  /// ya que [setAsignaciones] reemplaza el conjunto completo.
  Future<List<Asignacion>> getAsignacionesUsuario(int usuarioId) async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/asignaciones/$usuarioId'));
    _checkOk(res, 'No se pudieron cargar tus asignaciones');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Asignacion.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> setAsignaciones(int usuarioId, List<int> parcelaIds) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/asignaciones/$usuarioId'),
      headers: _jsonHeaders,
      body: jsonEncode({'parcela_ids': parcelaIds}),
    );
    _checkOk(res, 'No se pudieron asignar las parcelas');
  }

  // --- Dashboard ---

  Future<DashboardResumen> getDashboardResumen() async {
    final res = await http.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/dashboard/resumen'));
    _checkOk(res, 'No se pudo cargar el resumen');
    return DashboardResumen.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  Future<List<HistorialPunto>> getDashboardHistorial({int dias = 7}) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/dashboard/humedad-historial?dias=$dias'),
    );
    _checkOk(res, 'No se pudo cargar el historial de humedad');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => HistorialPunto.fromJson(e as Map<String, dynamic>)).toList();
  }

  void _checkOk(http.Response res, String fallback) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiException.fromResponseBody(res.body, fallback);
    }
  }

  void _checkCreated(http.Response res, String fallback) {
    if (res.statusCode != 201) {
      throw ApiException.fromResponseBody(res.body, fallback);
    }
  }
}
