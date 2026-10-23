// Errores vistos en el celular, contra un backend simulado:
// - "Generar token" con la respuesta incompleta del POST (campos null).
// - Diálogo "Regar ahora" con el teclado abierto (BOTTOM OVERFLOWED).
// - Volver de Cultivos al detalle de parcela ("setState() callback argument
//   returned a Future").

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/models/models.dart';
import 'package:agrosense_app/screens/parcela_detail_screen.dart';
import 'package:agrosense_app/screens/sensores_screen.dart';
import 'package:agrosense_app/widgets/riego_section.dart';

http.Response _json(Object cuerpo, [int status = 200]) =>
    http.Response(jsonEncode(cuerpo), status, headers: {'content-type': 'application/json; charset=utf-8'});

const _riegoVacio = {'riego_automatico': false, 'riego_en_curso': null, 'programaciones': [], 'ultimos_riegos': []};

final _parcela = Parcela(id: 3, nombre: 'Lote 3', fincaId: 1, humedadMin: 30, humedadMax: 85, temperaturaMax: 38);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({
        'token': 't',
        'usuario_id': 1,
        'usuario_nombre': 'Admin',
        'usuario_rol': 'admin',
        'usuario_foto': '',
      }));

  testWidgets('Sensores: generar token con campos null no truena y la lista muestra finca, parcela y estado',
      (tester) async {
    final ahora = DateTime.now().toUtc();
    final backend = MockClient((request) async {
      final ruta = request.url.path;
      if (request.method == 'POST' && ruta == '/api/sensores/tokens') {
        // forma vieja del POST: sin estado, creado_en, finca ni parcela
        return _json({
          'id': 9,
          'token': 'abcdef0123456789abcdef0123456789',
          'parcela_id': 3,
          'expira_en': ahora.add(const Duration(minutes: 30)).toIso8601String(),
        }, 201);
      }
      if (ruta == '/api/sensores/tokens') {
        return _json([
          {
            'id': 9,
            'token': 'abcdef0123456789abcdef0123456789',
            'estado': 'pendiente',
            'expira_en': ahora.add(const Duration(minutes: 30)).toIso8601String(),
            'parcela_nombre': 'Lote 3',
            'finca_nombre': 'Finca Norte',
          },
          {
            // pendiente en la base pero ya vencido
            'id': 8,
            'token': '1111222233334444',
            'estado': 'pendiente',
            'expira_en': ahora.subtract(const Duration(minutes: 5)).toIso8601String(),
            'parcela_nombre': null,
            'finca_nombre': null,
          },
          {'id': 7, 'token': 'xyz', 'estado': 'usado', 'expira_en': null, 'parcela_nombre': 'Lote 1', 'finca_nombre': null},
        ]);
      }
      if (ruta == '/api/parcelas') {
        return _json([
          {'id': 3, 'nombre': 'Lote 3', 'finca_id': 1, 'finca_nombre': null},
        ]);
      }
      return _json([]);
    });

    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: SensoresScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Vincular sensor'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Generar token'));
      await tester.pumpAndSettle();
    }, () => backend);

    expect(tester.takeException(), isNull);
    expect(find.text('Token generado'), findsOneWidget);
    expect(find.text('abcdef0123456789abcdef0123456789'), findsOneWidget);
    expect(find.text('Parcela #3'), findsOneWidget);

    await http.runWithClient(() async {
      await tester.tap(find.text('Cerrar'));
      await tester.pumpAndSettle();
    }, () => backend);

    expect(find.text('Finca Norte · Lote 3'), findsOneWidget);
    expect(find.text('vigente'), findsOneWidget);
    expect(find.text('expirado'), findsOneWidget);
    expect(find.text('usado'), findsOneWidget);
    expect(find.text('Parcela sin nombre'), findsOneWidget);
    expect(find.text('Lote 1'), findsOneWidget);
    // solo el vigente se puede revocar
    expect(find.byIcon(Icons.close), findsOneWidget);
  });

  testWidgets('Regar ahora: con el teclado abierto en un celular pequeño no desborda', (tester) async {
    // 360x640 lógicos, con un teclado de 300 px
    tester.view.devicePixelRatio = 2;
    tester.view.physicalSize = const Size(720, 1280);
    tester.view.viewInsets = const FakeViewPadding(bottom: 600);
    addTearDown(tester.view.reset);

    final backend = MockClient((request) async => _json(_riegoVacio));
    await http.runWithClient(() async {
      // igual que en el detalle de parcela: la sección va dentro de una lista
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: ListView(children: [RiegoSection(parcela: _parcela)])),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Regar ahora'));
      await tester.pumpAndSettle();
    }, () => backend);

    expect(tester.takeException(), isNull);
    expect(find.text('15 min'), findsOneWidget);
    expect(find.text('60 min'), findsOneWidget);

    // con el teclado abierto el contenido se desplaza para llegar a los chips
    await tester.ensureVisible(find.text('60 min'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('60 min'));
    await tester.pump();
    expect(find.widgetWithText(TextFormField, '60'), findsOneWidget);

    // el Timer.periodic de la sección se cancela al desmontarla
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Detalle de parcela: volver de Cultivos recarga sin error de setState', (tester) async {
    final backend = MockClient((request) async {
      if (request.url.path.endsWith('/riego')) return _json(_riegoVacio);
      return _json([]);
    });

    await http.runWithClient(() async {
      await tester.pumpWidget(MaterialApp(home: ParcelaDetailScreen(parcela: _parcela)));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(find.text('Inventario de cultivos'), 200);
      await tester.tap(find.text('Inventario de cultivos'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
    }, () => backend);

    expect(tester.takeException(), isNull);
    expect(find.text('Inventario de cultivos'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
