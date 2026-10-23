import 'dart:convert';

import '../models/json.dart';

/// Excepción con el mensaje de error tal como lo manda el backend
/// (ej. "No se puede eliminar: la finca todavía tiene parcelas"), para
/// mostrarlo directamente en la UI en vez de un mensaje genérico.
class ApiException implements Exception {
  final String message;
  ApiException(this.message);

  @override
  String toString() => message;

  static ApiException fromResponseBody(String body, String fallback) {
    try {
      final data = jsonDecode(body);
      if (data is Map && data['error'] is String) {
        return ApiException(data['error'] as String);
      }
    } catch (_) {
      // el cuerpo no era JSON; usamos el mensaje por defecto
    }
    return ApiException(fallback);
  }

  /// id del recurso recién creado. Sin él no se puede seguir (p. ej. asignar
  /// parcelas al usuario nuevo), así que falla con un mensaje legible en
  /// lugar de inventar un id.
  static int idCreado(String body) {
    try {
      final id = jsonEnteroOpt(jsonMapa(jsonDecode(body))['id']);
      if (id != null) return id;
    } catch (_) {
      // el cuerpo no era JSON
    }
    throw ApiException('Respuesta inesperada del servidor');
  }
}

/// El servicio rechazó el token de la sesión (401 con WWW-Authenticate).
/// ApiClient ya cerró la sesión y volvió al login al lanzarla.
class SesionExpiradaException extends ApiException {
  SesionExpiradaException() : super('Tu sesión expiró. Vuelve a iniciar sesión.');
}
