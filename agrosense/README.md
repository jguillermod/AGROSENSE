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
│   ├── lecturas-service/       # Recibe datos del ESP32, alertas, historial (Node/Express)
│   ├── simulator-service/      # Simula los sensores: datos demo + lecturas periódicas (Node/Express)
│   └── etl-service/            # Resúmenes diarios (Python + pandas)
├── web-admin/                  # Sitio web administrativo (Node + EJS)
├── mobile-app/                 # App Flutter (agricultor)
├── db/init.sql                 # Schema inicial de la base de datos
├── db/migrations/              # Cambios de schema para bases que ya existen (ver abajo)
├── k8s/                        # Manifiestos de Kubernetes (fase de despliegue)
└── docs/                       # Diagramas UML, manual de usuario, etc.
```

## Cómo levantar el ambiente de DESARROLLO local

1. Copiar `.env.example` a `.env` y ajustar contraseñas.
2. Levantar todo:
   ```bash
   docker compose up --build
   ```
3. Servicios disponibles:
   - Web admin: http://localhost:8080
   - Auth service: http://localhost:3001
   - Fincas service: http://localhost:3002
   - Lecturas service: http://localhost:3003
   - Simulador de sensores: http://localhost:3004 (ver "Simulación" abajo)
   - phpMyAdmin: http://localhost:8081
4. Para apagar: `docker compose down` (agregar `-v` si además quieres borrar los datos de la DB).

## Migraciones de base de datos

`db/init.sql` solo corre cuando el volumen de MySQL está vacío. Si tu base ya tiene datos,
aplica los scripts nuevos de `db/migrations/` (son idempotentes, no borran nada):

```bash
docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/001_cultivos.sql
docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/002_riego.sql
```

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

Control:

```bash
curl http://localhost:3004/status
curl -X POST http://localhost:3004/scenario -H "Content-Type: application/json" -d '{"nombre":"sequia"}'
# escenarios: normal | sequia | ola_calor | exceso_lluvia
curl -X POST http://localhost:3004/pause
curl -X POST http://localhost:3004/resume
curl -X POST http://localhost:3004/speed -H "Content-Type: application/json" -d '{"intervalo":5}'
```

Los escenarios llevan los valores poco a poco más allá de los umbrales de cada parcela,
así que las alertas que aparecen son las que genera el lecturas-service de verdad.

## Cómo levantar el ambiente de PRUEBAS local

Igual, pero copiando `.env.example` a `.env.test` (puedes usar la misma base de datos de contraseña o cambiarla) y:

```bash
docker compose -f docker-compose.test.yml up --build
```

Corre en puertos distintos (4001, 4002, 4003, simulador en 4004, 8090, mysql en 3316) para que puedas tener
desarrollo y pruebas corriendo **al mismo tiempo** sin que choquen.

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
