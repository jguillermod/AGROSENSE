import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';
import 'parcela_detail_screen.dart';

/// Pantalla del rol agrónomo: a diferencia de [ParcelasScreen] (que
/// navega finca por finca y está pensada para quien administra todo),
/// acá se listan -de un vistazo, sin importar la finca- las parcelas que
/// el admin le asignó al usuario en usuario_parcelas, más las que el
/// propio agrónomo vaya registrando (se auto-asignan al crearlas, para
/// que "la parcela que registra es la que puede ver" siga cumpliéndose).
///
/// También permite, desde el botón (+), registrar una finca/parcela
/// nueva y vincular un sensor -las únicas acciones de alta que tiene
/// este rol- sin acceso a las pantallas de gestión completas (Fincas,
/// Parcelas, Sensores) que sí ve el admin.
class MisParcelasScreen extends StatefulWidget {
  const MisParcelasScreen({super.key});

  @override
  State<MisParcelasScreen> createState() => _MisParcelasScreenState();
}

class _MisParcelasScreenState extends State<MisParcelasScreen> {
  final _authService = AuthService();
  final _dataService = DataService();
  late Future<List<Parcela>> _parcelasFuture;

  @override
  void initState() {
    super.initState();
    _parcelasFuture = _cargar();
  }

  Future<List<Parcela>> _cargar() async {
    final usuarioId = await _authService.getUsuarioId();
    if (usuarioId == null) return [];
    return _dataService.getParcelasAsignadas(usuarioId);
  }

  Future<void> _refrescar() async {
    setState(() => _parcelasFuture = _cargar());
    await _parcelasFuture;
  }

  /// Agrega [parcelaId] al conjunto de parcelas asignadas al usuario
  /// actual, conservando las que ya tenía (setAsignaciones reemplaza
  /// todo el conjunto, así que primero hay que traer las existentes).
  Future<void> _asignarmeParcela(int parcelaId) async {
    final usuarioId = await _authService.getUsuarioId();
    if (usuarioId == null) return;
    final actuales = await _dataService.getAsignacionesUsuario(usuarioId);
    final ids = {...actuales.map((a) => a.parcelaId), parcelaId};
    await _dataService.setAsignaciones(usuarioId, ids.toList());
  }

  Future<void> _mostrarMenuAcciones() async {
    final accion = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.home_work_outlined, color: AppTheme.primaryGreen),
              title: const Text('Registrar finca'),
              onTap: () => Navigator.of(context).pop('finca'),
            ),
            ListTile(
              leading: const Icon(Icons.grid_view_outlined, color: AppTheme.primaryGreen),
              title: const Text('Registrar parcela'),
              onTap: () => Navigator.of(context).pop('parcela'),
            ),
            ListTile(
              leading: const Icon(Icons.link, color: AppTheme.primaryGreen),
              title: const Text('Vincular sensor'),
              onTap: () => Navigator.of(context).pop('sensor'),
            ),
          ],
        ),
      ),
    );

    if (!mounted || accion == null) return;
    switch (accion) {
      case 'finca':
        await _registrarFinca();
        break;
      case 'parcela':
        await _registrarParcela();
        break;
      case 'sensor':
        await _vincularSensor();
        break;
    }
  }

  Future<void> _registrarFinca() async {
    final nombreController = TextEditingController();
    final ubicacionController = TextEditingController();
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
                  'Nueva finca',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: nombreController,
                  decoration: const InputDecoration(labelText: 'Nombre de la finca'),
                  validator: (v) => (v == null || v.isEmpty) ? 'Ingresa un nombre' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: ubicacionController,
                  decoration: const InputDecoration(labelText: 'Ubicación'),
                ),
                const SizedBox(height: 20),
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
      await _dataService.crearFinca(
        nombre: nombreController.text.trim(),
        ubicacion: ubicacionController.text.trim(),
        usuarioId: usuarioId!,
      );
      if (mounted) mostrarExito(context, 'Finca registrada');
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _registrarParcela() async {
    List<Finca> fincas;
    try {
      fincas = await _dataService.getFincas();
    } catch (e) {
      if (mounted) mostrarError(context, e);
      return;
    }
    if (!mounted) return;
    if (fincas.isEmpty) {
      mostrarError(context, 'Todavía no hay ninguna finca registrada. Registra una finca primero.');
      return;
    }

    final nombreController = TextEditingController();
    final minController = TextEditingController(text: '30');
    final maxController = TextEditingController(text: '85');
    final tempController = TextEditingController(text: '38');
    final formKey = GlobalKey<FormState>();
    int fincaSeleccionada = fincas.first.id;

    final guardar = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Nueva parcela',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<int>(
                        initialValue: fincaSeleccionada,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Finca'),
                        items: fincas
                            .map((f) => DropdownMenuItem(
                                  value: f.id,
                                  child: Text(f.nombre, maxLines: 1, overflow: TextOverflow.ellipsis),
                                ))
                            .toList(),
                        onChanged: (v) => setSheetState(() => fincaSeleccionada = v!),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: nombreController,
                        decoration: const InputDecoration(labelText: 'Nombre de la parcela'),
                        validator: (v) => (v == null || v.isEmpty) ? 'Ingresa un nombre' : null,
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: minController,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(labelText: 'Humedad mín. (%)'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              controller: maxController,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(labelText: 'Humedad máx. (%)'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: tempController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Temperatura máx. (°C)'),
                      ),
                      const SizedBox(height: 20),
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
              ),
            );
          },
        );
      },
    );

    if (guardar != true || !mounted) return;

    try {
      final nuevaId = await _dataService.crearParcela(
        nombre: nombreController.text.trim(),
        fincaId: fincaSeleccionada,
        humedadMin: double.tryParse(minController.text) ?? 30,
        humedadMax: double.tryParse(maxController.text) ?? 85,
        temperaturaMax: double.tryParse(tempController.text) ?? 38,
      );
      // Para que la pueda ver a partir de ahora, igual que si el admin
      // se la hubiera asignado.
      await _asignarmeParcela(nuevaId);
      if (mounted) mostrarExito(context, 'Parcela registrada');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _vincularSensor() async {
    final usuarioId = await _authService.getUsuarioId();
    if (usuarioId == null || !mounted) return;

    List<Parcela> misParcelas;
    try {
      misParcelas = await _dataService.getParcelasAsignadas(usuarioId);
    } catch (e) {
      if (mounted) mostrarError(context, e);
      return;
    }
    if (!mounted) return;
    if (misParcelas.isEmpty) {
      mostrarError(context, 'Todavía no tienes ninguna parcela para vincular un sensor');
      return;
    }

    int parcelaSeleccionada = misParcelas.first.id;

    final generar = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Vincular sensor'),
          content: DropdownButtonFormField<int>(
            initialValue: parcelaSeleccionada,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Parcela'),
            items: misParcelas
                .map((p) => DropdownMenuItem(
                      value: p.id,
                      child: Text(
                        '${p.fincaNombre ?? ''} · ${p.nombre}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
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
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mis parcelas')),
      floatingActionButton: FloatingActionButton(
        onPressed: _mostrarMenuAcciones,
        child: const Icon(Icons.add),
      ),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<List<Parcela>>(
          future: _parcelasFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
            if (snapshot.hasError) return buildErrorState('No se pudieron cargar tus parcelas');

            final parcelas = snapshot.data ?? [];
            if (parcelas.isEmpty) {
              return buildEmptyState(
                'Todavía no tienes parcelas asignadas.\nPuedes registrar una desde el botón (+) o pedirle al administrador que te asigne una.',
              );
            }

            return ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 90),
              itemCount: parcelas.length,
              itemBuilder: (context, index) {
                final parcela = parcelas[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    leading: const Icon(Icons.grid_view_outlined, color: AppTheme.primaryGreen),
                    title: Text(
                      parcela.nombre,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      '${parcela.fincaNombre ?? ''} · '
                      '${parcela.humedadActual != null ? '${parcela.humedadActual!.round()}%' : '—'} · '
                      '${parcela.temperaturaActual != null ? '${parcela.temperaturaActual!.round()}°C' : '—'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: EstadoBadge(texto: parcela.estado ?? 'Sin datos', color: colorEstadoParcela(parcela.estado)),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => ParcelaDetailScreen(parcela: parcela)),
                      );
                    },
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
