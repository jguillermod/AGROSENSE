import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';

const _coloresFinca = [
  Color(0xFF66BB6A),
  Color(0xFFE6A23C),
  Color(0xFF26A69A),
  Color(0xFF5C6BC0),
  Color(0xFFEF5350),
];

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _dataService = DataService();
  late Future<(DashboardResumen, List<HistorialPunto>)> _future;

  @override
  void initState() {
    super.initState();
    _future = _cargar();
  }

  Future<(DashboardResumen, List<HistorialPunto>)> _cargar() async {
    final resumen = await _dataService.getDashboardResumen();
    final historial = await _dataService.getDashboardHistorial(dias: 7);
    return (resumen, historial);
  }

  Future<void> _refrescar() async {
    setState(() => _future = _cargar());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Dashboard')),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<(DashboardResumen, List<HistorialPunto>)>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return buildLoading();
            }
            if (snapshot.hasError) {
              return buildErrorState('No se pudo cargar el dashboard');
            }

            final (resumen, historial) = snapshot.data!;

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
                      icon: Icons.warning_amber_rounded,
                      color: AppTheme.warning,
                      value: '${resumen.alertasHoy}',
                      label: 'Alertas hoy',
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
                  ],
                ),
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

  const _StatCard({required this.icon, required this.color, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
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
