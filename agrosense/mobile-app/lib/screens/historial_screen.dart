import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/theme.dart';
import '../models/models.dart';
import '../services/data_service.dart';

class HistorialScreen extends StatefulWidget {
  final Estacion estacion;

  const HistorialScreen({super.key, required this.estacion});

  @override
  State<HistorialScreen> createState() => _HistorialScreenState();
}

class _HistorialScreenState extends State<HistorialScreen> {
  final _dataService = DataService();
  late Future<List<Lectura>> _lecturasFuture;

  @override
  void initState() {
    super.initState();
    _lecturasFuture = _dataService.getLecturas(widget.estacion.id);
  }

  Future<void> _refrescar() async {
    setState(() {
      _lecturasFuture = _dataService.getLecturas(widget.estacion.id);
    });
    await _lecturasFuture;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Historial · ${widget.estacion.codigo}', maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<List<Lectura>>(
          future: _lecturasFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return ListView(
                children: const [
                  SizedBox(height: 120),
                  Center(child: Text('No se pudo cargar el historial')),
                ],
              );
            }

            // El backend entrega las lecturas más recientes primero;
            // para la gráfica las queremos en orden cronológico.
            final lecturasDesc = snapshot.data ?? [];
            final lecturasAsc = lecturasDesc.reversed.toList();

            if (lecturasAsc.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 120),
                  Center(child: Text('Esta estación todavía no tiene lecturas')),
                ],
              );
            }

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Humedad del suelo (%)',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 240,
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 20, 20, 12),
                      child: _buildChart(lecturasAsc),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Lecturas recientes',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                ),
                const SizedBox(height: 8),
                Card(
                  child: Column(
                    children: lecturasDesc.map((lectura) {
                      return ListTile(
                        leading: const Icon(Icons.water_drop_outlined, color: Colors.teal),
                        title: Text(
                          '${lectura.humedadSuelo.round()}% humedad · ${lectura.temperatura.round()}°C',
                        ),
                        subtitle: Text(DateFormat('dd/MM/yyyy HH:mm').format(lectura.fecha)),
                        trailing: Text(
                          '${lectura.humedadAmbiental.round()}% amb.',
                          style: const TextStyle(color: AppTheme.neutralText, fontSize: 12),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildChart(List<Lectura> lecturas) {
    final spots = <FlSpot>[
      for (var i = 0; i < lecturas.length; i++) FlSpot(i.toDouble(), lecturas[i].humedadSuelo),
    ];

    final step = (lecturas.length / 4).ceil().clamp(1, lecturas.length);

    return LineChart(
      LineChartData(
        minY: 0,
        maxY: 100,
        gridData: FlGridData(
          show: true,
          horizontalInterval: 25,
          drawVerticalLine: false,
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 32,
              interval: 25,
              getTitlesWidget: (value, meta) => Text('${value.toInt()}%', style: const TextStyle(fontSize: 10)),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 28,
              interval: step.toDouble(),
              getTitlesWidget: (value, meta) {
                final index = value.toInt();
                if (index < 0 || index >= lecturas.length) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    DateFormat('dd/MM').format(lecturas[index].fecha),
                    style: const TextStyle(fontSize: 10),
                  ),
                );
              },
            ),
          ),
        ),
        lineTouchData: LineTouchData(
          touchTooltipData: LineTouchTooltipData(
            getTooltipItems: (touchedSpots) {
              return touchedSpots.map((spot) {
                final lectura = lecturas[spot.x.toInt()];
                return LineTooltipItem(
                  '${lectura.humedadSuelo.round()}%\n${DateFormat('dd/MM HH:mm').format(lectura.fecha)}',
                  const TextStyle(color: Colors.white, fontSize: 12),
                );
              }).toList();
            },
          ),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: AppTheme.primaryGreen,
            barWidth: 3,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              color: AppTheme.primaryGreen.withValues(alpha: 0.15),
            ),
          ),
        ],
      ),
    );
  }
}
