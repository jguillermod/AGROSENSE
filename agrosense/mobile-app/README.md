# AgroSense - App móvil (Flutter)

Esta carpeta está reservada para el proyecto Flutter. Como Flutter genera su propia
estructura de archivos, no se puede "crear a mano" — se inicializa así:

```bash
# Desde la raíz del repo:
cd mobile-app
flutter create . --org com.agrosense --project-name agrosense_app
```

Esto genera `lib/`, `android/`, `ios/`, `pubspec.yaml`, etc. dentro de esta misma carpeta.

## Próximos pasos sugeridos
1. Instalar Flutter SDK (https://docs.flutter.dev/get-started/install).
2. Correr el comando de arriba.
3. Configurar en `lib/config.dart` las URLs de los microservicios
   (usar la IP de tu máquina en la red local, no `localhost`, si vas a
   probar en un dispositivo físico o emulador).
4. Pantallas mínimas según el Project Charter: Login, Lista de parcelas,
   Detalle de parcela (humedad/temperatura/alertas), Historial de lecturas.
