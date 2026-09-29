import 'package:flutter/material.dart';

import '../config/theme.dart';

/// Mismo criterio de color que usa el panel web para el estado de una
/// parcela (Necesita riego / Óptimo / Riesgo de hongos / Riesgo por calor).
Color colorEstadoParcela(String? estado) {
  switch (estado) {
    case 'Necesita riego':
      return AppTheme.warning;
    case 'Óptimo':
      return AppTheme.primaryGreen;
    case 'Riesgo de hongos':
    case 'Riesgo por calor':
      return AppTheme.danger;
    default:
      return AppTheme.neutralText;
  }
}

final _emailRegex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// Validador de correo reutilizable: antes de este cambio los formularios
/// solo comprobaban que el campo no estuviera vacío, así que cualquier
/// texto (sin "@" ni dominio) se aceptaba como correo válido y terminaba
/// guardado en la base -una cuenta con la que después no se puede iniciar
/// sesión. Se usa en login, registro y alta/edición de usuarios.
String? validarEmail(String? valor) {
  final texto = valor?.trim() ?? '';
  if (texto.isEmpty) return 'Ingresa tu correo';
  if (!_emailRegex.hasMatch(texto)) return 'Ingresa un correo válido (ej. nombre@dominio.com)';
  return null;
}

/// Validador de contraseña reutilizable (mínimo de caracteres).
String? validarPassword(String? valor, {int minLength = 6}) {
  if (valor == null || valor.isEmpty) return 'Ingresa una contraseña';
  if (valor.length < minLength) return 'Debe tener al menos $minLength caracteres';
  return null;
}

/// Color del badge de rol de un usuario, para distinguir de un vistazo
/// admin / agricultor / agrónomo en las listas.
Color colorRolUsuario(String rol) {
  switch (rol) {
    case 'admin':
      return AppTheme.primaryGreen;
    case 'agronomo':
      return AppTheme.lightGreen;
    default:
      return AppTheme.neutralText;
  }
}

class EstadoBadge extends StatelessWidget {
  final String texto;
  final Color color;

  const EstadoBadge({super.key, required this.texto, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        texto,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

/// Banner de error reutilizable, mismo estilo (fondo rojo suave) que en
/// el panel web.
class ErrorBanner extends StatelessWidget {
  final String mensaje;
  const ErrorBanner({super.key, required this.mensaje});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFDECEA),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(mensaje, style: const TextStyle(color: AppTheme.danger)),
    );
  }
}

class SuccessBanner extends StatelessWidget {
  final String mensaje;
  const SuccessBanner({super.key, required this.mensaje});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFE8F5E9),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(mensaje, style: const TextStyle(color: AppTheme.primaryGreen)),
    );
  }
}

Widget buildLoading() => const Center(child: CircularProgressIndicator());

Widget buildErrorState(String mensaje) {
  return ListView(
    children: [
      const SizedBox(height: 120),
      const Icon(Icons.error_outline, size: 48, color: AppTheme.danger),
      const SizedBox(height: 12),
      Center(child: Text(mensaje)),
    ],
  );
}

Widget buildEmptyState(String mensaje) {
  return ListView(
    children: [
      const SizedBox(height: 120),
      Center(child: Text(mensaje, style: const TextStyle(color: AppTheme.neutralText))),
    ],
  );
}

/// Diálogo de confirmación estándar antes de una acción destructiva.
Future<bool> confirmarAccion(
  BuildContext context, {
  required String titulo,
  required String mensaje,
  String textoConfirmar = 'Eliminar',
}) async {
  final resultado = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(titulo),
      content: Text(mensaje),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancelar')),
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(textoConfirmar, style: const TextStyle(color: AppTheme.danger)),
        ),
      ],
    ),
  );
  return resultado ?? false;
}

void mostrarError(BuildContext context, Object error) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(error.toString()), backgroundColor: AppTheme.danger),
  );
}

void mostrarExito(BuildContext context, String mensaje) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(mensaje), backgroundColor: AppTheme.primaryGreen),
  );
}
