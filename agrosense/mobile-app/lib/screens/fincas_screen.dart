import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';
import 'parcelas_screen.dart';

class FincasScreen extends StatefulWidget {
  const FincasScreen({super.key});

  @override
  State<FincasScreen> createState() => _FincasScreenState();
}

class _FincasScreenState extends State<FincasScreen> {
  final _dataService = DataService();
  final _authService = AuthService();
  late Future<List<Finca>> _fincasFuture;

  @override
  void initState() {
    super.initState();
    _fincasFuture = _dataService.getFincas();
  }

  Future<void> _refrescar() async {
    setState(() => _fincasFuture = _dataService.getFincas());
    await _fincasFuture;
  }

  Future<void> _abrirFormulario({Finca? finca}) async {
    final nombreController = TextEditingController(text: finca?.nombre ?? '');
    final ubicacionController = TextEditingController(text: finca?.ubicacion ?? '');
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
                Text(
                  finca == null ? 'Nueva finca' : 'Editar finca',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
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
      if (finca == null) {
        final usuarioId = await _authService.getUsuarioId();
        await _dataService.crearFinca(
          nombre: nombreController.text.trim(),
          ubicacion: ubicacionController.text.trim(),
          usuarioId: usuarioId!,
        );
        if (mounted) mostrarExito(context, 'Finca creada');
      } else {
        await _dataService.editarFinca(finca.id, nombre: nombreController.text.trim(), ubicacion: ubicacionController.text.trim());
        if (mounted) mostrarExito(context, 'Finca actualizada');
      }
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _eliminar(Finca finca) async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Eliminar finca',
      mensaje: '¿Eliminar la finca "${finca.nombre}"?',
    );
    if (!confirmado) return;

    try {
      await _dataService.eliminarFinca(finca.id);
      if (mounted) mostrarExito(context, 'Finca eliminada');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fincas')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _abrirFormulario(),
        child: const Icon(Icons.add),
      ),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<List<Finca>>(
          future: _fincasFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
            if (snapshot.hasError) return buildErrorState('No se pudieron cargar las fincas');

            final fincas = snapshot.data ?? [];
            if (fincas.isEmpty) return buildEmptyState('Todavía no hay fincas registradas');

            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: fincas.length,
              itemBuilder: (context, index) {
                final finca = fincas[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    leading: const Icon(Icons.home_work_outlined, color: AppTheme.primaryGreen),
                    title: Text(
                      finca.nombre,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      finca.ubicacion?.isNotEmpty == true ? finca.ubicacion! : 'Sin ubicación',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => ParcelasScreen(fincaIdInicial: finca.id)),
                      );
                    },
                    trailing: PopupMenuButton<String>(
                      onSelected: (value) {
                        if (value == 'editar') _abrirFormulario(finca: finca);
                        if (value == 'eliminar') _eliminar(finca);
                      },
                      itemBuilder: (context) => const [
                        PopupMenuItem(value: 'editar', child: Text('Editar')),
                        PopupMenuItem(value: 'eliminar', child: Text('Eliminar')),
                      ],
                    ),
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
