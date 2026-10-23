// El botón de ojo muestra y oculta la contraseña; por defecto está oculta.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/screens/login_screen.dart';
import 'package:agrosense_app/screens/recuperar_password_screen.dart';

bool _oculta(WidgetTester tester, String etiqueta) {
  final campo = find.descendant(
    of: find.widgetWithText(TextFormField, etiqueta),
    matching: find.byType(EditableText),
  );
  return tester.widget<EditableText>(campo).obscureText;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('Login: la contraseña empieza oculta y el ojo la alterna', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    await tester.enterText(find.widgetWithText(TextFormField, 'Contraseña'), 'secreta1');

    expect(_oculta(tester, 'Contraseña'), isTrue);
    await tester.tap(find.byTooltip('Mostrar contraseña'));
    await tester.pump();
    expect(_oculta(tester, 'Contraseña'), isFalse);
    expect(find.byTooltip('Ocultar contraseña'), findsOneWidget);

    await tester.tap(find.byTooltip('Ocultar contraseña'));
    await tester.pump();
    expect(_oculta(tester, 'Contraseña'), isTrue);
  });

  testWidgets('Recuperación: nueva contraseña y confirmación se alternan por separado', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: RecuperarPasswordScreen()));
    await tester.tap(find.text('Ya tengo un código'));
    await tester.pumpAndSettle();

    expect(_oculta(tester, 'Contraseña nueva'), isTrue);
    expect(_oculta(tester, 'Repite la contraseña'), isTrue);
    await tester.tap(find.byTooltip('Mostrar contraseña').first);
    await tester.pump();
    expect(_oculta(tester, 'Contraseña nueva'), isFalse);
    expect(_oculta(tester, 'Repite la contraseña'), isTrue);
  });
}
