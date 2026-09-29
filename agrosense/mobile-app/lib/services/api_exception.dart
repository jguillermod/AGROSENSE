import 'dart:convert';

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
}
