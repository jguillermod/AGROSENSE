import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';
import 'alertas_screen.dart';

const _coloresFinca = [
  Color(0xFF66BB6A),
  Color(0xFFE6A23C),
  Color(0xFF26A69A),
  Color(0xFF5C6BC0),
  Color(0xFFEF5350),
];

/// Todo lo que muestra el dashboard. Alertas y clima son opcionales: si su
/// servicio no responde, el resto del dashboard se muestra igual.
class _DatosDashboard {
  final DashboardResumen resumen;
  final List<HistorialPunto> historial;
  final AlertasConteo? conteo;
  final Clima? clima;

  _DatosDashboard(this.resumen, this.historial, this.conteo, this.clima);
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _authService = AuthService();
  final _dataService = DataService();
  late Future<_DatosDashboard> _future;

  @override
  void initState() {
    super.initState();
    _future = _cargar();
  }

  Future<_DatosDashboard> _cargar() async {
    final usuarioId = await _authService.getUsuarioId();
    final opcionales = await Future.wait<Object?>([
      _dataService.getConteoAlertas(usuarioId: usuarioId!).then<Object?>((c) => c).catchError((_) => null),
      _dataService.getClima().then<Object?>((c) => c).catchError((_) => null),
    ]);
    final resumen = await _dataService.getDashboardResumen(usuarioId: usuarioId);
    final historial = await _dataService.getDashboardHistorial(dias: 7);
    return _DatosDashboard(resumen, historial, opcionales[0] as AlertasConteo?, opcionales[1] as Clima?);
  }

  Future<void> _abrirAlertas() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AlertasScreen()));
    if (mounted) _refrescar();
  }

  Future<void> _refrescar() async {
    setState(() => _future = _cargar());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          FutureBuilder<_DatosDashboard>(
            future: _future,
            builder: (context, snapshot) {
              final activas = snapshot.data?.conteo?.activas ?? 0;
              return IconButton(
                tooltip: 'Alertas',
                onPressed: _abrirAlertas,
                icon: Badge(
                  isLabelVisible: activas > 0,
                  label: Text(activas > 99 ? '99+' : '$activas'),
                  backgroundColor: (snapshot.data?.conteo?.alta ?? 0) > 0 ? AppTheme.danger : AppTheme.warning,
                  child: const Icon(Icons.notifications_outlined),
                ),
              );
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<_DatosDashboard>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return buildLoading();
            }
            if (snapshot.hasError) {
              return buildErrorState('No se pudo cargar el dashboard');
            }

            final datos = snapshot.data!;
            final resumen = datos.resumen;
            final historial = datos.historial;
            final conteo = datos.conteo;

            // El alto de cada tarjeta se calcula a partir del ancho
            // disponible y del escalado de fuente del dispositivo, para
            // que el ícono + valor + etiqueta siempre quepan sin recortarse
            // tanto en pantallas angostas como en tablets con letra grande.
            final anchoPantalla = MediaQuery.sizeOf(context).width;
            final escalaTexto = MediaQuery.textScalerOf(context).scale(1.0);
            final columnas = anchoPantalla >= 900 ? 4 : (anchoPantalla >= 600 ? 3 : 2);

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                GridView.count(
                  crossAxisCount: columnas,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 1.5 / escalaTexto,
                  children: [
                    _StatCard(
                      icon: Icons.sensors,
                      color: AppTheme.primaryGreen,
                      value: '${resumen.estacionesActivas}',
                      label: 'Estaciones activas',
                    ),
                    _StatCard(
                      icon: Icons.notifications_active_outlined,
                      color: AppTheme.warning,
                      value: conteo != null ? '${conteo.activas}' : '—',
                      label: conteo != null
                          ? 'Alertas activas · ${conteo.alta} altas, ${conteo.media} medias'
                          : 'Alertas activas',
                      onTap: _abrirAlertas,
                    ),
                    _StatCard(
                      icon: Icons.water_drop,
                      color: Colors.teal,
                      value: resumen.humedadPromedio != null ? '${resumen.humedadPromedio!.round()}%' : '—',
                      label: 'Humedad promedio',
                    ),
                    _StatCard(
                      icon: Icons.thermostat,
                      color: AppTheme.danger,
                      value: resumen.temperaturaPromedio != null ? '${resumen.temperaturaPromedio!.round()}°C' : '—',
                      label: 'Temp. promedio',
                    ),
                    _StatCard(
                      icon: Icons.eco,
                      color: const Color(0xFF558B2F),
                      value: '${resumen.cultivosActivos}',
                      label: 'Cultivos activos',
                    ),
                    _StatCard(
                      icon: Icons.water,
                      color: const Color(0xFF1565C0),
                      value: '${resumen.riegosEnCurso}',
                      label: 'Riegos en curso',
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _ClimaCard(clima: datos.clima),
                const SizedBox(height: 20),
                const Text(
                  'Humedad promedio por finca (7 días)',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                ),
                const SizedBox(height: 12),
                if (historial.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Text(
                        'Todavía no hay reportes diarios para graficar.',
                        style: const TextStyle(color: AppTheme.neutralText),
                      ),
                    ),
                  )
                else
                  _HistorialChart(historial: historial),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String value;
  final String label;
  final VoidCallback? onTap;

  const _StatCard({required this.icon, required this.color, required this.value, required this.label, this.onTap});

  @override
  Widget build(BuildContext context) {
    final tarjeta = Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [color, color.withValues(alpha: 0.75)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: Colors.white),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
          ),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ],
      ),
    );
    if (onTap == null) return tarjeta;
    return GestureDetector(onTap: onTap, child: tarjeta);
  }
}

/// Clima actual y pronóstico de las próximas horas (reloj de la simulación).
class _ClimaCard extends StatelessWidget {
  final Clima? clima;
  const _ClimaCard({required this.clima});

  static IconData _icono(String condicion) {
    switch (condicion) {
      case 'Lluvia':
        return Icons.thunderstorm_outlined;
      case 'Helada':
        return Icons.ac_unit;
      case 'Ola de calor':
        return Icons.wb_sunny;
      case 'Viento fuerte':
        return Icons.air;
      case 'Noche despejada':
        return Icons.nightlight_round;
      default:
        return Icons.wb_sunny_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = clima;
    final formatoHora = DateFormat('HH:mm');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: c == null
            ? const Row(
                children: [
                  Icon(Icons.cloud_off, color: AppTheme.neutralText),
                  SizedBox(width: 10),
                  Expanded(child: Text('Sin datos de clima en este momento', style: TextStyle(color: AppTheme.neutralText))),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(_icono(c.ahora.condicion), size: 40, color: AppTheme.warning),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${c.ahora.temperatura.round()}°C · ${c.ahora.condicion}',
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
                            Text(
                              '${c.fincaNombre ?? 'Clima'} · ${formatoHora.format(c.ahora.fechaHora)} · '
                              '${c.ahora.lluviaMm} mm/h · ${c.ahora.vientoKmh} km/h',
                              style: const TextStyle(fontSize: 12, color: AppTheme.neutralText),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 78,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (final h in c.pronostico.where((h) => h.fechaHora.hour.isOdd).take(8))
                          Container(
                            width: 62,
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              color: h.evento != null ? const Color(0xFFFDF1DC) : AppTheme.background,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(formatoHora.format(h.fechaHora), style: const TextStyle(fontSize: 11, color: AppTheme.neutralText)),
                                Icon(_icono(h.condicion), size: 20, color: AppTheme.primaryGreen),
                                Text('${h.temperatura.round()}°', style: const TextStyle(fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (c.eventos.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: c.eventos
                          .map((e) => EstadoBadge(
                                texto: e.enCurso
                                    ? '${e.nombre}: hasta ${formatoHora.format(e.hasta)}'
                                    : '${e.nombre}: desde ${formatoHora.format(e.desde)}',
                                color: e.enCurso ? AppTheme.danger : AppTheme.warning,
                              ))
                          .toList(),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

class _HistorialChart extends StatelessWidget {
  final List<HistorialPunto> historial;
  const _HistorialChart({required this.historial});

  @override
  Widget build(BuildContext context) {
    final dias = historial.map((p) => p.dia).toSet().toList()..sort();
    final fincas = historial.map((p) => p.finca).toSet().toList();

    final lineas = <LineChartBarData>[];
    for (var i = 0; i < fincas.length; i++) {
      final finca = fincas[i];
      final color = _coloresFinca[i % _coloresFinca.length];
      final spots = <FlSpot>[];
      for (var d = 0; d < dias.length; d++) {
        final punto = historial.where((p) => p.finca == finca && p.dia == dias[d]);
        if (punto.isNotEmpty) {
          spots.add(FlSpot(d.toDouble(), punto.first.humedad));
        }
      }
      lineas.add(LineChartBarData(
        spots: spots,
        isCurved: true,
        color: color,
        barWidth: 2.5,
        dotData: const FlDotData(show: false),
      ));
    }

    return Column(
      children: [
        Card(
          color: const Color(0xFF1F2A19),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 20, 20, 12),
            child: SizedBox(
              height: 220,
              child: LineChart(
                LineChartData(
                  minY: 0,
                  maxY: 100,
                  gridData: FlGridData(show: true, horizontalInterval: 25, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: Colors.white24, strokeWidth: 1)),
                  borderData: FlBorderData(show: false),
                  titlesData: FlTitlesData(
                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        reservedSize: 32,
                        interval: 25,
                        getTitlesWidget: (v, m) => Text('${v.toInt()}%', style: const TextStyle(fontSize: 10, color: Colors.white70)),
                      ),
                    ),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        reservedSize: 26,
                        interval: (dias.length / 4).ceilToDouble().clamp(1, dias.length.toDouble()),
                        getTitlesWidget: (v, m) {
                          final i = v.toInt();
                          if (i < 0 || i >= dias.length) return const SizedBox.shrink();
                          return Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(DateFormat('dd/MM').format(dias[i]), style: const TextStyle(fontSize: 10, color: Colors.white70)),
                          );
                        },
                      ),
                    ),
                  ),
                  lineBarsData: lineas,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 14,
          runSpacing: 6,
          children: [
            for (var i = 0; i < fincas.length; i++)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(width: 10, height: 10, decoration: BoxDecoration(color: _coloresFinca[i % _coloresFinca.length], shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                  Text(fincas[i], style: const TextStyle(fontSize: 12)),
                ],
              ),
          ],
        ),
      ],
    );
  }
}
