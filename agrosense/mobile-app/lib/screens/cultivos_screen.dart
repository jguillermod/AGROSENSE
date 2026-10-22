import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';

/// Inventario de cultivos de una parcela: lista + formulario para crear y
/// editar. Se llega desde el detalle de la parcela, así que el agrónomo
/// solo entra a las de sus parcelas asignadas; además el usuario_id viaja
/// en cada petición y fincas-service rechaza cualquier otra.
class CultivosScreen extends StatefulWidget {
  final Parcela parcela;

  const CultivosScreen({super.key, required this.parcela});

  @override
  State<CultivosScreen> createState() => _CultivosScreenState();
}

Color colorEstadoCultivo(String estado) {
  switch (estado) {
    case 'sembrado':
      return Colors.teal;
    case 'en_crecimiento':
      return AppTheme.primaryGreen;
    default:
      return AppTheme.neutralText;
  }
}

class _CultivosScreenState extends State<CultivosScreen> {
  final _authService = AuthService();
  final _dataService = DataService();
  final _formatoFecha = DateFormat('dd/MM/yyyy');
  late Future<List<Cultivo>> _cultivosFuture;
  int? _usuarioId;

  @override
  void initState() {
    super.initState();
    _cultivosFuture = _cargar();
  }

  Future<List<Cultivo>> _cargar() async {
    _usuarioId ??= await _authService.getUsuarioId();
    return _dataService.getCultivosParcela(widget.parcela.id, usuarioId: _usuarioId!);
  }

  Future<void> _refrescar() async {
    setState(() => _cultivosFuture = _cargar());
    await _cultivosFuture;
  }

  Future<void> _abrirFormulario({Cultivo? cultivo}) async {
    final guardado = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CultivoForm(
        parcela: widget.parcela,
        cultivo: cultivo,
        usuarioId: _usuarioId!,
        dataService: _dataService,
      ),
    );
    if (guardado == true && mounted) {
      mostrarExito(context, cultivo == null ? 'Cultivo registrado' : 'Cultivo actualizado');
      await _refrescar();
    }
  }

  Future<void> _eliminar(Cultivo cultivo) async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Eliminar cultivo',
      mensaje: '¿Eliminar "${cultivo.tipo}${cultivo.variedad != null ? ' ${cultivo.variedad}' : ''}" del inventario?',
    );
    if (!confirmado) return;
    try {
      await _dataService.eliminarCultivo(cultivo.id, usuarioId: _usuarioId!);
      if (mounted) mostrarExito(context, 'Cultivo eliminado');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  String _textoCosecha(Cultivo c) {
    final fecha = c.fechaCosechaEstimada;
    if (fecha == null) return 'Sin fecha';
    final texto = _formatoFecha.format(fecha);
    if (c.estado == 'cosechado') return texto;
    final hoy = DateUtils.dateOnly(DateTime.now());
    final dias = DateUtils.dateOnly(fecha).difference(hoy).inDays;
    if (dias == 0) return '$texto (hoy)';
    if (dias > 0) return '$texto (en $dias ${dias == 1 ? 'día' : 'días'})';
    return '$texto (vencida)';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Cultivos · ${widget.parcela.nombre}', maxLines: 1, overflow: TextOverflow.ellipsis)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _abrirFormulario(),
        icon: const Icon(Icons.add),
        label: const Text('Nuevo cultivo'),
      ),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<List<Cultivo>>(
          future: _cultivosFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
            if (snapshot.hasError) {
              final error = snapshot.error.toString();
              return buildErrorState(error.contains('asignada') ? error : 'No se pudieron cargar los cultivos');
            }

            final cultivos = snapshot.data ?? [];
            if (cultivos.isEmpty) {
              return buildEmptyState('Esta parcela todavía no tiene cultivos.\nToca "Nuevo cultivo" para registrar uno.');
            }

            return ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 90),
              itemCount: cultivos.length,
              itemBuilder: (context, index) {
                final c = cultivos[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 4, 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.eco, color: AppTheme.primaryGreen),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    c.tipo,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                                  ),
                                  if (c.variedad != null && c.variedad!.isNotEmpty)
                                    Text(c.variedad!, style: const TextStyle(fontSize: 12, color: AppTheme.neutralText)),
                                ],
                              ),
                            ),
                            EstadoBadge(texto: c.estadoTexto, color: colorEstadoCultivo(c.estado)),
                            PopupMenuButton<String>(
                              onSelected: (value) {
                                if (value == 'editar') _abrirFormulario(cultivo: c);
                                if (value == 'eliminar') _eliminar(c);
                              },
                              itemBuilder: (context) => const [
                                PopupMenuItem(value: 'editar', child: Text('Editar')),
                                PopupMenuItem(value: 'eliminar', child: Text('Eliminar')),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        _dato('Siembra', _formatoFecha.format(c.fechaSiembra)),
                        _dato('Cosecha estimada', _textoCosecha(c)),
                        _dato('Cantidad', '${NumberFormat.decimalPattern('es').format(c.cantidad)} ${c.unidad}'),
                        if (c.notas != null && c.notas!.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6, right: 12),
                            child: Text(c.notas!, style: const TextStyle(fontSize: 13, color: AppTheme.neutralText)),
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
    );
  }

  Widget _dato(String etiqueta, String valor) {
    return Padding(
      padding: const EdgeInsets.only(top: 4, right: 12),
      child: Row(
        children: [
          SizedBox(
            width: 130,
            child: Text(etiqueta, style: const TextStyle(color: AppTheme.neutralText, fontSize: 13)),
          ),
          Expanded(child: Text(valor, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
        ],
      ),
    );
  }
}

/// Formulario (bottom sheet) para crear o editar un cultivo. Guarda él
/// mismo y devuelve true si se guardó, para poder mostrar el error de la
/// API sin cerrar el formulario ni perder lo escrito.
class _CultivoForm extends StatefulWidget {
  final Parcela parcela;
  final Cultivo? cultivo;
  final int usuarioId;
  final DataService dataService;

  const _CultivoForm({required this.parcela, this.cultivo, required this.usuarioId, required this.dataService});

  @override
  State<_CultivoForm> createState() => _CultivoFormState();
}

class _CultivoFormState extends State<_CultivoForm> {
  final _formKey = GlobalKey<FormState>();
  final _formatoFecha = DateFormat('dd/MM/yyyy');
  late final TextEditingController _tipo;
  late final TextEditingController _variedad;
  late final TextEditingController _cantidad;
  late final TextEditingController _notas;
  late DateTime _siembra;
  DateTime? _cosecha;
  late String _unidad;
  late String _estado;
  bool _guardando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final c = widget.cultivo;
    _tipo = TextEditingController(text: c?.tipo ?? '');
    _variedad = TextEditingController(text: c?.variedad ?? '');
    _cantidad = TextEditingController(text: c != null ? _sinCeros(c.cantidad) : '');
    _notas = TextEditingController(text: c?.notas ?? '');
    _siembra = c?.fechaSiembra ?? DateUtils.dateOnly(DateTime.now());
    _cosecha = c?.fechaCosechaEstimada;
    _unidad = c?.unidad ?? 'plantas';
    _estado = c?.estado ?? 'sembrado';
  }

  @override
  void dispose() {
    _tipo.dispose();
    _variedad.dispose();
    _cantidad.dispose();
    _notas.dispose();
    super.dispose();
  }

  String _sinCeros(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  Future<void> _elegirFecha({required bool esSiembra}) async {
    final inicial = esSiembra ? _siembra : (_cosecha ?? _siembra.add(const Duration(days: 90)));
    final elegida = await showDatePicker(
      context: context,
      initialDate: inicial.isBefore(esSiembra ? DateTime(2000) : _siembra) ? _siembra : inicial,
      firstDate: esSiembra ? DateTime(2000) : _siembra,
      lastDate: DateTime(2100),
      helpText: esSiembra ? 'Fecha de siembra' : 'Cosecha estimada',
    );
    if (elegida == null) return;
    setState(() {
      if (esSiembra) {
        _siembra = elegida;
        // si la cosecha quedó antes de la nueva siembra, se descarta
        if (_cosecha != null && _cosecha!.isBefore(_siembra)) _cosecha = null;
      } else {
        _cosecha = elegida;
      }
    });
  }

  Future<void> _guardar() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _guardando = true;
      _error = null;
    });
    try {
      await widget.dataService.guardarCultivo(
        id: widget.cultivo?.id,
        usuarioId: widget.usuarioId,
        parcelaId: widget.parcela.id,
        tipo: _tipo.text.trim(),
        variedad: _variedad.text.trim().isEmpty ? null : _variedad.text.trim(),
        fechaSiembra: _siembra,
        fechaCosechaEstimada: _cosecha,
        cantidad: double.parse(_cantidad.text.trim().replaceAll(',', '.')),
        unidad: _unidad,
        estado: _estado,
        notas: _notas.text.trim().isEmpty ? null : _notas.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() {
        _guardando = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.cultivo == null ? 'Nuevo cultivo' : 'Editar cultivo',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
              ),
              Text(widget.parcela.nombre, style: const TextStyle(fontSize: 12, color: AppTheme.neutralText)),
              const SizedBox(height: 16),
              if (_error != null) ErrorBanner(mensaje: _error!),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _tipo,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(labelText: 'Tipo de cultivo', hintText: 'Ej. Tomate'),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Ingresa el tipo' : null,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextFormField(
                      controller: _variedad,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(labelText: 'Variedad (opcional)', hintText: 'Ej. Roma'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _CampoFecha(
                      etiqueta: 'Fecha de siembra',
                      valor: _formatoFecha.format(_siembra),
                      onTap: () => _elegirFecha(esSiembra: true),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _CampoFecha(
                      etiqueta: 'Cosecha estimada',
                      valor: _cosecha != null ? _formatoFecha.format(_cosecha!) : 'Opcional',
                      onTap: () => _elegirFecha(esSiembra: false),
                      onLimpiar: _cosecha != null ? () => setState(() => _cosecha = null) : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _cantidad,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Cantidad'),
                      validator: (v) {
                        final n = double.tryParse((v ?? '').trim().replaceAll(',', '.'));
                        if (n == null) return 'Ingresa un número';
                        if (n <= 0) return 'Debe ser mayor que 0';
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _unidad,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Unidad'),
                      items: Cultivo.unidades
                          .map((u) => DropdownMenuItem(value: u, child: Text(u[0].toUpperCase() + u.substring(1))))
                          .toList(),
                      onChanged: (v) => setState(() => _unidad = v!),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _estado,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Estado'),
                items: Cultivo.estados.entries
                    .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                    .toList(),
                onChanged: (v) => setState(() => _estado = v!),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _notas,
                maxLines: 3,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Notas (opcional)', alignLabelWithHint: true),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _guardando ? null : _guardar,
                  child: _guardando
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(widget.cultivo == null ? 'Guardar' : 'Guardar cambios'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Campo de solo lectura que abre un selector de fecha al tocarlo, con el
/// mismo aspecto que los TextFormField del resto de formularios.
class _CampoFecha extends StatelessWidget {
  final String etiqueta;
  final String valor;
  final VoidCallback onTap;
  final VoidCallback? onLimpiar;

  const _CampoFecha({required this.etiqueta, required this.valor, required this.onTap, this.onLimpiar});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: etiqueta,
          suffixIcon: onLimpiar != null
              ? IconButton(icon: const Icon(Icons.close, size: 18), onPressed: onLimpiar, tooltip: 'Quitar fecha')
              : const Icon(Icons.calendar_today, size: 18),
        ),
        child: Text(valor, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}
