import 'package:flutter/material.dart';

import 'config/theme.dart';
import 'screens/login_screen.dart';
import 'screens/main_shell.dart';
import 'services/auth_service.dart';

void main() {
  runApp(const AgroSenseApp());
}

class AgroSenseApp extends StatelessWidget {
  const AgroSenseApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AgroSense',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      // Limita el escalado de fuente del sistema operativo: respeta la
      // preferencia de accesibilidad del usuario pero evita que un texto
      // extremadamente grande (o muy pequeño) rompa el layout de tarjetas,
      // grids y la barra de navegación inferior.
      builder: (context, child) {
        final mediaQuery = MediaQuery.of(context);
        final textScaler = mediaQuery.textScaler.clamp(
          minScaleFactor: 0.85,
          maxScaleFactor: 1.3,
        );
        return MediaQuery(
          data: mediaQuery.copyWith(textScaler: textScaler),
          child: child!,
        );
      },
      home: const _SesionGate(),
    );
  }
}

/// Decide, al arrancar, si ya hay una sesión guardada (token en
/// SharedPreferences) para ir directo al Home, o si hay que mandar al
/// usuario al login.
class _SesionGate extends StatefulWidget {
  const _SesionGate();

  @override
  State<_SesionGate> createState() => _SesionGateState();
}

class _SesionGateState extends State<_SesionGate> {
  final _authService = AuthService();
  late Future<bool> _sesionFuture;

  @override
  void initState() {
    super.initState();
    _sesionFuture = _authService.isLoggedIn();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _sesionFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(
              child: Icon(Icons.eco, size: 72, color: AppTheme.primaryGreen),
            ),
          );
        }

        final haySesion = snapshot.data ?? false;
        return haySesion ? const MainShell() : const LoginScreen();
      },
    );
  }
}
