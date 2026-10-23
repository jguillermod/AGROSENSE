# AgroSense — Sistema de Monitoreo Agrícola con IoT

Proyecto de curso (Análisis de Sistemas II / Ingeniería de Software).
Microservicios (Node.js), ETL (Python), app móvil (Flutter) y sitio web administrativo (Node + EJS), sobre MySQL/MariaDB.

## Estructura del repo

```
agrosense/
├── docker-compose.yml          # Ambiente de DESARROLLO
├── docker-compose.test.yml     # Ambiente de PRUEBAS (aislado, otros puertos/DB)
├── .env.example                # Plantilla de variables de entorno
├── services/
│   ├── auth-service/           # Login, registro, usuarios (Node/Express)
│   ├── fincas-service/         # Fincas, parcelas, estaciones (Node/Express)
│   ├── lecturas-service/       # Recibe datos del ESP32, alertas (sensor y clima), historial (Node/Express)
│   ├── simulator-service/      # Simula sensores y clima: datos demo, lecturas, /clima, /reloj (Node/Express)
│   ├── backup-service/         # Respaldos de la base con mariadb-dump (Node/Express)
│   └── etl-service/            # Resúmenes diarios (Python + pandas)
├── web-admin/                  # Sitio web administrativo (Node + EJS)
├── mobile-app/                 # App Flutter (agricultor)
├── db/init.sql                 # Schema inicial de la base de datos
├── db/migrations/              # Cambios de schema para bases que ya existen (ver abajo)
├── k8s/                        # Manifiestos de Kubernetes (fase de despliegue)
└── docs/                       # Diagramas UML, manual de usuario, etc.
```

## Cómo levantar el ambiente de DESARROLLO local

1. Copiar `.env.example` a `.env` y ajustar contraseñas, `JWT_SECRET` y `SERVICE_TOKEN`
   (ver [Seguridad](#seguridad)).
2. Levantar todo:
   ```bash
   docker compose up --build
   ```
   Si cambió algún `package.json`, agrega `-V` (`docker compose up --build -d -V`): cada servicio guarda
   `node_modules` en un volumen anónimo y sin `-V` se queda con los módulos viejos.
3. Servicios disponibles: ver la tabla de puertos abajo.
4. Para apagar: `docker compose down` (agregar `-v` si además quieres borrar los datos de la DB **y los respaldos**).

### Puertos

| Servicio | Desarrollo | Pruebas | Para qué |
|---|---|---|---|
| web-admin | 8080 | 8090 | Panel web |
| auth-service | 3001 | 4001 | Login, usuarios |
| fincas-service | 3002 | 4002 | Fincas, parcelas, sensores, cultivos, riego (incluye el motor de riego) |
| lecturas-service | 3003 | 4003 | Lecturas, alertas, clima (`/api/clima`) |
| simulator-service | 3004 | 4004 | Simulador de sensores y clima |
| backup-service | 3005 | 4005 | Respaldos |
| MariaDB | 3307 | 3316 | Base de datos |
| phpMyAdmin | 8081 | — | Administrar la base |
| Uptime Kuma | 3010 | 4010 | Monitoreo de salud y página de estado |

El etl-service no publica puertos (corre cada `ETL_INTERVAL_MINUTES`; en desarrollo, 5).

## Migraciones de base de datos

`db/init.sql` solo corre cuando el volumen de MySQL está vacío. Si tu base ya tiene datos,
aplica los scripts de `db/migrations/` en orden (son repetibles y no borran nada; volver a correr
uno ya aplicado no hace daño):

| Migración | Qué agrega |
|---|---|
| `001_cultivos.sql` | Inventario de cultivos |
| `002_riego.sql` | Programaciones y bitácora de riego, `parcelas.riego_automatico` |
| `003_alertas_clima.sql` | Ciclo de vida de alertas (activa/atendida/resuelta, severidad, categoría sensor/climática), `parcelas.temperatura_min` (heladas), riegos "omitidos" |
| `004_login_seguridad.sql` | Bloqueo de cuenta (`usuarios.intentos_fallidos`, `usuarios.bloqueado_hasta`) y tabla `password_resets` para recuperar la contraseña |

```bash
for m in db/migrations/0*.sql; do
  docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < "$m"
done
```

En el ambiente de pruebas es igual, con el contenedor `agrosense-mysql-test`. Cada migración nueva
también se agrega a `db/init.sql`, para que una base vacía quede igual que una migrada.

## Riego y reloj simulado

El motor de riego vive en `fincas-service`: cada pocos segundos revisa las programaciones, cierra
los riegos que terminaron y, en parcelas con riego automático, riega cuando la humedad baja del
mínimo. Con `RIEGO_RELOJ=simulado` (por defecto) usa la hora del simulador (`GET :3004/reloj`), que
avanza `SIM_TIME_SCALE` veces más rápido, así que un horario de las 06:00 se dispara en pocos minutos
reales. Con `RIEGO_RELOJ=real` usa la hora local de `APP_TIMEZONE`. Las horas de la bitácora de riego
están en ese mismo reloj.

## Simulación (sin sensores reales)

`simulator-service` arranca solo con `docker compose up`. La primera vez crea una
**Finca Demo (Simulador)** con 3 parcelas (umbrales distintos) y 2 estaciones `SIM-*`
por parcela, vinculadas con el mismo flujo de token/api_key que un sensor físico.
No toca fincas, parcelas ni estaciones reales. Luego envía una lectura por estación
cada `SIM_INTERVAL_SECONDS` (humedad con evaporación y riegos, temperatura con ciclo
día/noche acelerado por `SIM_TIME_SCALE`, humedad ambiental inversa a la temperatura).

Control (exige el JWT de un admin; cómo obtenerlo en [Seguridad](#seguridad)):

```bash
AUTH="Authorization: Bearer $TOKEN"
curl -H "$AUTH" http://localhost:3004/status
curl -H "$AUTH" -X POST http://localhost:3004/scenario -H "Content-Type: application/json" -d '{"nombre":"sequia"}'
# escenarios: normal | sequia | ola_calor | exceso_lluvia
curl -H "$AUTH" -X POST http://localhost:3004/pause
curl -H "$AUTH" -X POST http://localhost:3004/resume
curl -H "$AUTH" -X POST http://localhost:3004/speed -H "Content-Type: application/json" -d '{"intervalo":5}'
```

Los escenarios llevan los valores poco a poco más allá de los umbrales de cada parcela,
así que las alertas que aparecen son las que genera el lecturas-service de verdad.

### Clima simulado

El simulador también tiene clima: estado actual, pronóstico de 24 h simuladas y eventos. Los eventos
aleatorios (`SIM_CLIMA_ALEATORIO`, por defecto ~1 por día simulado) se anuncian con horas de
anticipación, así primero aparecen en el pronóstico y después ocurren.

```bash
curl -H "$AUTH" http://localhost:3004/clima          # ahora, pronóstico y eventos programados
# Evento a mano (horas simuladas); "en_horas" es opcional, para verlo primero en el pronóstico
curl -H "$AUTH" -X POST http://localhost:3004/clima/evento -H "Content-Type: application/json" \
     -d '{"tipo":"helada","duracion_horas":3,"en_horas":4}'
# tipos: lluvia | helada | ola_calor | viento
curl -H "$AUTH" -X DELETE http://localhost:3004/clima/eventos   # cancela los eventos en curso y programados
curl -H "$AUTH" -X POST http://localhost:3004/clima/aleatorio -H "Content-Type: application/json" -d '{"activo":false}'
```

Efecto en las lecturas: la lluvia sube la humedad (suelo y ambiente) y baja la temperatura, la helada
la lleva bajo la `temperatura_min` de cada parcela, la ola de calor la sube sobre la máxima y el viento
seca. lecturas-service revisa `/clima` cada `CLIMA_POLL_SECONDS` y abre alertas climáticas
("Pronóstico de helada", "Lluvia intensa prevista: posponer riego", "Viento fuerte"…). Con lluvia en
curso o prevista, el motor de riego omite los riegos automáticos y programados y lo anota en la bitácora.

### Alertas

Hay una sola alerta vigente por (parcela, tipo): mientras la condición sigue se actualiza (repeticiones,
último valor) y al terminar se marca **resuelta** sola. "Marcar como atendida" indica que alguien se
hizo cargo. Una sequía de 10 minutos deja unas pocas filas en `alertas`, no una por lectura.

## Respaldos

`backup-service` guarda respaldos completos (`mariadb-dump` comprimido, `.sql.gz`) en el volumen de
Docker `backups_data`, **nunca dentro del repo** (contienen hashes de contraseñas y `api_key_hash`).
Hace uno automático cada `BACKUP_INTERVAL_HOURS` (24) y borra los más viejos que `BACKUP_RETENTION_DAYS` (7).
En el panel web: **Respaldos** (solo admin) para crear, descargar, restaurar (hay que escribir
RESTAURAR) y eliminar, además de exportar lecturas, alertas, cultivos y bitácora de riego en CSV.

Probar respaldo y restauración con la API directa (JWT de admin y, si definiste `BACKUP_API_TOKEN`,
también la cabecera `x-backup-token`; exporta esa variable en tu terminal sin pegarla en ningún archivo):

```bash
AUTH="Authorization: Bearer $TOKEN"; LLAVE="x-backup-token: $BACKUP_API_TOKEN"
curl -H "$AUTH" -H "$LLAVE" -X POST http://localhost:3005/backups        # 1. respaldo manual
curl -H "$AUTH" -H "$LLAVE" http://localhost:3005/backups                # 2. aparece en la lista
curl -H "$AUTH" -H "$LLAVE" -o prueba.sql.gz http://localhost:3005/backups/<nombre>/descargar   # 3. descarga (no la subas al repo)
# 4. borra algo de prueba (p. ej. un cultivo desde la web) y restaura:
curl -H "$AUTH" -H "$LLAVE" -X POST http://localhost:3005/backups/<nombre>/restaurar
# 5. el dato vuelve. Antes de restaurar se crea un respaldo "seguridad" del estado anterior.
```

Antes de restaurar se crea siempre un respaldo de seguridad. `BACKUP_API_TOKEN` es una segunda llave
(web-admin la envía en `x-backup-token`), recomendada si el puerto 3005 queda accesible fuera de tu PC.

## Seguridad

### Sesión (JWT) en los microservicios

auth-service firma un JWT al iniciar sesión (`{ id, rol }`, dura `JWT_EXPIRES_IN`). Los demás servicios lo
validan con el mismo `JWT_SECRET` usando el middleware `verificarJWT` (`services/*/src/verificarJWT.js`,
**copia idéntica en cada servicio**: si cambias uno, copia el archivo a los demás). Toda petición protegida
debe traer `Authorization: Bearer <token>`; si falta, es inválido o venció, el servicio responde **401** con un
mensaje claro y la cabecera `WWW-Authenticate: Bearer`. Los permisos por rol salen siempre del token,
nunca de un `usuario_id` que mande el cliente.

| Servicio | Público (sin token) | Requiere JWT |
|---|---|---|
| auth-service | `/health`, `POST /api/auth/login`, `POST /api/auth/register` con rol `agricultor`, `POST /api/auth/recuperar`, `POST /api/auth/restablecer` | `GET /api/auth/me`; administración de usuarios (listar, editar, eliminar, crear con otro rol, `PUT /api/auth/usuarios/:id/desbloquear`): **admin**; ver o editar el propio perfil: el mismo usuario |
| fincas-service | `/health`, `POST /api/estaciones/vincular` (el sensor usa su token de un solo uso) | todo lo demás, con permisos por rol (abajo) |
| lecturas-service | `/health`, `POST /api/lecturas` (ingesta: sigue con la `x-api-key` de la estación) | lecturas, exportación, registros manuales, alertas y `/api/clima` |
| simulator-service | `/health` | control (`/status`, `/scenario`, `/pause`, `/resume`, `/speed`, `/clima`, `/clima/evento`, `/clima/eventos`, `/clima/aleatorio`): **admin**; `/reloj`: cualquier usuario |
| backup-service | `/health` | `/backups/*`: **admin**, además de `x-backup-token` si `BACKUP_API_TOKEN` está definido |


**Permisos por rol** (`services/fincas-service/src/permisos.js`, la misma copia en lecturas-service):

- **admin**: todo.
- **agricultor**: sus fincas (`fincas.usuario_id`) con todas sus parcelas, más las parcelas que el admin le asigne.
- **agrónomo**: sus parcelas asignadas (y las de fincas que él mismo registre desde la app).
- Una parcela o finca fuera de su alcance responde **403**; los listados (fincas, parcelas, cultivos, riego,
  lecturas, alertas, dashboard) solo traen lo que le corresponde.
- Crear o eliminar parcelas y editar o eliminar una finca: su dueño o el admin. Asignar parcelas a otros
  usuarios: solo admin (un usuario solo puede auto-asignarse parcelas de sus propias fincas).

### Largo mínimo de contraseña

Toda contraseña nueva debe tener **al menos 8 caracteres**: registro, alta y edición de usuarios, cambio de
contraseña en el perfil y recuperación. Lo valida auth-service (`PASSWORD_MIN` en `seguridadLogin.js`), y la
web (`minlength="8"`) y la app lo revisan antes de enviar, con el mismo mensaje:
*"La contraseña debe tener al menos 8 caracteres."*. Las cuentas creadas antes con contraseñas más cortas
siguen iniciando sesión (el login no revisa el largo); el mínimo aplica cuando cambien la contraseña.

### Bloqueo de cuenta por intentos fallidos

(`services/auth-service/src/seguridadLogin.js`)

- **5 intentos fallidos seguidos** bloquean la cuenta **15 minutos**. Mientras dure, ni la contraseña correcta
  entra. El login responde **423** con el tiempo restante (`"Podrás intentarlo de nuevo en 14 min 20 s"`,
  más `segundos_restantes` y `bloqueado_hasta`). La web y la app muestran ese mensaje tal cual.
- Es 423 y no 401 a propósito: no trae `WWW-Authenticate`, así que **no cierra ninguna sesión abierta**. Si en
  el navegador ya hay una sesión de otra cuenta, sigue abierta.
- Un login correcto reinicia el contador. Al bloquear, el contador también vuelve a 0, así que al vencer
  el bloqueo hay otros 5 intentos.
- **Desbloquear**: en la web, **Usuarios** → menú de la fila → *Desbloquear* (la cuenta muestra la insignia
  "Bloqueada (N min)"). En la app, **Usuarios** → ⋮ → *Desbloquear*. Por API: `PUT /api/auth/usuarios/:id/desbloquear`
  con JWT de admin. Recuperar la contraseña también levanta el bloqueo.
- Los tiempos se calculan con `NOW()` de la base, no con la hora de cada contenedor.

### Recuperación de contraseña (simulada)

1. En la web, **"¿Olvidaste tu contraseña?"** en el login (`/olvide`). En la app, el botón del mismo nombre.
   Se pide el correo.
2. auth-service responde **siempre el mismo mensaje**, exista o no el correo. Si existe, crea un token
   aleatorio de un solo uso en `password_resets` (solo se guarda su hash sha256), que **vence en 30 minutos**.
   Pedir uno nuevo invalida los anteriores.
3. **No se envía correo**: el enlace (`/restablecer?token=…`, armado con `WEB_PUBLIC_URL`) y el código para la
   app quedan en los logs:
   ```bash
   docker logs agrosense-auth 2>&1 | grep recuperacion
   ```
   Con `DEV_SHOW_RESET_TOKEN=true` en `.env` también se muestran en pantalla: la web enlaza a la página y la app
   precarga el código. **Por defecto es `false`**; déjalo así fuera de desarrollo. En ese modo la respuesta sí
   revela si el correo existe.
4. En la pantalla de contraseña nueva (`/restablecer` en la web, segundo paso en la app) se define una
   contraseña de **mínimo 8 caracteres**. Al usarla, el token queda invalidado. Un token usado, reemplazado,
   vencido o inventado se rechaza con un mensaje claro.

`POST /api/auth/recuperar` (`{ email }`) y `POST /api/auth/restablecer` (`{ token, password }`) son públicas
(sin JWT). La página `/restablecer` se sirve con `Cache-Control: no-store` y `referrer: no-referrer`, para que
el token de la URL no viaje en el `Referer` a la CDN de los íconos.

Pendiente para producción: enviar el correo de verdad, limitar cuántas solicitudes por minuto acepta
`/recuperar` y cerrar las sesiones abiertas al cambiar la contraseña (hoy un JWT ya emitido sigue
valiendo hasta que vence).

### Llamadas entre servicios (`SERVICE_TOKEN`)

Cuando un servicio llama a otro no hay usuario detrás, así que **nunca se reenvía el JWT de un usuario**: se
envía `X-Service-Token: <SERVICE_TOKEN>` y quien lo recibe lo trata como rol `servicio` (equivale a admin).

- simulator → fincas: preparar los datos demo y leer los riegos en curso.
- fincas (motor de riego) → simulator `/reloj`.
- lecturas → simulator `/clima` (solo si el proveedor es el simulador; a un `CLIMA_PROVIDER_URL` externo no se le envía).
- simulator → lecturas `POST /api/lecturas` sigue usando la `x-api-key` de cada estación, como un sensor real.

### Web y app

- **web-admin** guarda el JWT en una cookie `httpOnly` y lo reenvía como `Authorization: Bearer` en cada
  llamada a los servicios (interceptor de axios + `AsyncLocalStorage` en `web-admin/src/app.js`). Si un servicio
  responde 401 de sesión, borra la cookie y redirige a `/login?sesion=expirada`.
- **App Flutter**: todas las peticiones pasan por `ApiClient` (`mobile-app/lib/services/api_client.dart`), que
  agrega el token guardado. Ante un 401 de sesión borra la sesión y vuelve al login. Solo login y auto-registro
  van sin token.

### Variables y secretos

`DEV_SHOW_RESET_TOKEN` (por defecto `false`) y `WEB_PUBLIC_URL` (por defecto `http://localhost:8080`) configuran la
recuperación de contraseña; si no están en `.env` se usan esos valores.
`JWT_SECRET` y `SERVICE_TOKEN` viven **solo en `.env`** (ya está en `.gitignore`); `docker-compose.yml` y
`docker-compose.test.yml` los toman de ahí (`${JWT_SECRET}`, `${SERVICE_TOKEN}`) y fallan al levantar si faltan.
Genera valores largos y aleatorios, distintos en cada ambiente, por ejemplo con `openssl rand -hex 32`.
Ojo: el ambiente de pruebas también los interpola desde `.env` (no desde `.env.test`), igual que la contraseña
de la base.

### Obtener un token para probar con curl

```bash
# escribe tu contraseña cuando la pida; el token queda solo en la variable de esta terminal
read -rsp "Contraseña: " PASS; echo
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"tu-correo@ejemplo.com\",\"password\":\"$PASS\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
unset PASS
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/auth/me
```

## Monitoreo con Uptime Kuma

Cada servicio HTTP responde `GET /health` con `{"status":"ok", ...}` sin pedir sesión, y cada contenedor
tiene un healthcheck de Docker (`docker compose ps` muestra `healthy` / `unhealthy`). El etl-service no
expone HTTP: su bucle principal escribe un archivo de latido (`/tmp/etl_heartbeat`) cada 30 s y
`healthcheck.py` lo marca `unhealthy` si pasa más de 120 s sin actualizarse.

### 1. Crear la cuenta de administración

1. Levanta el ambiente (`docker compose up --build -d`) y abre <http://localhost:3010>.
2. La primera vez pide crear un usuario administrador: elige usuario y contraseña (se guardan en el
   volumen `uptime_data`, así que sobreviven a `docker compose down`; se borran con `down -v`).

### 2. Agregar los monitores HTTP

Uptime Kuma corre dentro de la red de Docker, así que usa los **nombres de servicio y el puerto interno
3000**, no `localhost` ni los puertos publicados. Para cada fila de la tabla:

1. Clic en **+ Agregar monitor** (*Add New Monitor*).
2. **Tipo de monitor**: `HTTP(s)`.
3. **Nombre amigable** y **URL**: según la tabla.
4. **Intervalo de latido** (*Heartbeat Interval*): `30` segundos.
5. **Reintentos** (*Retries*): `2` (evita falsas alarmas mientras un servicio se reinicia).
6. **Guardar**.

| Nombre | URL (desarrollo) | URL (pruebas, puerto 4010) |
|---|---|---|
| Auth | `http://auth-service:3000/health` | `http://auth-service-test:3000/health` |
| Fincas | `http://fincas-service:3000/health` | `http://fincas-service-test:3000/health` |
| Lecturas | `http://lecturas-service:3000/health` | `http://lecturas-service-test:3000/health` |
| Simulador | `http://simulator-service:3000/health` | `http://simulator-service-test:3000/health` |
| Respaldos | `http://backup-service:3000/health` | `http://backup-service-test:3000/health` |
| Panel web | `http://web-admin:3000/health` | `http://web-admin-test:3000/health` |

Opcional, para la base de datos: monitor tipo **TCP Port**, nombre `MariaDB`, host `mysql`
(`mysql-test` en pruebas), puerto `3306`, intervalo 30 s.

### 3. Monitorear el ETL

Como el ETL no tiene URL, se vigila su healthcheck de Docker:

1. Agrega `/var/run/docker.sock:/var/run/docker.sock:ro` a los `volumes` de `uptime-kuma` en
   `docker-compose.yml` y recrea el contenedor (`docker compose up -d uptime-kuma`).
   Ojo: el socket da a Uptime Kuma control sobre Docker; úsalo solo en tu PC.
2. En Uptime Kuma: **Configuración → Docker Hosts → Configurar Docker Host**, nombre `local`,
   tipo `Socket`, ruta `/var/run/docker.sock`.
3. Nuevo monitor tipo **Docker Container**, nombre `ETL`, contenedor `agrosense-etl`, host `local`,
   intervalo 30 s. Se pone en rojo si el contenedor se detiene o queda `unhealthy`.

Sin el socket, revísalo a mano con `docker inspect --format '{{.State.Health.Status}}' agrosense-etl`.

### 4. Armar la página de estado

1. Menú **Páginas de estado** (*Status Pages*) → **+ Nueva página de estado**.
2. **Nombre**: `AgroSense`; **Slug**: `agrosense` → **Siguiente**.
3. En el editor, **+ Agregar grupo**, por ejemplo:
   - `Servicios`: Auth, Fincas, Lecturas, Simulador, Respaldos.
   - `Datos`: MariaDB, ETL.
   - `Interfaz`: Panel web.
4. En cada grupo, usa **Agregar un monitor** para elegir los monitores creados arriba.
5. Opcional: descripción, texto del pie y marcar **Mostrar etiquetas**.
6. **Guardar**. La página queda pública en <http://localhost:3010/status/agrosense> (sin login).

Para avisos, en **Configuración → Notificaciones** puedes conectar Telegram, Discord, correo, etc.,
y activarlas en cada monitor.

## Cómo levantar el ambiente de PRUEBAS local

Igual, pero copiando `.env.example` a `.env.test` (puedes usar la misma base de datos de contraseña o cambiarla) y:

```bash
docker compose -f docker-compose.test.yml up --build
```

Corre en los puertos de la columna "Pruebas" de la tabla de arriba, para que puedas tener desarrollo
y pruebas corriendo **al mismo tiempo** sin que choquen. Si ese ambiente ya tenía una base, aplícale
las migraciones (ver arriba) en `agrosense-mysql-test`.

## Flujo de Git para el equipo

**Ramas:**
- `main` → siempre estable, lo que eventualmente se despliega.
- `develop` → integración de las features del equipo.
- `feature/nombre-corto` → una rama por tarea/historia (ej. `feature/login-web`, `feature/etl-resumen-diario`).

**Flujo de trabajo:**
1. Crear rama desde `develop`: `git checkout -b feature/mi-tarea develop`
2. Hacer commits pequeños y frecuentes (esto es requisito del curso — se revisa el historial).
3. Subir la rama: `git push origin feature/mi-tarea`
4. Abrir Pull Request hacia `develop`, que otro miembro del equipo revise antes de mergear.
5. Cuando `develop` esté estable, se mergea a `main`.

**Convención de commits sugerida:**
```
feat: agregar endpoint de login
fix: corregir cálculo de alerta por temperatura
docs: actualizar README con instrucciones de docker
chore: configurar docker-compose de pruebas
```

## Próximos pasos

1. Levantar el ambiente local y verificar que los 3 microservicios + web admin respondan.
2. Inicializar el proyecto Flutter en `mobile-app/` (ver su README).
3. Diagramas UML (casos de uso, clases, secuencia) en `docs/`.
4. Cuando el equipo confirme que todo funciona local, se define el hosting en la nube
   y se arma `k8s/` para el despliegue (siguiente fase).
