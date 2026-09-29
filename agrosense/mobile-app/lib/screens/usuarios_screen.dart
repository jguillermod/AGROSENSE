import 'package:flutter/material.dart';

import '../config/api_config.dart';
import '../config/theme.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/data_service.dart';
import '../widgets/common.dart';

class UsuariosScreen extends StatefulWidget {
  const UsuariosScreen({super.key});

  @override
  State<UsuariosScreen> createState() => _UsuariosScreenState();
}

class _UsuariosScreenState extends State<UsuariosScreen> {
  final _authService = AuthService();
  final _dataService = DataService();

  late Future<_UsuariosData> _future;
  int? _miId;

  @override
  void initState() {
    super.initState();
    _future = _cargar();
    _authService.getUsuarioId().then((id) => setState(() => _miId = id));
  }

  Future<_UsuariosData> _cargar() async {
    final usuarios = await _authService.getUsuarios();
    final parcelas = await _dataService.getParcelasFlat();
    final asignaciones = await _dataService.getAsignaciones();

    final porUsuario = <int, List<Asignacion>>{};
    for (final a in asignaciones) {
      porUsuario.putIfAbsent(a.usuarioId, () => []).add(a);
    }

    return _UsuariosData(usuarios: usuarios, parcelas: parcelas, asignacionesPorUsuario: porUsuario);
  }

  Future<void> _refrescar() async {
    setState(() => _future = _cargar());
    await _future;
  }

  Future<void> _abrirFormulario(_UsuariosData datos, {Usuario? usuario}) async {
    final nombreController = TextEditingController(text: usuario?.nombre ?? '');
    final emailController = TextEditingController(text: usuario?.email ?? '');
    final passwordController = TextEditingController();
    String rol = usuario?.rol ?? 'agricultor';
    final idsAsignados = <int>{
      ...(datos.asignacionesPorUsuario[usuario?.id] ?? []).map((a) => a.parcelaId),
    };
    final formKey = GlobalKey<FormState>();

    final guardar = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
              child: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        usuario == null ? 'Nuevo usuario' : 'Editar usuario',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.darkGreen),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: nombreController,
                        decoration: const InputDecoration(labelText: 'Nombre completo'),
                        validator: (v) => (v == null || v.isEmpty) ? 'Ingresa un nombre' : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: emailController,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(labelText: 'Correo electrónico'),
                        validator: validarEmail,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: passwordController,
                        obscureText: true,
                        decoration: InputDecoration(
                          labelText: usuario == null ? 'Contraseña' : 'Nueva contraseña (opcional)',
                        ),
                        validator: (v) {
                          // Al crear, la contraseña es obligatoria y con largo
                          // mínimo; al editar es opcional (se deja el campo
                          // vacío para no cambiarla), pero si se escribe algo
                          // debe cumplir el mismo mínimo.
                          if (usuario == null) return validarPassword(v);
                          if (v != null && v.isNotEmpty) return validarPassword(v);
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: rol,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Rol'),
                        items: const [
                          DropdownMenuItem(value: 'agricultor', child: Text('Agricultor')),
                          DropdownMenuItem(value: 'agronomo', child: Text('Agrónomo')),
                          DropdownMenuItem(value: 'admin', child: Text('Administrador')),
                        ],
                        onChanged: (v) => setSheetState(() => rol = v!),
                      ),
                      const SizedBox(height: 16),
                      const Text('Parcelas asignadas', style: TextStyle(fontWeight: FontWeight.w600)),
                      Container(
                        constraints: const BoxConstraints(maxHeight: 180),
                        decoration: BoxDecoration(border: Border.all(color: const Color(0xFFD7DCD6)), borderRadius: BorderRadius.circular(8)),
                        margin: const EdgeInsets.only(top: 6),
                        child: datos.parcelas.isEmpty
                            ? const Padding(padding: EdgeInsets.all(12), child: Text('No hay parcelas registradas'))
                            : ListView(
                                shrinkWrap: true,
                                children: datos.parcelas.map((p) {
                                  return CheckboxListTile(
                                    dense: true,
                                    title: Text(
                                      '${p.fincaNombre} · ${p.nombre}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    value: idsAsignados.contains(p.id),
                                    onChanged: (checked) {
                                      setSheetState(() {
                                        if (checked == true) {
                                          idsAsignados.add(p.id);
                                        } else {
                                          idsAsignados.remove(p.id);
                                        }
                                      });
                                    },
                                  );
                                }).toList(),
                              ),
                      ),
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
              ),
            );
          },
        );
      },
    );

    if (guardar != true || !mounted) return;

    try {
      int usuarioId;
      if (usuario == null) {
        usuarioId = await _authService.crearUsuario(
          nombre: nombreController.text.trim(),
          email: emailController.text.trim(),
          password: passwordController.text,
          rol: rol,
        );
      } else {
        await _authService.editarUsuario(
          usuario.id,
          nombre: nombreController.text.trim(),
          email: emailController.text.trim(),
          rol: rol,
          password: passwordController.text.isEmpty ? null : passwordController.text,
        );
        usuarioId = usuario.id;
      }
      await _dataService.setAsignaciones(usuarioId, idsAsignados.toList());
      if (mounted) mostrarExito(context, usuario == null ? 'Usuario creado' : 'Usuario actualizado');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  Future<void> _eliminar(Usuario usuario) async {
    final confirmado = await confirmarAccion(
      context,
      titulo: 'Eliminar usuario',
      mensaje: '¿Eliminar a "${usuario.nombre}"?',
    );
    if (!confirmado) return;
    try {
      await _authService.eliminarUsuario(usuario.id);
      if (mounted) mostrarExito(context, 'Usuario eliminado');
      await _refrescar();
    } catch (e) {
      if (mounted) mostrarError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Usuarios')),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: FutureBuilder<_UsuariosData>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) return buildLoading();
            if (snapshot.hasError) return buildErrorState('No se pudieron cargar los usuarios');

            final datos = snapshot.data!;
            if (datos.usuarios.isEmpty) return buildEmptyState('No hay usuarios registrados');

            return ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 90),
              itemCount: datos.usuarios.length,
              itemBuilder: (context, index) {
                final usuario = datos.usuarios[index];
                final parcelas = datos.asignacionesPorUsuario[usuario.id] ?? [];
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: AppTheme.primaryGreen.withValues(alpha: 0.15),
                      backgroundImage: usuario.fotoUrl != null
                          ? NetworkImage(ApiConfig.resolveFotoUrl(usuario.fotoUrl)!)
                          : null,
                      child: usuario.fotoUrl == null ? const Icon(Icons.person, color: AppTheme.primaryGreen) : null,
                    ),
                    title: Text(
                      usuario.nombre,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      '${usuario.email}\n${parcelas.isEmpty ? 'Sin parcelas asignadas' : parcelas.map((a) => a.parcelaNombre).join(', ')}',
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                    isThreeLine: true,
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        EstadoBadge(
                          texto: usuario.rol,
                          color: colorRolUsuario(usuario.rol),
                        ),
                        PopupMenuButton<String>(
                          onSelected: (v) {
                            if (v == 'editar') _abrirFormulario(datos, usuario: usuario);
                            if (v == 'eliminar') _eliminar(usuario);
                          },
                          itemBuilder: (context) => [
                            const PopupMenuItem(value: 'editar', child: Text('Editar')),
                            if (usuario.id != _miId) const PopupMenuItem(value: 'eliminar', child: Text('Eliminar')),
                          ],
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
      floatingActionButton: FutureBuilder<_UsuariosData>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const SizedBox.shrink();
          return FloatingActionButton(
            onPressed: () => _abrirFormulario(snapshot.data!),
            child: const Icon(Icons.person_add),
          );
        },
      ),
    );
  }

}

class _UsuariosData {
  final List<Usuario> usuarios;
  final List<ParcelaResumen> parcelas;
  final Map<int, List<Asignacion>> asignacionesPorUsuario;

  _UsuariosData({required this.usuarios, required this.parcelas, required this.asignacionesPorUsuario});
}
