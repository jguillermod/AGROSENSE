// URLs de la API según cómo se compile la app:
//   flutter test                                                        → desarrollo
//   flutter test --dart-define=API_BASE_URL=https://agrosense.ejemplo.com/  → producción

import 'package:flutter_test/flutter_test.dart';

import 'package:agrosense_app/config/api_config.dart';

void main() {
  test('cada servicio tiene su URL base (desarrollo o producción)', () {
    if (ApiConfig.esProduccion) {
      // con o sin "/" final en API_BASE_URL
      expect(ApiConfig.authBaseUrl, 'https://agrosense.ejemplo.com/api/auth');
      expect(ApiConfig.fincasBaseUrl, 'https://agrosense.ejemplo.com/api/fincas');
      expect(ApiConfig.lecturasBaseUrl, 'https://agrosense.ejemplo.com/api/lecturas');
      expect(ApiConfig.webAdminBaseUrl, 'https://agrosense.ejemplo.com');
      expect(ApiConfig.resolveFotoUrl('/uploads/avatars/a.png'), 'https://agrosense.ejemplo.com/uploads/avatars/a.png');
    } else {
      expect(ApiConfig.authBaseUrl, 'http://192.168.1.9:3001');
      expect(ApiConfig.fincasBaseUrl, 'http://192.168.1.9:3002');
      expect(ApiConfig.lecturasBaseUrl, 'http://192.168.1.9:3003');
      expect(ApiConfig.webAdminBaseUrl, 'http://192.168.1.9:8080');
    }
  });
}
