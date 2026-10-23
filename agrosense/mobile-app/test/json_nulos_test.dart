// Los modelos aguantan campos que faltan, vienen null o con otro tipo
// (antes: "type 'Null' is not a subtype of type 'String' in type cast").

import 'package:flutter_test/flutter_test.dart';

import 'package:agrosense_app/models/json.dart';
import 'package:agrosense_app/models/models.dart';
import 'package:agrosense_app/services/api_exception.dart';

void main() {
  group('SensorToken', () {
    test('la respuesta corta del POST (sin estado, finca ni parcela) no truena', () {
      final expira = DateTime.now().toUtc().add(const Duration(minutes: 30));
      final t = SensorToken.fromJson({
        'id': 7,
        'token': 'abcdef0123456789abcdef0123456789',
        'parcela_id': 3,
        'expira_en': expira.toIso8601String(),
      });
      expect(t.estado, 'pendiente');
      expect(t.estadoTexto, 'vigente');
      expect(t.vigente, isTrue);
      expect(t.ubicacion, 'Parcela #3');
      expect(t.tokenCorto, 'abcdef01…');
      // llega en UTC y se muestra en la hora del teléfono
      expect(t.expiraEn!.isUtc, isFalse);
    });

    test('todo null: valores por defecto', () {
      final t = SensorToken.fromJson({
        'id': null,
        'token': null,
        'estado': null,
        'creado_en': null,
        'expira_en': null,
        'parcela_nombre': null,
        'finca_nombre': null,
      });
      expect(t.id, 0);
      expect(t.token, '');
      expect(t.tokenCorto, '');
      expect(t.expiraEn, isNull);
      expect(t.ubicacion, 'Parcela sin nombre');
    });

    test('finca y parcela, con o sin una de las dos', () {
      expect(SensorToken.fromJson({'finca_nombre': 'Finca Norte', 'parcela_nombre': 'Lote 1'}).ubicacion,
          'Finca Norte · Lote 1');
      expect(SensorToken.fromJson({'finca_nombre': null, 'parcela_nombre': 'Lote 1'}).ubicacion, 'Lote 1');
    });

    test('estado: vigente, expirado (aunque la base diga pendiente) y usado', () {
      final pasado = DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String();
      expect(SensorToken.fromJson({'estado': 'pendiente', 'expira_en': pasado}).estadoTexto, 'expirado');
      expect(SensorToken.fromJson({'estado': 'expirado'}).estadoTexto, 'expirado');
      expect(SensorToken.fromJson({'estado': 'usado', 'expira_en': pasado}).estadoTexto, 'usado');
      expect(SensorToken.fromJson({'estado': 'pendiente', 'expira_en': pasado}).vigente, isFalse);
    });
  });

  test('un objeto vacío no tumba ningún modelo', () {
    final vacio = <String, dynamic>{};
    expect(() => Finca.fromJson(vacio), returnsNormally);
    expect(() => Parcela.fromJson(vacio), returnsNormally);
    expect(() => Estacion.fromJson(vacio), returnsNormally);
    expect(() => Lectura.fromJson(vacio), returnsNormally);
    expect(() => Alerta.fromJson(vacio), returnsNormally);
    expect(() => AlertasConteo.fromJson(vacio), returnsNormally);
    expect(() => ClimaHora.fromJson(vacio), returnsNormally);
    expect(() => ClimaEvento.fromJson(vacio), returnsNormally);
    expect(() => RegistroManual.fromJson(vacio), returnsNormally);
    expect(() => Usuario.fromJson(vacio), returnsNormally);
    expect(() => ParcelaResumen.fromJson(vacio), returnsNormally);
    expect(() => Asignacion.fromJson(vacio), returnsNormally);
    expect(() => DashboardResumen.fromJson(vacio), returnsNormally);
    expect(() => Cultivo.fromJson(vacio), returnsNormally);
    expect(() => RiegoEvento.fromJson(vacio), returnsNormally);
    expect(() => RiegoProgramacion.fromJson(vacio), returnsNormally);
    expect(() => RiegoResumen.fromJson(vacio), returnsNormally);
    expect(() => HistorialPunto.fromJson(vacio), returnsNormally);
  });

  test('números como texto (DECIMAL de MariaDB) y booleanos 0/1', () {
    final p = Parcela.fromJson({
      'id': '4',
      'nombre': 'Lote 4',
      'finca_id': 2,
      'humedad_min': '35.50',
      'humedad_max': null,
      'riego_automatico': 1,
    });
    expect(p.id, 4);
    expect(p.humedadMin, 35.5);
    expect(p.humedadMax, 85); // por defecto
    expect(p.riegoAutomatico, isTrue);

    final r = RiegoProgramacion.fromJson({'id': 1, 'dias_semana': null, 'duracion_minutos': '15', 'activa': 0});
    expect(r.dias, isEmpty);
    expect(r.duracionMinutos, 15);
    expect(r.activa, isFalse);
  });

  test('listas y objetos anidados que faltan o vienen con otro tipo', () {
    final riego = RiegoResumen.fromJson({'riego_en_curso': null, 'programaciones': null, 'ultimos_riegos': 'x'});
    expect(riego.riegoEnCurso, isNull);
    expect(riego.programaciones, isEmpty);
    expect(riego.ultimosRiegos, isEmpty);
    expect(jsonLista([{'id': 1}, null, 'texto', 3]), hasLength(1));
    expect(AlertasConteo.fromJson({'por_severidad': null, 'activas': '2'}).activas, 2);
  });

  test('clima: sin "ahora" es un error (el dashboard muestra "Sin datos de clima")', () {
    expect(() => Clima.fromJson({'pronostico': []}), throwsFormatException);
    final c = Clima.fromJson({
      'finca': null,
      'ahora': {'temperatura': '21.5', 'condicion': null, 'evento': {'tipo': 'lluvia'}},
      'pronostico': null,
    });
    expect(c.fincaNombre, isNull);
    expect(c.ahora.temperatura, 21.5);
    expect(c.ahora.condicion, '');
    expect(c.ahora.evento, 'lluvia');
    expect(c.pronostico, isEmpty);
  });

  test('id de un recurso creado: si no viene, error legible', () {
    expect(ApiException.idCreado('{"id": 12}'), 12);
    expect(ApiException.idCreado('{"id": "12"}'), 12);
    expect(() => ApiException.idCreado('{"id": null}'), throwsA(isA<ApiException>()));
    expect(() => ApiException.idCreado('<html>'), throwsA(isA<ApiException>()));
  });
}
