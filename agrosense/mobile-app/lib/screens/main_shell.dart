import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import 'dashboard_screen.dart';
import 'fincas_screen.dart';
import 'mis_parcelas_screen.dart';
import 'parcelas_screen.dart';
import 'perfil_screen.dart';
import 'sensores_screen.dart';
import 'usuarios_screen.dart';

/// Contenedor con navegación inferior, con secciones distintas según el
/// rol:
/// - admin: ve todo (Dashboard, Fincas, Parcelas, Sensores, Usuarios, Perfil).
/// - agricultor: Dashboard, Parcelas y Perfil.
/// - agronomo: Dashboard, "Mis parcelas" (las que el admin le asignó, más
///   las que él mismo registre) y Perfil. Desde "Mis parcelas" también
///   puede registrar una finca/parcela nueva y vincular un sensor.
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  final _authService = AuthService();
  int _index = 0;
  String _rol = 'agricultor';
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _authService.getUsuarioRol().then((rol) {
      setState(() {
        _rol = rol ?? 'agricultor';
        _cargando = false;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_cargando) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final esAdmin = _rol == 'admin';
    final esAgronomo = _rol == 'agronomo';

    final List<Widget> pantallas;
    final List<NavigationDestination> destinos;

    if (esAdmin) {
      pantallas = const [
        DashboardScreen(),
        FincasScreen(),
        ParcelasScreen(),
        SensoresScreen(),
        UsuariosScreen(),
        PerfilScreen(),
      ];
      destinos = const [
        NavigationDestination(icon: Icon(Icons.grid_view_outlined), selectedIcon: Icon(Icons.grid_view), label: 'Dashboard'),
        NavigationDestination(icon: Icon(Icons.home_work_outlined), selectedIcon: Icon(Icons.home_work), label: 'Fincas'),
        NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Parcelas'),
        NavigationDestination(icon: Icon(Icons.sensors_outlined), selectedIcon: Icon(Icons.sensors), label: 'Sensores'),
        NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'Usuarios'),
        NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
      ];
    } else if (esAgronomo) {
      pantallas = const [
        DashboardScreen(),
        MisParcelasScreen(),
        PerfilScreen(),
      ];
      destinos = const [
        NavigationDestination(icon: Icon(Icons.grid_view_outlined), selectedIcon: Icon(Icons.grid_view), label: 'Dashboard'),
        NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Mis parcelas'),
        NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
      ];
    } else {
      // Agricultor (o cualquier rol futuro no contemplado arriba): vista
      // reducida, sin gestión de fincas ni sensores.
      pantallas = const [
        DashboardScreen(),
        ParcelasScreen(),
        PerfilScreen(),
      ];
      destinos = const [
        NavigationDestination(icon: Icon(Icons.grid_view_outlined), selectedIcon: Icon(Icons.grid_view), label: 'Dashboard'),
        NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Parcelas'),
        NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
      ];
    }

    // Con el rol admin hay 6 destinos; en pantallas angostas mostrar
    // siempre las 6 etiquetas puede desbordar el ancho disponible, así
    // que solo se muestra la etiqueta de la pestaña activa.
    final labelBehavior = destinos.length > 5
        ? NavigationDestinationLabelBehavior.onlyShowSelected
        : NavigationDestinationLabelBehavior.alwaysShow;

    return Scaffold(
      body: IndexedStack(index: _index, children: pantallas),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        labelBehavior: labelBehavior,
        destinations: destinos,
      ),
    );
  }
}
