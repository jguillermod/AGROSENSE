import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import 'common.dart';

const _azulRiego = Color(0xFF1565C0);

/// Sección de riego del detalle de parcela: estado actual (regando / en
/// espera), "Regar ahora" / "Detener", interruptor de riego automático,
/// próximas programaciones y últimos riegos. Se refresca sola cada 10 s,
/// porque con el reloj simulado un riego dura pocos segundos reales.
///
/// El agrónomo solo llega aquí desde sus parcelas asignadas y, además, el
/// usuario_id viaja en cada petición: fincas-service rechaza las demás.
class RiegoSection extends StatefulWidget {
  final Parcela parcela;

  const RiegoSection({super.key, required this.parcela});

  @override
  State<RiegoSection> createState() => RiegoSectionState();
}

class RiegoSectionState extends State<RiegoSection> {
  final _authService = AuthService();
  final _dataService = DataService();
  final _formatoHora = DateFormat('HH:mm');
  final _formatoFecha = DateFormat('dd/MM HH:mm');

  RiegoResumen? _resumen;
  String? _error;
  int? _usuarioId;
  bool _ocupado = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    recargar();
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => recargar());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> recargar() async {
    try {
      _usuarioId ??= await _authService.getUsuarioId();
      final resumen = await _dataService.getRiegoParcela(widget.parcela.id, usuarioId: _usuarioId!);
      if (mounted) {
        setState(() {
          _resumen = resumen;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _accion(Future<void> Function() llamada, String exito) async {
    setState(() => _ocupado = true);
    try {
      await llamada();
      if (mounted) mostrarExito(context, exito);
      await recargar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _regarAhora() async {
    final duracion = await showDialog<int>(context: context, builder: (_) => const _DuracionDialog());
    if (duracion == null) return;
    await _accion(
      () => _dataService.regarAhora(widget.parcela.id, duracionMinutos: duracion, usuarioId: _usuarioId!),
      'Riego iniciado ($duracion min)',
    );
  }

  Future<void> _detener() async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Detener riego',
      mensaje: '¿Detener el riego en curso de "${widget.parcela.nombre}"?',
      textoConfirmar: 'Detener',
    );
    if (!confirmado) return;
    await _accion(() => _dataService.detenerRiego(widget.parcela.id, usuarioId: _usuarioId!), 'Riego detenido');
  }

  Future<void> _cambiarAutomatico(bool activo) async {
    await _accion(
      () => _dataService.setRiegoAutomatico(widget.parcela.id, activo: activo, usuarioId: _usuarioId!),
      activo ? 'Riego automático activado' : 'Riego automático desactivado',
    );
  }

  @override
  Widget build(BuildContext context) {
    final resumen = _resumen;
    if (resumen == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: _error != null
              ? Text(
                  _error!.contains('asignada') ? _error! : 'No se pudo cargar el riego',
                  style: const TextStyle(color: AppTheme.neutralText),
                )
              : const Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final enCurso = resumen.riegoEnCurso;
    final proximas = resumen.programaciones.where((p) => p.proximaEjecucion != null).toList()
      ..sort((a, b) => a.proximaEjecucion!.compareTo(b.proximaEjecucion!));

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Estado actual + acción principal
            Row(
              children: [
                Icon(enCurso != null ? Icons.water_drop : Icons.pause_circle_outline,
                    color: enCurso != null ? _azulRiego : AppTheme.neutralText),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        enCurso != null ? 'Regando' : 'En espera',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: enCurso != null ? _azulRiego : null,
                        ),
                      ),
                      if (enCurso != null)
                        Text(
                          '${enCurso.origenTexto} · ${_formatoHora.format(enCurso.inicio)} a '
                          '${enCurso.finPrevisto != null ? _formatoHora.format(enCurso.finPrevisto!) : '—'}',
                          style: const TextStyle(fontSize: 12, color: AppTheme.neutralText),
                        ),
                    ],
                  ),
                ),
                if (enCurso != null)
                  OutlinedButton.icon(
                    onPressed: _ocupado ? null : _detener,
                    icon: const Icon(Icons.stop_circle_outlined, size: 18),
                    label: const Text('Detener'),
                    style: OutlinedButton.styleFrom(foregroundColor: AppTheme.danger),
                  )
                else
                  FilledButton.icon(
                    onPressed: _ocupado ? null : _regarAhora,
                    icon: const Icon(Icons.water_drop_outlined, size: 18),
                    label: const Text('Regar ahora'),
                    style: FilledButton.styleFrom(backgroundColor: AppTheme.primaryGreen),
                  ),
              ],
            ),
            const Divider(height: 24),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: resumen.riegoAutomatico,
              onChanged: _ocupado ? null : _cambiarAutomatico,
              title: const Text('Riego automático', style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                'Riega solo cuando la humedad baja de ${widget.parcela.humedadMin.round()}%',
                style: const TextStyle(fontSize: 12),
              ),
            ),
            const Divider(height: 16),
            const Text('Próximas programaciones', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            if (proximas.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 6),
                child: Text('Sin programaciones activas', style: TextStyle(color: AppTheme.neutralText, fontSize: 13)),
              )
            else
              ...proximas.take(3).map((p) => _fila(
                    Icons.event,
                    p.nombre,
                    '${_formatoFecha.format(p.proximaEjecucion!)} · ${p.duracionMinutos} min',
                  )),
            const SizedBox(height: 8),
            const Text('Últimos riegos', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            if (resumen.ultimosRiegos.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 6),
                child: Text('Todavía no hay riegos registrados', style: TextStyle(color: AppTheme.neutralText, fontSize: 13)),
              )
            else
              ...resumen.ultimosRiegos.map((r) => _fila(
                    r.estado == 'en_curso' ? Icons.water_drop : Icons.history,
                    '${r.origenTexto}${r.programacionNombre != null ? ' · ${r.programacionNombre}' : ''}',
                    '${_formatoFecha.format(r.inicio)} · ${r.duracionMinutos} min · ${r.estadoTexto}',
                  )),
            if (resumen.reloj != null)
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 4),
                child: Text(
                  'Horas según el reloj del motor de riego (ahora: ${_formatoFecha.format(resumen.reloj!)})',
                  style: const TextStyle(fontSize: 11, color: AppTheme.neutralText),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _fila(IconData icono, String titulo, String detalle) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Icon(icono, size: 18, color: AppTheme.primaryGreen),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(titulo, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                Text(detalle, style: const TextStyle(fontSize: 12, color: AppTheme.neutralText)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Pide la duración del riego manual (minutos del reloj del motor).
class _DuracionDialog extends StatefulWidget {
  const _DuracionDialog();

  @override
  State<_DuracionDialog> createState() => _DuracionDialogState();
}

class _DuracionDialogState extends State<_DuracionDialog> {
  final _controller = TextEditingController(text: '30');
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Regar ahora'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Duración (minutos)'),
              validator: (v) {
                final n = int.tryParse((v ?? '').trim());
                if (n == null || n < 1 || n > 720) return 'Entre 1 y 720 minutos';
                return null;
              },
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [15, 30, 60]
                  .map((m) => ActionChip(label: Text('$m min'), onPressed: () => _controller.text = '$m'))
                  .toList(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        FilledButton(
          onPressed: () {
            if (_formKey.currentState!.validate()) Navigator.of(context).pop(int.parse(_controller.text.trim()));
          },
          style: FilledButton.styleFrom(backgroundColor: AppTheme.primaryGreen),
          child: const Text('Regar'),
        ),
      ],
    );
  }
}
