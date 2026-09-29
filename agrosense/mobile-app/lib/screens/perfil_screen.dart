import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../config/api_config.dart';
import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../widgets/common.dart';
import 'login_screen.dart';

class PerfilScreen extends StatefulWidget {
  const PerfilScreen({super.key});

  @override
  State<PerfilScreen> createState() => _PerfilScreenState();
}

class _PerfilScreenState extends State<PerfilScreen> {
  final _authService = AuthService();
  final _picker = ImagePicker();

  Future<Usuario>? _perfilFuture;
  bool _subiendoFoto = false;

  @override
  void initState() {
    super.initState();
    _cargarPerfil();
  }

  void _cargarPerfil() {
    setState(() {
      _perfilFuture = _authService.getUsuarioId().then((id) => _authService.getUsuario(id!));
    });
  }

  Future<void> _cambiarFoto() async {
    final XFile? archivo = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (archivo == null) return;

    setState(() => _subiendoFoto = true);
    try {
      await _authService.actualizarFoto(
        File(archivo.path),
        mimeType: archivo.mimeType,
        nombreArchivo: archivo.name,
      );
      if (mounted) mostrarExito(context, 'Foto de perfil actualizada');
      _cargarPerfil();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    } finally {
      if (mounted) setState(() => _subiendoFoto = false);
    }
  }

  Future<void> _cambiarCorreo(int usuarioId, String emailActual) async {
    final emailController = TextEditingController(text: emailActual);
    final passwordController = TextEditingController();
    await _abrirFormularioSimple(
      titulo: 'Cambiar correo',
      campos: [
        TextFormField(
          controller: emailController,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Nuevo correo'),
          validator: validarEmail,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: passwordController,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Contraseña actual'),
          validator: (v) => (v == null || v.isEmpty) ? 'Confirma tu contraseña actual' : null,
        ),
      ],
      onGuardar: () => _authService.actualizarCorreo(
        id: usuarioId,
        email: emailController.text.trim(),
        passwordActual: passwordController.text,
      ),
      mensajeExito: 'Correo actualizado correctamente',
    );
  }

  Future<void> _cambiarContrasena(int usuarioId) async {
    final actualController = TextEditingController();
    final nuevaController = TextEditingController();
    final confirmarController = TextEditingController();
    await _abrirFormularioSimple(
      titulo: 'Cambiar contraseña',
      campos: [
        TextFormField(
          controller: actualController,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Contraseña actual'),
          validator: (v) => (v == null || v.isEmpty) ? 'Ingresa tu contraseña actual' : null,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: nuevaController,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Nueva contraseña'),
          validator: (v) {
            if (v == null || v.isEmpty) return 'Ingresa una nueva contraseña';
            if (v.length < 6) return 'Debe tener al menos 6 caracteres';
            return null;
          },
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: confirmarController,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Confirmar nueva contraseña'),
          validator: (v) => (v != nuevaController.text) ? 'No coincide con la nueva contraseña' : null,
        ),
      ],
      onGuardar: () => _authService.actualizarContrasena(
        id: usuarioId,
        passwordActual: actualController.text,
        passwordNueva: nuevaController.text,
      ),
      mensajeExito: 'Contraseña actualizada correctamente',
    );
  }

  Future<void> _abrirFormularioSimple({
    required String titulo,
    required List<Widget> campos,
    required Future<void> Function() onGuardar,
    required String mensajeExito,
  }) async {
    final formKey = GlobalKey<FormState>();

    final confirmar = await showModalBottomSheet<bool>(
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
                Text(titulo, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
                const SizedBox(height: 16),
                ...campos,
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

    if (confirmar != true || !mounted) return;

    try {
      await onGuardar();
      if (mounted) mostrarExito(context, mensajeExito);
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _cerrarSesion() async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Cerrar sesión',
      mensaje: '¿Seguro que quieres cerrar sesión?',
      textoConfirmar: 'Cerrar sesión',
    );
    if (!confirmado) return;
    await _authService.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mi perfil')),
      body: FutureBuilder<Usuario>(
        future: _perfilFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
          if (snapshot.hasError) return buildErrorState('No se pudo cargar tu perfil');

          final usuario = snapshot.data!;
          final fotoUrl = ApiConfig.resolveFotoUrl(usuario.fotoUrl);

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: Column(
                  children: [
                    Stack(
                      children: [
                        CircleAvatar(
                          radius: 48,
                          backgroundColor: AppTheme.primaryGreen.withValues(alpha: 0.15),
                          backgroundImage: fotoUrl != null ? NetworkImage(fotoUrl) : null,
                          child: fotoUrl == null ? const Icon(Icons.person, size: 48, color: AppTheme.primaryGreen) : null,
                        ),
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: GestureDetector(
                            onTap: _subiendoFoto ? null : _cambiarFoto,
                            child: CircleAvatar(
                              radius: 16,
                              backgroundColor: AppTheme.primaryGreen,
                              child: _subiendoFoto
                                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                  : const Icon(Icons.camera_alt, size: 16, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(usuario.nombre, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen)),
                    const SizedBox(height: 4),
                    EstadoBadge(
                      texto: usuario.rol,
                      color: colorRolUsuario(usuario.rol),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.email_outlined, color: AppTheme.primaryGreen),
                  title: const Text('Correo electrónico'),
                  subtitle: Text(usuario.email),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _cambiarCorreo(usuario.id, usuario.email),
                ),
              ),
              const SizedBox(height: 10),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.lock_outline, color: AppTheme.primaryGreen),
                  title: const Text('Contraseña'),
                  subtitle: const Text('Cambiar tu contraseña de acceso'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _cambiarContrasena(usuario.id),
                ),
              ),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: _cerrarSesion,
                icon: const Icon(Icons.logout, color: AppTheme.danger),
                label: const Text('Cerrar sesión', style: TextStyle(color: AppTheme.danger)),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AppTheme.danger),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
