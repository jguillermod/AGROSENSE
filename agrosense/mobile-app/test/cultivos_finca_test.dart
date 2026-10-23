// Cultivos a nivel de finca o de parcela, contra un backend simulado.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:agrosense_app/models/models.dart';
import 'package:agrosense_app/screens/cultivos_screen.dart';
import 'package:agrosense_app/screens/parcelas_screen.dart';

http.Response _json(Object cuerpo, [int status = 200]) =>
    http.Response(jsonEncode(cuerpo), status, headers: {'content-type': 'application/json; charset=utf-8'});

Map<String, dynamic> _cultivo(int id, int fincaId, String finca, int? parcelaId, String? parcela, String tipo) => {
      'id': id,
      'finca_id': fincaId,
      'finca_nombre': finca,
      'parcela_id': parcelaId,
      'parcela_nombre': parcela,
      'tipo': tipo,
      'fecha_siembra': '2026-01-10',
      'cantidad': '10.00',
      'unidad': 'kg',
      'estado': 'sembrado',
    };

final _cultivos = [
  _cultivo(1, 1, 'Finca A', null, null, 'Frijol'),
  _cultivo(2, 1, 'Finca A', 11, 'Lote 1', 'Tomate'),
  _cultivo(3, 2, 'Finca B', 21, 'Lote B', 'Café'),
];

final _parcelasFlat = [
  {'id': 11, 'nombre': 'Lote 1', 'finca_id': 1, 'finca_nombre': 'Finca A'},
  {'id': 12, 'nombre': 'Lote 2', 'finca_id': 1, 'finca_nombre': 'Finca A'},
  {'id': 21, 'nombre': 'Lote B', 'finca_id': 2, 'finca_nombre': 'Finca B'},
];

/// Backend falso: guarda los cuerpos de los POST a /api/cultivos.
MockClient _backend(List<Map<String, dynamic>> enviados) => MockClient((request) async {
      final ruta = request.url.path;
      if (request.method == 'POST' && ruta == '/api/cultivos') {
        enviados.add(jsonDecode(request.body) as Map<String, dynamic>);
        return _json({'id': 99}, 201);
      }
      if (ruta == '/api/cultivos') return _json(_cultivos);
      if (ruta == '/api/fincas/1/cultivos') return _json(_cultivos.where((c) => c['finca_id'] == 1).toList());
      if (ruta == '/api/parcelas') return _json(_parcelasFlat);
      if (ruta == '/api/fincas') {
        return _json([
          {'id': 1, 'nombre': 'Finca A', 'usuario_id': 2},
          {'id': 2, 'nombre': 'Finca B', 'usuario_id': 3},
        ]);
      }
      return _json([]);
    });

void _sesion(int id, String rol) => SharedPreferences.setMockInitialValues({
      'token': 't',
      'usuario_id': id,
      'usuario_nombre': 'X',
      'usuario_rol': rol,
      'usuario_foto': '',
    });

Future<void> _escribir(WidgetTester tester, String etiqueta, String texto) async {
  final campo = find.widgetWithText(TextFormField, etiqueta);
  await tester.ensureVisible(campo);
  await tester.enterText(campo, texto);
}

Future<void> _elegir(WidgetTester tester, Finder dropdown, String opcion) async {
  await tester.ensureVisible(dropdown);
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(opcion).last);
  await tester.pumpAndSettle();
}

Future<void> _guardar(WidgetTester tester) async {
  final boton = find.widgetWithText(ElevatedButton, 'Guardar');
  await tester.ensureVisible(boton);
  await tester.tap(boton);
  await tester.pumpAndSettle();
}

void main() {
  test('Cultivo sin parcela es de toda la finca', () {
    final deFinca = Cultivo.fromJson(_cultivos[0]);
    expect(deFinca.esDeFinca, isTrue);
    expect(deFinca.ubicacion, 'Finca A / Toda la finca');
    final deParcela = Cultivo.fromJson(_cultivos[1]);
    expect(deParcela.esDeFinca, isFalse);
    expect(deParcela.fincaId, 1);
    expect(deParcela.ubicacion, 'Finca A / Lote 1');
  });

  testWidgets('Listado general: agrupado por finca, con la parcela o "Toda la finca"', (tester) async {
    _sesion(1, 'admin');
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: CultivosScreen()));
      await tester.pumpAndSettle();
    }, () => _backend([]));

    expect(find.text('Finca A · 2'), findsOneWidget);
    expect(find.text('Finca B · 1'), findsOneWidget);
    expect(find.text('Toda la finca'), findsOneWidget);
    expect(find.text('Lote 1'), findsOneWidget);
  });

  testWidgets('Detalle de finca: agrupado por ubicación', (tester) async {
    _sesion(2, 'agricultor');
    final finca = Finca(id: 1, nombre: 'Finca A', usuarioId: 2);
    await http.runWithClient(() async {
      await tester.pumpWidget(MaterialApp(home: CultivosScreen(finca: finca)));
      await tester.pumpAndSettle();
    }, () => _backend([]));

    expect(find.text('Cultivos · Finca A'), findsOneWidget);
    expect(find.text('Toda la finca · 1'), findsOneWidget);
    expect(find.text('Lote 1 · 1'), findsOneWidget);
    expect(find.text('Café'), findsNothing);
  });

  testWidgets('Dueño: desde la finca, el cultivo nuevo se guarda en toda la finca', (tester) async {
    _sesion(2, 'agricultor');
    final enviados = <Map<String, dynamic>>[];
    final backend = _backend(enviados);
    final finca = Finca(id: 1, nombre: 'Finca A', usuarioId: 2);
    await http.runWithClient(() async {
      await tester.pumpWidget(MaterialApp(home: CultivosScreen(finca: finca)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Nuevo cultivo'));
      await tester.pumpAndSettle();

      // finca propuesta y parcela opcional en "Toda la finca"
      expect(find.text('Parcela (opcional)'), findsOneWidget);
      await _escribir(tester, 'Tipo de cultivo', 'Ayote');
      await _escribir(tester, 'Cantidad', '5');
      await _guardar(tester);
    }, () => backend);

    expect(enviados, hasLength(1));
    expect(enviados.single['finca_id'], 1);
    expect(enviados.single['parcela_id'], isNull);
  });

  testWidgets('Dueño: al cambiar de finca solo se ofrecen las parcelas de esa finca', (tester) async {
    _sesion(1, 'admin');
    final enviados = <Map<String, dynamic>>[];
    final backend = _backend(enviados);
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: CultivosScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Nuevo cultivo'));
      await tester.pumpAndSettle();

      await _elegir(tester, find.widgetWithText(DropdownButtonFormField<int>, 'Finca'), 'Finca B');
      await _elegir(tester, find.widgetWithText(DropdownButtonFormField<int?>, 'Parcela (opcional)'), 'Lote B');
      // Lote 1 (finca A) solo aparece en la lista de fondo, no como opción
      expect(find.text('Lote 1'), findsOneWidget);
      await _escribir(tester, 'Tipo de cultivo', 'Café');
      await _escribir(tester, 'Cantidad', '7');
      await _guardar(tester);
    }, () => backend);

    expect(enviados.single['finca_id'], 2);
    expect(enviados.single['parcela_id'], 21);
  });

  testWidgets('Agrónomo: la parcela es obligatoria (no puede registrar en toda la finca)', (tester) async {
    _sesion(4, 'agronomo');
    final enviados = <Map<String, dynamic>>[];
    final backend = _backend(enviados);
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: CultivosScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Nuevo cultivo'));
      await tester.pumpAndSettle();

      await _elegir(tester, find.widgetWithText(DropdownButtonFormField<int>, 'Finca'), 'Finca A');
      // sin "Toda la finca": la parcela no es opcional
      expect(find.text('Parcela (opcional)'), findsNothing);
      await _escribir(tester, 'Tipo de cultivo', 'Chile');
      await _escribir(tester, 'Cantidad', '3');
      await _guardar(tester);
      expect(find.text('Elige una parcela'), findsWidgets);
      expect(enviados, isEmpty);

      await _elegir(tester, find.widgetWithText(DropdownButtonFormField<int?>, 'Parcela'), 'Lote 2');
      await _guardar(tester);
    }, () => backend);

    expect(enviados.single['finca_id'], 1);
    expect(enviados.single['parcela_id'], 12);
  });

  testWidgets('Página de la finca: resume sus cultivos y abre el inventario de la finca', (tester) async {
    _sesion(2, 'agricultor');
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: ParcelasScreen(fincaIdInicial: 1)));
      await tester.pumpAndSettle();
      expect(find.text('Cultivos de la finca'), findsOneWidget);
      expect(find.text('2 activos · 2 en total · 1 de toda la finca'), findsOneWidget);

      await tester.tap(find.text('Cultivos de la finca'));
      await tester.pumpAndSettle();
    }, () => _backend([]));

    expect(find.text('Cultivos · Finca A'), findsOneWidget);
    expect(find.text('Toda la finca · 1'), findsOneWidget);
  });
}
