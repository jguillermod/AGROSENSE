import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';

import '../config/api_config.dart';
import '../models/json.dart';
import '../models/models.dart';
import 'api_client.dart';
import 'api_exception.dart';

/// Consume fincas-service (fincas/parcelas/estaciones/sensores/dashboard)
/// y lecturas-service (historial de lecturas y alertas). Los mismos
/// endpoints REST que usa el panel web, llamados directo desde el
/// celular con el JWT de la sesión (ver ApiClient): los servicios
/// rechazan las peticiones sin token y aplican los permisos por rol.
class DataService {
  static const _jsonHeaders = {'Content-Type': 'application/json'};

  // --- Fincas ---

  Future<List<Finca>> getFincas() async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas'));
    _checkOk(res, 'No se pudieron cargar las fincas');
    return jsonLista(jsonDecode(res.body)).map(Finca.fromJson).toList();
  }

  /// Devuelve el id de la finca creada (el backend ya lo entrega en la
  /// respuesta, así que no hace falta un segundo viaje a buscarlo).
  Future<int> crearFinca({required String nombre, String? ubicacion, required int usuarioId}) async {
    final res = await ApiClient.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas'),
      headers: _jsonHeaders,
      body: jsonEncode({'nombre': nombre, 'ubicacion': ubicacion, 'usuario_id': usuarioId}),
    );
    _checkCreated(res, 'No se pudo crear la finca');
    return ApiException.idCreado(res.body);
  }

  Future<void> editarFinca(int id, {required String nombre, String? ubicacion}) async {
    final res = await ApiClient.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({'nombre': nombre, 'ubicacion': ubicacion}),
    );
    _checkOk(res, 'No se pudo editar la finca');
  }

  Future<void> eliminarFinca(int id) async {
    final res = await ApiClient.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas/$id'));
    _checkOk(res, 'No se pudo eliminar la finca');
  }

  // --- Parcelas ---

  Future<List<Parcela>> getParcelas(int fincaId) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/fincas/$fincaId/parcelas'),
    );
    _checkOk(res, 'No se pudieron cargar las parcelas');
    return jsonLista(jsonDecode(res.body)).map(Parcela.fromJson).toList();
  }

  /// Todas las parcelas de todas las fincas (para selects/checklists).
  Future<List<ParcelaResumen>> getParcelasFlat() async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas'));
    _checkOk(res, 'No se pudieron cargar las parcelas');
    return jsonLista(jsonDecode(res.body)).map(ParcelaResumen.fromJson).toList();
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
    final res = await ApiClient.post(
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
    return ApiException.idCreado(res.body);
  }

  Future<void> editarParcela(
    int id, {
    required String nombre,
    required double humedadMin,
    required double humedadMax,
    required double temperaturaMax,
  }) async {
    final res = await ApiClient.put(
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
    final res = await ApiClient.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$id'));
    _checkOk(res, 'No se pudo eliminar la parcela');
  }

  /// Parcelas asignadas a un usuario (rol agrónomo): a diferencia de
  /// [getParcelas], no está acotado a una finca -- trae de todas las
  /// fincas, pero solo las que el admin le asignó en usuario_parcelas.
  Future<List<Parcela>> getParcelasAsignadas(int usuarioId) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/usuarios/$usuarioId/parcelas'),
    );
    _checkOk(res, 'No se pudieron cargar tus parcelas');
    return jsonLista(jsonDecode(res.body)).map(Parcela.fromJson).toList();
  }

  // --- Sensores / estaciones ---

  Future<List<Estacion>> getEstaciones(int parcelaId) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/estaciones'),
    );
    _checkOk(res, 'No se pudieron cargar los sensores');
    return jsonLista(jsonDecode(res.body)).map(Estacion.fromJson).toList();
  }

  /// Todos los sensores (de todas las parcelas), con su última lectura.
  Future<List<Estacion>> getEstacionesFlat() async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/estaciones'));
    _checkOk(res, 'No se pudieron cargar los sensores');
    return jsonLista(jsonDecode(res.body)).map(Estacion.fromJson).toList();
  }

  Future<void> editarEstacion(int id, {required String codigo}) async {
    final res = await ApiClient.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/estaciones/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({'codigo': codigo}),
    );
    _checkOk(res, 'No se pudo editar el sensor');
  }

  Future<void> eliminarEstacion(int id) async {
    final res = await ApiClient.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/estaciones/$id'));
    _checkOk(res, 'No se pudo eliminar el sensor');
  }

  // --- Tokens de vinculación de sensores ---

  Future<SensorToken> generarTokenSensor(int parcelaId) async {
    final res = await ApiClient.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/sensores/tokens'),
      headers: _jsonHeaders,
      body: jsonEncode({'parcela_id': parcelaId}),
    );
    _checkCreated(res, 'No se pudo generar el token');
    return SensorToken.fromJson(jsonMapa(jsonDecode(res.body)));
  }

  Future<List<SensorToken>> getTokensSensor() async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/sensores/tokens'));
    _checkOk(res, 'No se pudieron cargar los tokens');
    return jsonLista(jsonDecode(res.body)).map(SensorToken.fromJson).toList();
  }

  Future<void> revocarTokenSensor(int id) async {
    final res = await ApiClient.delete(Uri.parse('${ApiConfig.fincasBaseUrl}/api/sensores/tokens/$id'));
    _checkOk(res, 'No se pudo revocar el token');
  }

  // --- Alertas y lecturas ---

  Future<List<Alerta>> getAlertas(int parcelaId) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/parcelas/$parcelaId/alertas'),
    );
    _checkOk(res, 'No se pudieron cargar las alertas');
    return jsonLista(jsonDecode(res.body)).map(Alerta.fromJson).toList();
  }

  /// Alertas con filtros. [estado] acepta activa, atendida, resuelta o
  /// "vigentes" (activas + atendidas); el agrónomo solo recibe las de sus parcelas.
  Future<List<Alerta>> getAlertasFiltradas({required int usuarioId, String? severidad, String? estado}) async {
    final query = {
      'usuario_id': '$usuarioId',
      'limit': '200',
      'severidad': ?severidad,
      'estado': ?estado,
    };
    final res = await ApiClient.get(Uri.parse('${ApiConfig.lecturasBaseUrl}/api/alertas').replace(queryParameters: query));
    _checkOk(res, 'No se pudieron cargar las alertas');
    return jsonLista(jsonDecode(res.body)).map(Alerta.fromJson).toList();
  }

  Future<AlertasConteo> getConteoAlertas({required int usuarioId}) async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.lecturasBaseUrl}/api/alertas/conteo?usuario_id=$usuarioId'));
    _checkOk(res, 'No se pudieron contar las alertas');
    return AlertasConteo.fromJson(jsonMapa(jsonDecode(res.body)));
  }

  Future<void> atenderAlerta(int id, {required int usuarioId}) async {
    final res = await ApiClient.put(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/alertas/$id/atender'),
      headers: _jsonHeaders,
      body: jsonEncode({'usuario_id': usuarioId}),
    );
    _checkOk(res, 'No se pudo marcar la alerta como atendida');
  }

  Future<Clima> getClima() async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.lecturasBaseUrl}/api/clima'));
    _checkOk(res, 'No hay datos de clima');
    return Clima.fromJson(jsonMapa(jsonDecode(res.body)));
  }

  // --- Registros manuales de campo (humedad/temperatura + anotaciones) ---

  Future<List<RegistroManual>> getRegistros(int parcelaId) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/parcelas/$parcelaId/registros'),
    );
    _checkOk(res, 'No se pudieron cargar los registros');
    return jsonLista(jsonDecode(res.body)).map(RegistroManual.fromJson).toList();
  }

  Future<void> crearRegistro({
    required int parcelaId,
    required int usuarioId,
    double? humedadSuelo,
    double? temperatura,
    String? anotaciones,
  }) async {
    final res = await ApiClient.post(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/parcelas/$parcelaId/registros'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'usuario_id': usuarioId,
        'humedad_suelo': ?humedadSuelo,
        'temperatura': ?temperatura,
        if (anotaciones != null && anotaciones.isNotEmpty) 'anotaciones': anotaciones,
      }),
    );
    _checkCreated(res, 'No se pudo guardar el registro');
  }

  Future<List<Lectura>> getLecturas(int estacionId) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.lecturasBaseUrl}/api/estaciones/$estacionId/lecturas'),
    );
    _checkOk(res, 'No se pudo cargar el historial');
    return jsonLista(jsonDecode(res.body)).map(Lectura.fromJson).toList();
  }

  // --- Asignación de parcelas a usuarios ---

  Future<List<Asignacion>> getAsignaciones() async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/asignaciones'));
    _checkOk(res, 'No se pudieron cargar las asignaciones');
    return jsonLista(jsonDecode(res.body)).map(Asignacion.fromJson).toList();
  }

  /// Asignaciones de un solo usuario (a diferencia de [getAsignaciones],
  /// que trae las de todos). La usa el agrónomo para saber qué parcelas
  /// ya tiene antes de agregarse una nueva sin perder las anteriores,
  /// ya que [setAsignaciones] reemplaza el conjunto completo.
  Future<List<Asignacion>> getAsignacionesUsuario(int usuarioId) async {
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/asignaciones/$usuarioId'));
    _checkOk(res, 'No se pudieron cargar tus asignaciones');
    return jsonLista(jsonDecode(res.body)).map(Asignacion.fromJson).toList();
  }

  Future<void> setAsignaciones(int usuarioId, List<int> parcelaIds) async {
    final res = await ApiClient.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/asignaciones/$usuarioId'),
      headers: _jsonHeaders,
      body: jsonEncode({'parcela_ids': parcelaIds}),
    );
    _checkOk(res, 'No se pudieron asignar las parcelas');
  }

  // --- Inventario de cultivos ---
  // Siempre se manda el usuario_id: si es agrónomo, fincas-service solo le
  // deja ver y gestionar cultivos de sus parcelas asignadas.

  static final _formatoFecha = DateFormat('yyyy-MM-dd');

  Future<List<Cultivo>> getCultivosParcela(int parcelaId, {required int usuarioId}) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/cultivos?usuario_id=$usuarioId'),
    );
    _checkOk(res, 'No se pudieron cargar los cultivos');
    return jsonLista(jsonDecode(res.body)).map(Cultivo.fromJson).toList();
  }

  /// Crea el cultivo si [id] es null; si no, lo edita.
  Future<void> guardarCultivo({
    int? id,
    required int usuarioId,
    required int parcelaId,
    required String tipo,
    String? variedad,
    required DateTime fechaSiembra,
    DateTime? fechaCosechaEstimada,
    required double cantidad,
    required String unidad,
    required String estado,
    String? notas,
  }) async {
    final body = jsonEncode({
      'usuario_id': usuarioId,
      'parcela_id': parcelaId,
      'tipo': tipo,
      'variedad': variedad,
      'fecha_siembra': _formatoFecha.format(fechaSiembra),
      'fecha_cosecha_estimada': fechaCosechaEstimada != null ? _formatoFecha.format(fechaCosechaEstimada) : null,
      'cantidad': cantidad,
      'unidad': unidad,
      'estado': estado,
      'notas': notas,
    });

    if (id == null) {
      final res = await ApiClient.post(
        Uri.parse('${ApiConfig.fincasBaseUrl}/api/cultivos'),
        headers: _jsonHeaders,
        body: body,
      );
      _checkCreated(res, 'No se pudo crear el cultivo');
    } else {
      final res = await ApiClient.put(
        Uri.parse('${ApiConfig.fincasBaseUrl}/api/cultivos/$id'),
        headers: _jsonHeaders,
        body: body,
      );
      _checkOk(res, 'No se pudo editar el cultivo');
    }
  }

  Future<void> eliminarCultivo(int id, {required int usuarioId}) async {
    final res = await ApiClient.delete(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/cultivos/$id?usuario_id=$usuarioId'),
    );
    _checkOk(res, 'No se pudo eliminar el cultivo');
  }

  // --- Riego ---
  // Igual que cultivos: el usuario_id viaja siempre y fincas-service rechaza
  // las parcelas que un agrónomo no tenga asignadas.

  Future<RiegoResumen> getRiegoParcela(int parcelaId, {required int usuarioId}) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/riego?usuario_id=$usuarioId'),
    );
    _checkOk(res, 'No se pudo cargar el riego de la parcela');
    return RiegoResumen.fromJson(jsonMapa(jsonDecode(res.body)));
  }

  Future<void> regarAhora(int parcelaId, {required int duracionMinutos, required int usuarioId}) async {
    final res = await ApiClient.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/riego/iniciar'),
      headers: _jsonHeaders,
      body: jsonEncode({'duracion_minutos': duracionMinutos, 'usuario_id': usuarioId}),
    );
    _checkCreated(res, 'No se pudo iniciar el riego');
  }

  Future<void> detenerRiego(int parcelaId, {required int usuarioId}) async {
    final res = await ApiClient.post(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/riego/detener'),
      headers: _jsonHeaders,
      body: jsonEncode({'usuario_id': usuarioId}),
    );
    _checkOk(res, 'No se pudo detener el riego');
  }

  Future<void> setRiegoAutomatico(int parcelaId, {required bool activo, required int usuarioId}) async {
    final res = await ApiClient.put(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/parcelas/$parcelaId/riego-automatico'),
      headers: _jsonHeaders,
      body: jsonEncode({'activo': activo, 'usuario_id': usuarioId}),
    );
    _checkOk(res, 'No se pudo cambiar el riego automático');
  }

  // --- Dashboard ---

  /// Con [usuarioId], el contador de cultivos activos de un agrónomo se
  /// limita a sus parcelas asignadas (el resto del resumen es general).
  Future<DashboardResumen> getDashboardResumen({int? usuarioId}) async {
    final query = usuarioId != null ? '?usuario_id=$usuarioId' : '';
    final res = await ApiClient.get(Uri.parse('${ApiConfig.fincasBaseUrl}/api/dashboard/resumen$query'));
    _checkOk(res, 'No se pudo cargar el resumen');
    return DashboardResumen.fromJson(jsonMapa(jsonDecode(res.body)));
  }

  Future<List<HistorialPunto>> getDashboardHistorial({int dias = 7}) async {
    final res = await ApiClient.get(
      Uri.parse('${ApiConfig.fincasBaseUrl}/api/dashboard/humedad-historial?dias=$dias'),
    );
    _checkOk(res, 'No se pudo cargar el historial de humedad');
    return jsonLista(jsonDecode(res.body)).map(HistorialPunto.fromJson).toList();
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
