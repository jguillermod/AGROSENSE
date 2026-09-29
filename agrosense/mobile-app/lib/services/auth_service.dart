import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api_config.dart';
import '../models/models.dart';
import 'api_exception.dart';

/// Resultado de una operación de autenticación: si falló, [error] trae
/// el mensaje que devolvió el backend; si tuvo éxito, viene null.
class AuthResult {
  final bool ok;
  final String? error;

  AuthResult.success() : ok = true, error = null;
  AuthResult.failure(this.error) : ok = false;
}

/// Login/registro/logout y todo lo relacionado al usuario: sesión
/// guardada en SharedPreferences (equivalente a las cookies del panel
/// web), gestión de otros usuarios (solo admin) y edición del perfil
/// propio (correo, contraseña, foto).
class AuthService {
  static const _keyToken = 'token';
  static const _keyUsuarioId = 'usuario_id';
  static const _keyUsuarioNombre = 'usuario_nombre';
  static const _keyUsuarioRol = 'usuario_rol';
  static const _keyUsuarioFoto = 'usuario_foto';

  static const _jsonHeaders = {'Content-Type': 'application/json'};

  Future<AuthResult> login(String email, String password) async {
    try {
      final res = await http.post(
        Uri.parse('${ApiConfig.authBaseUrl}/api/auth/login'),
        headers: _jsonHeaders,
        body: jsonEncode({'email': email, 'password': password}),
      );

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode != 200) {
        return AuthResult.failure(data['error'] as String? ?? 'Credenciales inválidas');
      }

      final usuario = data['usuario'] as Map<String, dynamic>;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_keyToken, data['token'] as String);
      await prefs.setInt(_keyUsuarioId, usuario['id'] as int);
      await prefs.setString(_keyUsuarioNombre, usuario['nombre'] as String? ?? '');
      await prefs.setString(_keyUsuarioRol, usuario['rol'] as String? ?? '');
      await prefs.setString(_keyUsuarioFoto, usuario['foto_url'] as String? ?? '');

      return AuthResult.success();
    } catch (e) {
      return AuthResult.failure('No se pudo conectar con el servidor');
    }
  }

  /// El auto-registro siempre crea cuentas de agricultor, igual que en
  /// el panel web: los administradores se crean desde Usuarios.
  Future<AuthResult> register(String nombre, String email, String password) async {
    try {
      final res = await http.post(
        Uri.parse('${ApiConfig.authBaseUrl}/api/auth/register'),
        headers: _jsonHeaders,
        body: jsonEncode({
          'nombre': nombre,
          'email': email,
          'password': password,
          'rol': 'agricultor',
        }),
      );

      if (res.statusCode != 201) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return AuthResult.failure(data['error'] as String? ?? 'No se pudo completar el registro');
      }
      return AuthResult.success();
    } catch (e) {
      return AuthResult.failure('No se pudo conectar con el servidor');
    }
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  }

  Future<bool> isLoggedIn() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyToken) != null;
  }

  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyToken);
  }

  Future<int?> getUsuarioId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_keyUsuarioId);
  }

  Future<String?> getUsuarioNombre() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyUsuarioNombre);
  }

  Future<String?> getUsuarioRol() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyUsuarioRol);
  }

  Future<String?> getUsuarioFoto() async {
    final prefs = await SharedPreferences.getInstance();
    final foto = prefs.getString(_keyUsuarioFoto);
    return (foto == null || foto.isEmpty) ? null : foto;
  }

  Future<void> _guardarFotoCache(String? fotoUrl) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyUsuarioFoto, fotoUrl ?? '');
  }

  // --- Gestión de usuarios (solo admin) ---

  Future<List<Usuario>> getUsuarios() async {
    final res = await http.get(Uri.parse('${ApiConfig.authBaseUrl}/api/auth/usuarios'));
    _checkOk(res, 'No se pudieron cargar los usuarios');
    final List<dynamic> data = jsonDecode(res.body);
    return data.map((e) => Usuario.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Usuario> getUsuario(int id) async {
    final res = await http.get(Uri.parse('${ApiConfig.authBaseUrl}/api/auth/usuarios/$id'));
    _checkOk(res, 'No se pudo cargar el usuario');
    return Usuario.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  /// A diferencia de [register], permite elegir el rol: la usa la
  /// pantalla de Usuarios (solo admin) para crear otros administradores.
  /// Devuelve el id creado (el propio backend ya lo entrega en la
  /// respuesta del registro, no hace falta un segundo viaje a buscarlo).
  Future<int> crearUsuario({
    required String nombre,
    required String email,
    required String password,
    required String rol,
  }) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.authBaseUrl}/api/auth/register'),
      headers: _jsonHeaders,
      body: jsonEncode({'nombre': nombre, 'email': email, 'password': password, 'rol': rol}),
    );
    if (res.statusCode != 201) {
      throw ApiException.fromResponseBody(res.body, 'No se pudo crear el usuario');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return data['id'] as int;
  }

  Future<void> editarUsuario(
    int id, {
    required String nombre,
    required String email,
    required String rol,
    String? password,
  }) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.authBaseUrl}/api/auth/usuarios/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({'nombre': nombre, 'email': email, 'rol': rol, 'password': password}),
    );
    _checkOk(res, 'No se pudo editar el usuario');
  }

  Future<void> eliminarUsuario(int id) async {
    final res = await http.delete(Uri.parse('${ApiConfig.authBaseUrl}/api/auth/usuarios/$id'));
    _checkOk(res, 'No se pudo eliminar el usuario');
  }

  // --- Perfil propio (correo, contraseña, foto por separado) ---

  Future<void> actualizarCorreo({required int id, required String email, required String passwordActual}) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.authBaseUrl}/api/auth/usuarios/$id/perfil'),
      headers: _jsonHeaders,
      body: jsonEncode({'email': email, 'password_actual': passwordActual}),
    );
    _checkOk(res, 'No se pudo actualizar el correo');
  }

  Future<void> actualizarContrasena({
    required int id,
    required String passwordActual,
    required String passwordNueva,
  }) async {
    final res = await http.put(
      Uri.parse('${ApiConfig.authBaseUrl}/api/auth/usuarios/$id/perfil'),
      headers: _jsonHeaders,
      body: jsonEncode({'password_actual': passwordActual, 'password_nueva': passwordNueva}),
    );
    _checkOk(res, 'No se pudo actualizar la contraseña');
  }

  /// Sube la foto al panel web (que es quien guarda y sirve los
  /// archivos) autenticándose con el token guardado, como Bearer.
  ///
  /// [mimeType] es el que reporta el selector nativo de image_picker
  /// (XFile.mimeType) cuando está disponible: es más confiable que
  /// adivinarlo por la extensión del archivo temporal, que a veces no
  /// tiene una reconocida. Sin un content-type de imagen explícito, el
  /// backend (que valida el mimetype) rechaza la subida con "Formato de
  /// imagen no soportado" aunque la foto sea válida.
  Future<String> actualizarFoto(File archivo, {String? mimeType, String? nombreArchivo}) async {
    final token = await getToken();
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('${ApiConfig.webAdminBaseUrl}/api/perfil/foto'),
    )
      ..headers['Authorization'] = 'Bearer $token'
      ..files.add(await http.MultipartFile.fromPath(
        'foto',
        archivo.path,
        filename: nombreArchivo,
        contentType: _resolverContentType(mimeType, nombreArchivo ?? archivo.path),
      ));

    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);

    _checkOk(res, 'No se pudo actualizar la foto');
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final fotoUrl = data['foto_url'] as String?;
    await _guardarFotoCache(fotoUrl);
    return fotoUrl ?? '';
  }

  /// Usa el mimeType que reportó el selector nativo si vino; si no,
  /// infiere por la extensión del archivo. A falta de ambos, asume JPEG
  /// -el formato más común en fotos de cámara/galería- en vez de dejar
  /// que se mande application/octet-stream, que el backend rechaza.
  MediaType _resolverContentType(String? mimeType, String referencia) {
    if (mimeType != null && mimeType.contains('/')) {
      final partes = mimeType.split('/');
      return MediaType(partes[0], partes[1]);
    }
    final ext = referencia.split('.').last.toLowerCase();
    return switch (ext) {
      'png' => MediaType('image', 'png'),
      'webp' => MediaType('image', 'webp'),
      'gif' => MediaType('image', 'gif'),
      'heic' => MediaType('image', 'heic'),
      'heif' => MediaType('image', 'heif'),
      _ => MediaType('image', 'jpeg'),
    };
  }

  void _checkOk(http.Response res, String fallback) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiException.fromResponseBody(res.body, fallback);
    }
  }
}
