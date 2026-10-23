import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../screens/login_screen.dart';
import 'api_exception.dart';
import 'auth_service.dart';

/// Cliente HTTP para los microservicios: agrega `Authorization: Bearer
/// TOKEN` (el JWT guardado al iniciar sesión) a cada petición.
///
/// Si un servicio responde 401 de sesión (trae la cabecera
/// WWW-Authenticate: token vencido o inválido), borra la sesión guardada y
/// vuelve al login. Otros 401, como "la contraseña actual no es correcta",
/// no traen esa cabecera y se manejan como un error normal.
class ApiClient {
  ApiClient._();

  /// Lo usa MaterialApp para que el cliente pueda volver al login desde
  /// cualquier pantalla.
  static final navigatorKey = GlobalKey<NavigatorState>();
  static final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

  static bool _cerrandoSesion = false;

  static Future<Map<String, String>> _headers(Map<String, String>? extra) async {
    final token = await AuthService().getToken();
    return {
      ...?extra,
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Future<http.Response> get(Uri url, {Map<String, String>? headers}) async =>
      _revisar(await http.get(url, headers: await _headers(headers)));

  static Future<http.Response> post(Uri url, {Map<String, String>? headers, Object? body}) async =>
      _revisar(await http.post(url, headers: await _headers(headers), body: body));

  static Future<http.Response> put(Uri url, {Map<String, String>? headers, Object? body}) async =>
      _revisar(await http.put(url, headers: await _headers(headers), body: body));

  static Future<http.Response> delete(Uri url, {Map<String, String>? headers, Object? body}) async =>
      _revisar(await http.delete(url, headers: await _headers(headers), body: body));

  /// Para peticiones armadas a mano (p. ej. multipart para subir la foto).
  static Future<http.Response> send(http.BaseRequest request) async {
    request.headers.addAll(await _headers(null));
    return _revisar(await http.Response.fromStream(await request.send()));
  }

  static Future<http.Response> _revisar(http.Response res) async {
    final autenticacion = res.headers['www-authenticate'] ?? '';
    if (res.statusCode == 401 && autenticacion.toLowerCase().startsWith('bearer')) {
      await _volverAlLogin();
      throw SesionExpiradaException();
    }
    return res;
  }

  static Future<void> _volverAlLogin() async {
    // varias peticiones pueden fallar a la vez: se navega una sola vez
    if (_cerrandoSesion) return;
    _cerrandoSesion = true;
    try {
      await AuthService().logout();
      navigatorKey.currentState?.pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
      scaffoldMessengerKey.currentState?.showSnackBar(
        const SnackBar(content: Text('Tu sesión expiró. Vuelve a iniciar sesión.')),
      );
    } finally {
      _cerrandoSesion = false;
    }
  }
}
