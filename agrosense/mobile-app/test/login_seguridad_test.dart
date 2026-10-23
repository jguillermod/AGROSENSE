// Bloqueo de cuenta (423) y recuperación de contraseña en la app, contra un
// backend simulado.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/screens/login_screen.dart';

Future<void> _escribir(WidgetTester tester, String etiqueta, String texto) async {
  await tester.enterText(find.widgetWithText(TextFormField, etiqueta), texto);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('Cuenta bloqueada: el login muestra el tiempo restante', (tester) async {
    final backend = MockClient((request) async => http.Response(
          jsonEncode({
            'error': 'La cuenta está bloqueada por demasiados intentos fallidos. Podrás intentarlo de nuevo en 14 min 20 s.',
            'bloqueado': true,
            'segundos_restantes': 860,
          }),
          423,
          headers: {'content-type': 'application/json; charset=utf-8'},
        ));

    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
      await _escribir(tester, 'Correo electrónico', 'agricultor@ejemplo.com');
      await _escribir(tester, 'Contraseña', 'incorrecta');
      await tester.tap(find.text('Ingresar'));
      await tester.pumpAndSettle();
    }, () => backend);

    expect(find.textContaining('14 min 20 s'), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('token'), isNull);
  });

  testWidgets('Recuperación: pide el código, lo precarga (modo dev) y define la contraseña', (tester) async {
    final cuerpos = <String, Map<String, dynamic>>{};
    final backend = MockClient((request) async {
      cuerpos[request.url.path] = jsonDecode(request.body) as Map<String, dynamic>;
      final cuerpo = request.url.path.endsWith('/recuperar')
          ? {'mensaje': 'Si el correo está registrado, te enviamos un enlace.', 'dev_token': 'codigo-de-prueba'}
          : {'mensaje': 'Contraseña actualizada. Ya puedes iniciar sesión.'};
      return http.Response(jsonEncode(cuerpo), 200, headers: {'content-type': 'application/json; charset=utf-8'});
    });

    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
      await tester.tap(find.text('¿Olvidaste tu contraseña?'));
      await tester.pumpAndSettle();

      await _escribir(tester, 'Correo electrónico', 'agricultor@ejemplo.com');
      await tester.tap(find.text('Enviar código'));
      await tester.pumpAndSettle();
      expect(find.text('codigo-de-prueba'), findsOneWidget);

      // menos de 8 caracteres: no se envía
      await _escribir(tester, 'Contraseña nueva', 'corta');
      await _escribir(tester, 'Repite la contraseña', 'corta');
      await tester.tap(find.text('Guardar contraseña'));
      await tester.pumpAndSettle();
      expect(find.text('La contraseña debe tener al menos 8 caracteres.'), findsOneWidget);
      expect(cuerpos.containsKey('/api/auth/restablecer'), isFalse);

      await _escribir(tester, 'Contraseña nueva', 'nueva-segura-1');
      await _escribir(tester, 'Repite la contraseña', 'nueva-segura-1');
      await tester.tap(find.text('Guardar contraseña'));
      await tester.pumpAndSettle();
    }, () => backend);

    expect(cuerpos['/api/auth/recuperar'], {'email': 'agricultor@ejemplo.com'});
    expect(cuerpos['/api/auth/restablecer'], {'token': 'codigo-de-prueba', 'password': 'nueva-segura-1'});
    expect(find.text('Contraseña actualizada'), findsOneWidget);
  });
}
