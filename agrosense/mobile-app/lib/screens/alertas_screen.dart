import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';

/// Alertas de sensores y de clima, con filtros por severidad y estado y el
/// botón "Atender". El agrónomo solo recibe las de sus parcelas asignadas
/// (lecturas-service filtra por usuario_id y valida al atender).
class AlertasScreen extends StatefulWidget {
  const AlertasScreen({super.key});

  @override
  State<AlertasScreen> createState() => _AlertasScreenState();
}

class _AlertasScreenState extends State<AlertasScreen> {
  final _authService = AuthService();
  final _dataService = DataService();
  final _formato = DateFormat('d MMM, HH:mm');

  String? _severidad;
  String _estado = 'vigentes';
  late Future<List<Alerta>> _future;
  int? _usuarioId;
  final Set<int> _atendiendo = {};

  static const _estados = {
    'vigentes': 'Vigentes',
    'activa': 'Activas',
    'atendida': 'Atendidas',
    'resuelta': 'Resueltas',
  };

  @override
  void initState() {
    super.initState();
    _future = _cargar();
  }

  Future<List<Alerta>> _cargar() async {
    _usuarioId ??= await _authService.getUsuarioId();
    return _dataService.getAlertasFiltradas(usuarioId: _usuarioId!, severidad: _severidad, estado: _estado);
  }

  Future<void> _refrescar() async {
    setState(() {
      _future = _cargar();
    });
    await _future;
  }

  Future<void> _atender(Alerta alerta) async {
    setState(() => _atendiendo.add(alerta.id));
    try {
      await _dataService.atenderAlerta(alerta.id, usuarioId: _usuarioId!);
      if (mounted) mostrarExito(context, 'Alerta marcada como atendida');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    } finally {
      if (mounted) setState(() => _atendiendo.remove(alerta.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Alertas')),
      body: Column(
        children: [
          _buildFiltros(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refrescar,
              child: FutureBuilder<List<Alerta>>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
                  if (snapshot.hasError) return buildErrorState('No se pudieron cargar las alertas');
                  final alertas = snapshot.data ?? [];
                  if (alertas.isEmpty) {
                    return buildEmptyState(_estado == 'vigentes' && _severidad == null
                        ? 'No hay alertas vigentes. Todo en orden.'
                        : 'No hay alertas con estos filtros.');
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 20),
                    itemCount: alertas.length,
                    itemBuilder: (context, i) => _buildAlerta(alertas[i]),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFiltros() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final entrada in {null: 'Todas', ...Alerta.severidades}.entries)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(entrada.value),
                      selected: _severidad == entrada.key,
                      avatar: entrada.key == null
                          ? null
                          : Icon(Icons.circle, size: 12, color: colorSeveridad(entrada.key!)),
                      onSelected: (_) => setState(() {
                        _severidad = entrada.key;
                        _future = _cargar();
                      }),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              showSelectedIcon: false,
              segments: _estados.entries
                  .map((e) => ButtonSegment(value: e.key, label: Text(e.value, style: const TextStyle(fontSize: 12))))
                  .toList(),
              selected: {_estado},
              onSelectionChanged: (s) => setState(() {
                _estado = s.first;
                _future = _cargar();
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAlerta(Alerta a) {
    final color = colorSeveridad(a.severidad);
    final apagada = a.estado == 'resuelta';
    return Opacity(
      opacity: apagada ? 0.65 : 1,
      child: Card(
        margin: const EdgeInsets.only(bottom: 10),
        clipBehavior: Clip.antiAlias,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(width: 5, color: color),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(a.esClimatica ? Icons.cloud_outlined : Icons.sensors, size: 18, color: color),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(a.tipo, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                          ),
                          EstadoBadge(texto: a.severidadTexto, color: color),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${a.parcelaNombre ?? 'Parcela'}${a.fincaNombre != null ? ' · ${a.fincaNombre}' : ''}',
                        style: const TextStyle(fontSize: 13),
                      ),
                      if (a.detalle != null && a.detalle!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(a.detalle!, style: const TextStyle(fontSize: 12, color: AppTheme.neutralText)),
                        ),
                      const SizedBox(height: 6),
                      Text(
                        'Desde ${_formato.format(a.fecha)}'
                        '${a.ultimaLecturaEn != null ? ' · última vez ${_formato.format(a.ultimaLecturaEn!)}' : ''}'
                        '${a.repeticiones > 1 ? ' · ${a.repeticiones} veces' : ''}',
                        style: const TextStyle(fontSize: 11, color: AppTheme.neutralText),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          EstadoBadge(texto: a.estadoTexto, color: colorEstadoAlerta(a.estado)),
                          if (a.estado == 'atendida' && a.atendidaPorNombre != null)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: Text('por ${a.atendidaPorNombre}', style: const TextStyle(fontSize: 12)),
                            ),
                          const Spacer(),
                          if (a.estado == 'activa')
                            OutlinedButton.icon(
                              onPressed: _atendiendo.contains(a.id) ? null : () => _atender(a),
                              icon: const Icon(Icons.check_circle_outline, size: 18),
                              label: const Text('Atender'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.primaryGreen,
                                visualDensity: VisualDensity.compact,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
