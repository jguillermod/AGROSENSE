/// Lectura tolerante del JSON que mandan los microservicios.
///
/// Un `json['x'] as String` truena con "type 'Null' is not a subtype of type
/// 'String'" si el campo falta o viene null (p. ej. una respuesta de POST con
/// menos columnas que la del GET). Estas funciones nunca lanzan: devuelven
/// null o el valor por defecto, y aceptan números que llegan como texto
/// (MariaDB entrega DECIMAL como "12.50").
library;

/// El objeto tal cual, o un mapa vacío si no es un objeto JSON.
Map<String, dynamic> jsonMapa(dynamic v) {
  if (v is Map<String, dynamic>) return v;
  if (v is Map) return v.map((k, valor) => MapEntry(k.toString(), valor));
  return <String, dynamic>{};
}

/// Los objetos de una lista JSON (ignora lo que no sea objeto); [] si no es lista.
List<Map<String, dynamic>> jsonLista(dynamic v) =>
    v is List ? v.whereType<Map>().map(jsonMapa).toList() : <Map<String, dynamic>>[];

String? jsonTextoOpt(dynamic v) => v?.toString();

String jsonTexto(dynamic v, [String porDefecto = '']) => v?.toString() ?? porDefecto;

int? jsonEnteroOpt(dynamic v) {
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.toInt();
  return null;
}

int jsonEntero(dynamic v, [int porDefecto = 0]) => jsonEnteroOpt(v) ?? porDefecto;

double? jsonDecimalOpt(dynamic v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

double jsonDecimal(dynamic v, [double porDefecto = 0]) => jsonDecimalOpt(v) ?? porDefecto;

/// MySQL manda los booleanos como 0/1.
bool jsonBool(dynamic v) => v == true || v == 1 || v == '1';

/// Fecha ISO o "YYYY-MM-DD HH:MM:SS", tal como venga (sin convertir de zona).
DateTime? jsonFecha(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
