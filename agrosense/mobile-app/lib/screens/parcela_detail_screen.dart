import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';
import 'historial_screen.dart';

class ParcelaDetailScreen extends StatefulWidget {
  final Parcela parcela;

  const ParcelaDetailScreen({super.key, required this.parcela});

  @override
  State<ParcelaDetailScreen> createState() => _ParcelaDetailScreenState();
}

class _ParcelaDetailScreenState extends State<ParcelaDetailScreen> {
  final _authService = AuthService();
  final _dataService = DataService();
  late Future<List<Alerta>> _alertasFuture;
  late Future<List<Estacion>> _estacionesFuture;
  late Future<List<RegistroManual>> _registrosFuture;

  @override
  void initState() {
    super.initState();
    _alertasFuture = _dataService.getAlertas(widget.parcela.id);
    _estacionesFuture = _dataService.getEstaciones(widget.parcela.id);
    _registrosFuture = _dataService.getRegistros(widget.parcela.id);
  }

  Future<void> _agregarRegistro() async {
    final parcela = widget.parcela;
    final humedadController = TextEditingController();
    final temperaturaController = TextEditingController();
    final anotacionesController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final guardar = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(context).viewInsets.bottom + 20,
          ),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Nuevo registro de campo',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Completa al menos un valor o una anotación.',
                  style: TextStyle(fontSize: 12, color: AppTheme.neutralText),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: humedadController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Humedad (%)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextFormField(
                        controller: temperaturaController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Temperatura (°C)'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: anotacionesController,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Anotaciones', alignLabelWithHint: true),
                ),
                const SizedBox(height: 8),
                FormField<bool>(
                  validator: (_) {
                    final sinValores = humedadController.text.trim().isEmpty && temperaturaController.text.trim().isEmpty;
                    final sinAnotacion = anotacionesController.text.trim().isEmpty;
                    if (sinValores && sinAnotacion) return 'Ingresa al menos un dato';
                    return null;
                  },
                  builder: (state) => state.hasError
                      ? Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(state.errorText!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                        )
                      : const SizedBox.shrink(),
                ),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () {
                      if (formKey.currentState!.validate()) Navigator.of(context).pop(true);
                    },
                    child: const Text('Guardar'),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );

    if (guardar != true || !mounted) return;

    try {
      final usuarioId = await _authService.getUsuarioId();
      await _dataService.crearRegistro(
        parcelaId: parcela.id,
        usuarioId: usuarioId!,
        humedadSuelo: double.tryParse(humedadController.text.trim()),
        temperatura: double.tryParse(temperaturaController.text.trim()),
        anotaciones: anotacionesController.text.trim().isEmpty ? null : anotacionesController.text.trim(),
      );
      if (mounted) mostrarExito(context, 'Registro guardado');
      setState(() => _registrosFuture = _dataService.getRegistros(parcela.id));
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final parcela = widget.parcela;

    return Scaffold(
      appBar: AppBar(title: Text(parcela.nombre, maxLines: 1, overflow: TextOverflow.ellipsis)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _agregarRegistro,
        icon: const Icon(Icons.edit_note),
        label: const Text('Registrar'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() {
            _alertasFuture = _dataService.getAlertas(parcela.id);
            _estacionesFuture = _dataService.getEstaciones(parcela.id);
            _registrosFuture = _dataService.getRegistros(parcela.id);
          });
          await Future.wait([_alertasFuture, _estacionesFuture, _registrosFuture]);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
          children: [
            _buildResumenCard(parcela),
            const SizedBox(height: 20),
            _buildUmbralesCard(parcela),
            const SizedBox(height: 20),
            const Text('Alertas activas', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
            const SizedBox(height: 8),
            _buildAlertasList(),
            const SizedBox(height: 20),
            const Text('Sensores', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
            const SizedBox(height: 8),
            _buildEstacionesList(),
            const SizedBox(height: 20),
            const Text('Registros de campo', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
            const SizedBox(height: 8),
            _buildRegistrosList(),
          ],
        ),
      ),
    );
  }

  Widget _buildResumenCard(Parcela parcela) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: _statTile(
                icon: Icons.water_drop,
                color: Colors.teal,
                label: 'Humedad',
                value: parcela.humedadActual != null ? '${parcela.humedadActual!.round()}%' : '—',
              ),
            ),
            Expanded(
              child: _statTile(
                icon: Icons.thermostat,
                color: AppTheme.danger,
                label: 'Temperatura',
                value: parcela.temperaturaActual != null ? '${parcela.temperaturaActual!.round()}°C' : '—',
              ),
            ),
            Expanded(
              child: Center(
                child: EstadoBadge(
                  texto: parcela.estado ?? 'Sin datos',
                  color: colorEstadoParcela(parcela.estado),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statTile({required IconData icon, required Color color, required String label, required String value}) {
    return Column(
      children: [
        Icon(icon, color: color),
        const SizedBox(height: 4),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 12, color: AppTheme.neutralText),
        ),
      ],
    );
  }

  Widget _buildUmbralesCard(Parcela parcela) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Umbrales configurados', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 10),
            _umbralRow('Humedad mínima', '${parcela.humedadMin.round()}%'),
            _umbralRow('Humedad máxima', '${parcela.humedadMax.round()}%'),
            _umbralRow('Temperatura máxima', '${parcela.temperaturaMax.round()}°C'),
          ],
        ),
      ),
    );
  }

  Widget _umbralRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.neutralText)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _buildAlertasList() {
    return FutureBuilder<List<Alerta>>(
      future: _alertasFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return const Text('No se pudieron cargar las alertas', style: TextStyle(color: AppTheme.neutralText));
        }
        final alertas = snapshot.data ?? [];
        if (alertas.isEmpty) {
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: const [
                  Icon(Icons.check_circle, color: AppTheme.primaryGreen),
                  SizedBox(width: 10),
                  Text('Sin alertas activas'),
                ],
              ),
            ),
          );
        }
        return Card(
          child: Column(
            children: alertas.map((alerta) {
              return ListTile(
                leading: const Icon(Icons.warning_amber_rounded, color: AppTheme.warning),
                title: Text(alerta.tipo),
                subtitle: Text(DateFormat('dd/MM/yyyy HH:mm').format(alerta.fecha)),
              );
            }).toList(),
          ),
        );
      },
    );
  }

  Widget _buildEstacionesList() {
    return FutureBuilder<List<Estacion>>(
      future: _estacionesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return const Text('No se pudieron cargar los sensores', style: TextStyle(color: AppTheme.neutralText));
        }
        final estaciones = snapshot.data ?? [];
        if (estaciones.isEmpty) {
          return const Text('Esta parcela no tiene sensores vinculados', style: TextStyle(color: AppTheme.neutralText));
        }
        return Card(
          child: Column(
            children: estaciones.map((estacion) {
              return ListTile(
                leading: const Icon(Icons.sensors, color: AppTheme.primaryGreen),
                title: Text(estacion.codigo),
                subtitle: const Text('Ver historial de lecturas'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => HistorialScreen(estacion: estacion),
                    ),
                  );
                },
              );
            }).toList(),
          ),
        );
      },
    );
  }

  Widget _buildRegistrosList() {
    return FutureBuilder<List<RegistroManual>>(
      future: _registrosFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return const Text('No se pudieron cargar los registros', style: TextStyle(color: AppTheme.neutralText));
        }
        final registros = snapshot.data ?? [];
        if (registros.isEmpty) {
          return const Text(
            'Todavía no hay registros de campo para esta parcela.',
            style: TextStyle(color: AppTheme.neutralText),
          );
        }
        return Card(
          child: Column(
            children: registros.map((registro) {
              final valores = [
                if (registro.humedadSuelo != null) '${registro.humedadSuelo!.round()}% humedad',
                if (registro.temperatura != null) '${registro.temperatura!.round()}°C',
              ].join(' · ');
              return ListTile(
                leading: const Icon(Icons.edit_note, color: AppTheme.primaryGreen),
                title: Text(
                  valores.isNotEmpty ? valores : 'Anotación',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  [
                    if (registro.anotaciones != null && registro.anotaciones!.isNotEmpty) registro.anotaciones!,
                    '${registro.usuarioNombre ?? 'Usuario'} · ${DateFormat('dd/MM/yyyy HH:mm').format(registro.fecha)}',
                  ].join('\n'),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                isThreeLine: registro.anotaciones != null && registro.anotaciones!.isNotEmpty,
              );
            }).toList(),
          ),
        );
      },
    );
  }
}
