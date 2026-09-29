import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';

class SensoresScreen extends StatefulWidget {
  const SensoresScreen({super.key});

  @override
  State<SensoresScreen> createState() => _SensoresScreenState();
}

class _SensoresScreenState extends State<SensoresScreen> {
  final _dataService = DataService();
  final _authService = AuthService();

  Future<List<Estacion>>? _estacionesFuture;
  Future<List<SensorToken>>? _tokensFuture;
  bool _esAdmin = false;
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final rol = await _authService.getUsuarioRol();
    setState(() {
      _esAdmin = rol == 'admin';
      _estacionesFuture = _dataService.getEstacionesFlat();
      if (_esAdmin) _tokensFuture = _dataService.getTokensSensor();
      _cargando = false;
    });
  }

  Future<void> _refrescar() async {
    setState(() {
      _estacionesFuture = _dataService.getEstacionesFlat();
      if (_esAdmin) _tokensFuture = _dataService.getTokensSensor();
    });
    await Future.wait([
      _estacionesFuture!,
      if (_esAdmin) _tokensFuture!,
    ]);
  }

  String _estadoSensor(DateTime? ultimaLectura) {
    if (ultimaLectura == null) return 'Sin datos';
    final minutos = DateTime.now().difference(ultimaLectura).inMinutes;
    return minutos <= 15 ? 'En línea' : 'Sin señal';
  }

  Color _colorEstadoSensor(String estado) {
    switch (estado) {
      case 'En línea':
        return AppTheme.primaryGreen;
      case 'Sin señal':
        return AppTheme.warning;
      default:
        return AppTheme.neutralText;
    }
  }

  Future<void> _vincularSensor() async {
    List<ParcelaResumen> parcelas;
    try {
      parcelas = await _dataService.getParcelasFlat();
    } catch (e) {
      if (mounted) mostrarError(context, e);
      return;
    }
    if (!mounted) return;
    if (parcelas.isEmpty) {
      mostrarError(context, 'No hay parcelas registradas todavía');
      return;
    }

    int parcelaSeleccionada = parcelas.first.id;

    final generar = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Vincular sensor'),
          content: DropdownButtonFormField<int>(
            initialValue: parcelaSeleccionada,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Parcela'),
            items: parcelas
                .map((p) => DropdownMenuItem(
                      value: p.id,
                      child: Text('${p.fincaNombre} · ${p.nombre}', maxLines: 1, overflow: TextOverflow.ellipsis),
                    ))
                .toList(),
            onChanged: (v) => setDialogState(() => parcelaSeleccionada = v!),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancelar')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Generar token')),
          ],
        ),
      ),
    );

    if (generar != true || !mounted) return;

    try {
      final token = await _dataService.generarTokenSensor(parcelaSeleccionada);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Token generado'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Válido por 30 minutos y de un solo uso.'),
              const SizedBox(height: 12),
              SelectableText(
                token.token,
                style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'monospace'),
              ),
              const SizedBox(height: 12),
              const Text(
                'El sensor debe hacer POST /api/estaciones/vincular con { token, codigo }. '
                'La respuesta trae un api_key que debe guardar y enviar en cada lectura.',
                style: TextStyle(fontSize: 12, color: AppTheme.neutralText),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cerrar')),
          ],
        ),
      );
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _revocarToken(SensorToken token) async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Revocar token',
      mensaje: '¿Revocar el token de ${token.fincaNombre} · ${token.parcelaNombre}?',
      textoConfirmar: 'Revocar',
    );
    if (!confirmado) return;
    try {
      await _dataService.revocarTokenSensor(token.id);
      if (mounted) mostrarExito(context, 'Token revocado');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _editarSensor(Estacion estacion) async {
    final controller = TextEditingController(text: estacion.codigo);
    final formKey = GlobalKey<FormState>();

    final guardar = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Editar sensor'),
        content: Form(
          key: formKey,
          child: TextFormField(
            controller: controller,
            decoration: const InputDecoration(labelText: 'Código del sensor'),
            validator: (v) => (v == null || v.isEmpty) ? 'Ingresa un código' : null,
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancelar')),
          ElevatedButton(
            onPressed: () {
              if (formKey.currentState!.validate()) Navigator.of(context).pop(true);
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );

    if (guardar != true || !mounted) return;
    try {
      await _dataService.editarEstacion(estacion.id, codigo: controller.text.trim());
      if (mounted) mostrarExito(context, 'Sensor actualizado');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _eliminarSensor(Estacion estacion) async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Eliminar sensor',
      mensaje: '¿Eliminar el sensor "${estacion.codigo}"? Se borrará también su historial de lecturas.',
    );
    if (!confirmado) return;
    try {
      await _dataService.eliminarEstacion(estacion.id);
      if (mounted) mostrarExito(context, 'Sensor eliminado');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sensores')),
      floatingActionButton: !_esAdmin
          ? null
          : FloatingActionButton.extended(
              onPressed: _vincularSensor,
              icon: const Icon(Icons.link),
              label: const Text('Vincular sensor'),
            ),
      body: _cargando
          ? buildLoading()
          : RefreshIndicator(
              onRefresh: _refrescar,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  FutureBuilder<List<Estacion>>(
                    future: _estacionesFuture,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
                      }
                      if (snapshot.hasError) {
                        return const Padding(padding: EdgeInsets.all(24), child: Text('No se pudieron cargar los sensores'));
                      }
                      final estaciones = snapshot.data ?? [];
                      if (estaciones.isEmpty) {
                        return const Padding(padding: EdgeInsets.all(24), child: Text('Todavía no hay estaciones vinculadas'));
                      }
                      return Column(
                        children: estaciones.map((e) {
                          final estado = _estadoSensor(e.ultimaLectura);
                          return Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              leading: const Icon(Icons.sensors, color: AppTheme.primaryGreen),
                              title: Text(
                                e.codigo,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                              subtitle: Text(
                                '${e.fincaNombre ?? ''} · ${e.parcelaNombre ?? ''}\n'
                                '${e.humedadSuelo != null ? '${e.humedadSuelo!.round()}%' : '—'} · '
                                '${e.temperatura != null ? '${e.temperatura!.round()}°C' : '—'}',
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                              ),
                              isThreeLine: true,
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  EstadoBadge(texto: estado, color: _colorEstadoSensor(estado)),
                                  if (_esAdmin)
                                    PopupMenuButton<String>(
                                      onSelected: (v) {
                                        if (v == 'editar') _editarSensor(e);
                                        if (v == 'eliminar') _eliminarSensor(e);
                                      },
                                      itemBuilder: (context) => const [
                                        PopupMenuItem(value: 'editar', child: Text('Editar')),
                                        PopupMenuItem(value: 'eliminar', child: Text('Eliminar')),
                                      ],
                                    ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      );
                    },
                  ),
                  if (_esAdmin) ...[
                    const Padding(
                      padding: EdgeInsets.fromLTRB(4, 16, 4, 8),
                      child: Text('Tokens de vinculación', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
                    ),
                    FutureBuilder<List<SensorToken>>(
                      future: _tokensFuture,
                      builder: (context, snapshot) {
                        if (snapshot.connectionState == ConnectionState.waiting) {
                          return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
                        }
                        if (snapshot.hasError) {
                          return const Padding(padding: EdgeInsets.all(24), child: Text('No se pudieron cargar los tokens'));
                        }
                        final tokens = snapshot.data ?? [];
                        if (tokens.isEmpty) {
                          return const Padding(padding: EdgeInsets.all(16), child: Text('No se han generado tokens todavía', style: TextStyle(color: AppTheme.neutralText)));
                        }
                        return Column(
                          children: tokens.map((t) {
                            final badgeColor = switch (t.estado) {
                              'pendiente' => AppTheme.warning,
                              'usado' => AppTheme.primaryGreen,
                              _ => AppTheme.neutralText,
                            };
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: ListTile(
                                title: Text(
                                  '${t.fincaNombre} · ${t.parcelaNombre}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(
                                  '${t.token.substring(0, 8)}… · expira ${DateFormat('dd/MM HH:mm').format(t.expiraEn)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    EstadoBadge(texto: t.estado, color: badgeColor),
                                    if (t.estado == 'pendiente')
                                      IconButton(
                                        icon: const Icon(Icons.close, color: AppTheme.danger),
                                        onPressed: () => _revocarToken(t),
                                      ),
                                  ],
                                ),
                              ),
                            );
                          }).toList(),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}
