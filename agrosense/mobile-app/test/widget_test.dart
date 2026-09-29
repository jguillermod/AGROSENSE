// Smoke test: la app arranca y, sin sesión guardada, muestra el login.

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/main.dart';

void main() {
  testWidgets('Sin sesión guardada, arranca en la pantalla de login', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});

    await tester.pumpWidget(const AgroSenseApp());
    await tester.pumpAndSettle();

    expect(find.text('AgroSense'), findsOneWidget);
    expect(find.text('Ingresar'), findsOneWidget);
  });
}
