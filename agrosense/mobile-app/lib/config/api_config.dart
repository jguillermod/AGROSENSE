/// URLs base de los microservicios de AgroSense.
///
/// 192.168.1.9 es la IP de la PC (donde corre docker-compose) dentro de
/// la red WiFi local. Es necesaria para probar en un celular físico, ya
/// que "localhost"/10.0.2.2 solo funcionan desde el emulador de Android
/// en la misma máquina. El celular debe estar conectado a esa misma red.
class ApiConfig {
  static const String authBaseUrl = 'http://192.168.1.9:3001';
  static const String fincasBaseUrl = 'http://192.168.1.9:3002';
  static const String lecturasBaseUrl = 'http://192.168.1.9:3003';

  /// El panel web (web-admin) solo se usa para subir la foto de perfil:
  /// es quien guarda los archivos y los sirve luego en /uploads/avatars.
  static const String webAdminBaseUrl = 'http://192.168.1.9:8080';

  /// Los `foto_url` que devuelven los servicios son rutas relativas
  /// (ej. "/uploads/avatars/usuario-1-123.png"); hay que anteponerles
  /// el host de web-admin, que es quien realmente sirve esos archivos.
  static String? resolveFotoUrl(String? fotoUrl) {
    if (fotoUrl == null || fotoUrl.isEmpty) return null;
    if (fotoUrl.startsWith('http')) return fotoUrl;
    return '$webAdminBaseUrl$fotoUrl';
  }
}
