import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';
import 'parcela_detail_screen.dart';

class ParcelasScreen extends StatefulWidget {
  final int? fincaIdInicial;
  const ParcelasScreen({super.key, this.fincaIdInicial});

  @override
  State<ParcelasScreen> createState() => _ParcelasScreenState();
}

class _ParcelasScreenState extends State<ParcelasScreen> {
  final _dataService = DataService();

  List<Finca> _fincas = [];
  Finca? _fincaActiva;
  Future<List<Parcela>>? _parcelasFuture;
  bool _cargandoFincas = true;
  String? _errorFincas;

  @override
  void initState() {
    super.initState();
    _cargarFincas();
  }

  Future<void> _cargarFincas() async {
    setState(() {
      _cargandoFincas = true;
      _errorFincas = null;
    });
    try {
      final fincas = await _dataService.getFincas();
      Finca? activa;
      if (fincas.isNotEmpty) {
        activa = widget.fincaIdInicial != null
            ? fincas.firstWhere((f) => f.id == widget.fincaIdInicial, orElse: () => fincas.first)
            : fincas.first;
      }
      setState(() {
        _fincas = fincas;
        _fincaActiva = activa;
        _cargandoFincas = false;
        if (activa != null) _parcelasFuture = _dataService.getParcelas(activa.id);
      });
    } catch (e) {
      setState(() {
        _cargandoFincas = false;
        _errorFincas = 'No se pudieron cargar las fincas';
      });
    }
  }

  void _cambiarFinca(Finca finca) {
    setState(() {
      _fincaActiva = finca;
      _parcelasFuture = _dataService.getParcelas(finca.id);
    });
  }

  Future<void> _refrescarParcelas() async {
    if (_fincaActiva == null) return;
    setState(() => _parcelasFuture = _dataService.getParcelas(_fincaActiva!.id));
    await _parcelasFuture;
  }

  Future<void> _abrirFormulario({Parcela? parcela}) async {
    final nombreController = TextEditingController(text: parcela?.nombre ?? '');
    final minController = TextEditingController(text: parcela != null ? parcela.humedadMin.toString() : '30');
    final maxController = TextEditingController(text: parcela != null ? parcela.humedadMax.toString() : '85');
    final tempController = TextEditingController(text: parcela != null ? parcela.temperaturaMax.toString() : '38');
    final formKey = GlobalKey<FormState>();

    final guardar = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  parcela == null ? 'Nueva parcela' : 'Editar parcela',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                ),
                const SizedBox(height: 16),
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
        );
      },
    );

    if (guardar != true || !mounted) return;

    final humedadMin = double.tryParse(minController.text) ?? 30;
    final humedadMax = double.tryParse(maxController.text) ?? 85;
    final temperaturaMax = double.tryParse(tempController.text) ?? 38;

    try {
      if (parcela == null) {
        await _dataService.crearParcela(
          nombre: nombreController.text.trim(),
          fincaId: _fincaActiva!.id,
          humedadMin: humedadMin,
          humedadMax: humedadMax,
          temperaturaMax: temperaturaMax,
        );
        if (mounted) mostrarExito(context, 'Parcela creada');
      } else {
        await _dataService.editarParcela(
          parcela.id,
          nombre: nombreController.text.trim(),
          humedadMin: humedadMin,
          humedadMax: humedadMax,
          temperaturaMax: temperaturaMax,
        );
        if (mounted) mostrarExito(context, 'Parcela actualizada');
      }
      await _refrescarParcelas();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _eliminar(Parcela parcela) async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Eliminar parcela',
      mensaje: '¿Eliminar la parcela "${parcela.nombre}"?',
    );
    if (!confirmado) return;

    try {
      await _dataService.eliminarParcela(parcela.id);
      if (mounted) mostrarExito(context, 'Parcela eliminada');
      await _refrescarParcelas();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Parcelas')),
      floatingActionButton: _fincaActiva == null
          ? null
          : FloatingActionButton(
              onPressed: () => _abrirFormulario(),
              child: const Icon(Icons.add),
            ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_cargandoFincas) return buildLoading();
    if (_errorFincas != null) return buildErrorState(_errorFincas!);
    if (_fincas.isEmpty) return buildEmptyState('Todavía no hay fincas registradas');

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: DropdownButtonFormField<int>(
            initialValue: _fincaActiva?.id,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Finca'),
            items: _fincas
                .map((f) => DropdownMenuItem(
                      value: f.id,
                      child: Text(f.nombre, maxLines: 1, overflow: TextOverflow.ellipsis),
                    ))
                .toList(),
            onChanged: (id) {
              final finca = _fincas.firstWhere((f) => f.id == id);
              _cambiarFinca(finca);
            },
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _refrescarParcelas,
            child: FutureBuilder<List<Parcela>>(
              future: _parcelasFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
                if (snapshot.hasError) return buildErrorState('No se pudieron cargar las parcelas');

                final parcelas = snapshot.data ?? [];
                if (parcelas.isEmpty) return buildEmptyState('Esta finca no tiene parcelas todavía');

                return ListView.builder(
                  padding: const EdgeInsets.all(12),
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
                          '${parcela.humedadActual != null ? '${parcela.humedadActual!.round()}%' : '—'} · '
                          '${parcela.temperaturaActual != null ? '${parcela.temperaturaActual!.round()}°C' : '—'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => ParcelaDetailScreen(parcela: parcela)),
                          );
                        },
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            EstadoBadge(texto: parcela.estado ?? 'Sin datos', color: colorEstadoParcela(parcela.estado)),
                            PopupMenuButton<String>(
                              onSelected: (value) {
                                if (value == 'editar') _abrirFormulario(parcela: parcela);
                                if (value == 'eliminar') _eliminar(parcela);
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
                  },
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
