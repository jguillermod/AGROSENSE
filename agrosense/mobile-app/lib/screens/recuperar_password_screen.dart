import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../services/auth_service.dart';
import '../widgets/common.dart';

/// Recuperación de contraseña en dos pasos: pedir el enlace por correo y
/// luego definir la contraseña nueva con el código recibido (el mismo
/// token del enlace de la web; es de un solo uso y vence en 30 minutos).
///
/// Es una simulación: auth-service no envía correo, escribe el código en
/// sus logs. Solo si el backend tiene DEV_SHOW_RESET_TOKEN=true el código
/// llega en la respuesta y se precarga aquí.
class RecuperarPasswordScreen extends StatefulWidget {
  final String emailInicial;

  const RecuperarPasswordScreen({super.key, this.emailInicial = ''});

  @override
  State<RecuperarPasswordScreen> createState() => _RecuperarPasswordScreenState();
}

enum _Paso { correo, codigo, listo }

class _RecuperarPasswordScreenState extends State<RecuperarPasswordScreen> {

  final _authService = AuthService();
  final _formCorreo = GlobalKey<FormState>();
  final _formCodigo = GlobalKey<FormState>();
  late final _emailController = TextEditingController(text: widget.emailInicial);
  final _codigoController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmacionController = TextEditingController();

  _Paso _paso = _Paso.correo;
  bool _loading = false;
  String? _error;
  String? _mensaje;
  String? _devToken;

  @override
  void dispose() {
    _emailController.dispose();
    _codigoController.dispose();
    _passwordController.dispose();
    _confirmacionController.dispose();
    super.dispose();
  }

  Future<void> _ejecutar(Future<void> Function() accion) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await accion();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _solicitar() async {
    if (!_formCorreo.currentState!.validate()) return;
    await _ejecutar(() async {
      final solicitud = await _authService.solicitarRecuperacion(_emailController.text.trim());
      if (!mounted) return;
      setState(() {
        _mensaje = solicitud.mensaje;
        _devToken = solicitud.devToken;
        if (_devToken != null) _codigoController.text = _devToken!;
        _paso = _Paso.codigo;
      });
    });
  }

  Future<void> _restablecer() async {
    if (!_formCodigo.currentState!.validate()) return;
    await _ejecutar(() async {
      await _authService.restablecerPassword(
        codigo: _codigoController.text.trim(),
        password: _passwordController.text,
      );
      if (mounted) setState(() => _paso = _Paso.listo);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recuperar contraseña')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: switch (_paso) {
              _Paso.correo => _buildCorreo(),
              _Paso.codigo => _buildCodigo(),
              _Paso.listo => _buildListo(),
            },
          ),
        ),
      ),
    );
  }

  Widget _boton(String texto, VoidCallback accion) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _loading ? null : accion,
        child: _loading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : Text(texto),
      ),
    );
  }

  Widget _buildCorreo() {
    return Form(
      key: _formCorreo,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.key, size: 56, color: AppTheme.primaryGreen),
          const SizedBox(height: 12),
          const Text(
            'Escribe tu correo y te enviaremos un código para definir una contraseña nueva.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppTheme.neutralText),
          ),
          const SizedBox(height: 24),
          if (_error != null) ErrorBanner(mensaje: _error!),
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              labelText: 'Correo electrónico',
              prefixIcon: Icon(Icons.email_outlined),
            ),
            validator: validarEmail,
          ),
          const SizedBox(height: 24),
          _boton('Enviar código', _solicitar),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _loading ? null : () => setState(() => _paso = _Paso.codigo),
            child: const Text('Ya tengo un código'),
          ),
        ],
      ),
    );
  }

  Widget _buildCodigo() {
    return Form(
      key: _formCodigo,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_reset, size: 56, color: AppTheme.primaryGreen),
          const SizedBox(height: 12),
          if (_mensaje != null) SuccessBanner(mensaje: _mensaje!),
          if (_devToken != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.warning.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'Modo desarrollo: no se envía correo, el código ya quedó cargado abajo.',
                style: TextStyle(color: AppTheme.darkGreen),
              ),
            ),
          if (_error != null) ErrorBanner(mensaje: _error!),
          TextFormField(
            controller: _codigoController,
            decoration: const InputDecoration(
              labelText: 'Código de recuperación',
              prefixIcon: Icon(Icons.pin_outlined),
            ),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Ingresa el código que recibiste' : null,
          ),
          const SizedBox(height: 16),
          CampoPassword(
            controller: _passwordController,
            decoration: const InputDecoration(
              labelText: 'Contraseña nueva',
              helperText: ayudaPasswordMinimo,
              prefixIcon: Icon(Icons.lock_outline),
            ),
            validator: validarPassword,
          ),
          const SizedBox(height: 16),
          CampoPassword(
            controller: _confirmacionController,
            decoration: const InputDecoration(
              labelText: 'Repite la contraseña',
              prefixIcon: Icon(Icons.lock_outline),
            ),
            validator: (v) => v != _passwordController.text ? 'Las contraseñas no coinciden' : null,
          ),
          const SizedBox(height: 24),
          _boton('Guardar contraseña', _restablecer),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _loading ? null : () => setState(() => _paso = _Paso.correo),
            child: const Text('Pedir un código nuevo'),
          ),
        ],
      ),
    );
  }

  Widget _buildListo() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.check_circle, size: 64, color: AppTheme.primaryGreen),
        const SizedBox(height: 16),
        const Text(
          'Contraseña actualizada',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
        ),
        const SizedBox(height: 8),
        const Text(
          'Ya puedes iniciar sesión con tu contraseña nueva.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppTheme.neutralText),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Ir a iniciar sesión'),
        ),
      ],
    );
  }
}
