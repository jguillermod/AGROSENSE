// Mínimo de contraseña (8) en el registro de la app, contra un backend simulado.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/screens/register_screen.dart';

Future<void> _escribir(WidgetTester tester, String etiqueta, String texto) async {
  await tester.enterText(find.widgetWithText(TextFormField, etiqueta), texto);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('Registro: 7 caracteres se rechaza sin llamar al backend; 8 entra', (tester) async {
    final enviados = <Map<String, dynamic>>[];
    final backend = MockClient((request) async {
      enviados.add(jsonDecode(request.body) as Map<String, dynamic>);
      return http.Response(
        jsonEncode({'id': 1, 'nombre': 'Ana', 'email': 'ana@ejemplo.com', 'rol': 'agricultor'}),
        201,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });

    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: RegisterScreen()));
      expect(find.text('Mínimo 8 caracteres'), findsOneWidget);

      await _escribir(tester, 'Nombre completo', 'Ana');
      await _escribir(tester, 'Correo electrónico', 'ana@ejemplo.com');
      await _escribir(tester, 'Contraseña', '1234567');
      await tester.tap(find.text('Registrarse'));
      await tester.pumpAndSettle();
      expect(find.text('La contraseña debe tener al menos 8 caracteres.'), findsOneWidget);
      expect(enviados, isEmpty);

      await _escribir(tester, 'Contraseña', '12345678');
      await tester.tap(find.text('Registrarse'));
      await tester.pumpAndSettle();
    }, () => backend);

    expect(enviados, hasLength(1));
    expect(enviados.single['password'], '12345678');
    expect(find.text('Usuario registrado correctamente'), findsOneWidget);
  });
}
