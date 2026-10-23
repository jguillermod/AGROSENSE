// Si los servicios rechazan el token (401 con WWW-Authenticate), la app
// borra la sesión guardada y vuelve al login (ver ApiClient).

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/main.dart';
import 'package:agrosense_app/services/api_exception.dart';

void main() {
  testWidgets('Un 401 de sesión cierra la sesión y vuelve al login', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({
      'token': 'token-vencido',
      'usuario_id': 1,
      'usuario_nombre': 'Admin',
      'usuario_rol': 'admin',
      'usuario_foto': '',
    });

    final cabecerasRecibidas = <String?>[];
    final backend = MockClient((request) async {
      cabecerasRecibidas.add(request.headers['Authorization']);
      return http.Response(
        '{"error":"La sesión expiró: vuelve a iniciar sesión"}',
        401,
        headers: {'www-authenticate': 'Bearer realm="agrosense"', 'content-type': 'application/json'},
      );
    });

    // Las peticiones de pantallas que se cerraron al volver al login terminan
    // en SesionExpiradaException sin nadie que las escuche (en la app las
    // absorbe PlatformDispatcher.onError, ver main.dart); aquí se recogen
    // para comprobar que no se escapa ningún otro error.
    final erroresSueltos = <Object>[];
    await runZonedGuarded(
      () => http.runWithClient(() async {
        await tester.pumpWidget(const AgroSenseApp());
        await tester.pumpAndSettle();
      }, () => backend),
      (error, _) => erroresSueltos.add(error),
    );

    expect(erroresSueltos.every((e) => e is SesionExpiradaException), isTrue, reason: '$erroresSueltos');

    // la primera petición lleva el JWT guardado; las que salen después de
    // cerrar la sesión ya no llevan ninguno
    expect(cabecerasRecibidas.first, 'Bearer token-vencido');
    expect(cabecerasRecibidas.every((c) => c == 'Bearer token-vencido' || c == null), isTrue);
    expect(find.text('Ingresar'), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('token'), isNull);
  });
}
