/// URLs base de los microservicios de AgroSense.
///
/// Producción: se compila con la URL pública del servidor, y cada servicio
/// queda detrás del mismo dominio por HTTPS (ver caddy/Caddyfile):
///
///   flutter build apk --dart-define=API_BASE_URL=https://agrosense.ejemplo.com
///
///   auth     → https://dominio/api/auth
///   fincas   → https://dominio/api/fincas
///   lecturas → https://dominio/api/lecturas
///   web      → https://dominio (fotos de perfil)
///
/// Desarrollo (sin API_BASE_URL): cada servicio en su puerto de la PC.
/// 192.168.1.9 es la IP de la PC (donde corre docker-compose) dentro de
/// la red WiFi local. Es necesaria para probar en un celular físico, ya
/// que "localhost"/10.0.2.2 solo funcionan desde el emulador de Android
/// en la misma máquina. El celular debe estar conectado a esa misma red.
class ApiConfig {
  static const String _apiBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const String _hostDesarrollo = 'http://192.168.1.9';

  /// URL pública sin "/" final (vacía en desarrollo)
  static String get _base => _apiBaseUrl.endsWith('/') ? _apiBaseUrl.substring(0, _apiBaseUrl.length - 1) : _apiBaseUrl;

  static bool get esProduccion => _apiBaseUrl.isNotEmpty;

  static String get authBaseUrl => esProduccion ? '$_base/api/auth' : '$_hostDesarrollo:3001';
  static String get fincasBaseUrl => esProduccion ? '$_base/api/fincas' : '$_hostDesarrollo:3002';
  static String get lecturasBaseUrl => esProduccion ? '$_base/api/lecturas' : '$_hostDesarrollo:3003';

  /// El panel web (web-admin) solo se usa para subir la foto de perfil:
  /// es quien guarda los archivos y los sirve luego en /uploads/avatars.
  static String get webAdminBaseUrl => esProduccion ? _base : '$_hostDesarrollo:8080';

  /// Los `foto_url` que devuelven los servicios son rutas relativas
  /// (ej. "/uploads/avatars/usuario-1-123.png"); hay que anteponerles
  /// el host de web-admin, que es quien realmente sirve esos archivos.
  static String? resolveFotoUrl(String? fotoUrl) {
    if (fotoUrl == null || fotoUrl.isEmpty) return null;
    if (fotoUrl.startsWith('http')) return fotoUrl;
    return '$webAdminBaseUrl$fotoUrl';
  }
}
