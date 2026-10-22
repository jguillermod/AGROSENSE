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

1. Copiar `.env.example` a `.env` y ajustar contraseñas.
2. Levantar todo:
   ```bash
   docker compose up --build
   ```
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

### Clima simulado

El simulador también tiene clima: estado actual, pronóstico de 24 h simuladas y eventos. Los eventos
aleatorios (`SIM_CLIMA_ALEATORIO`, por defecto ~1 por día simulado) se anuncian con horas de
anticipación, así primero aparecen en el pronóstico y después ocurren.

```bash
curl http://localhost:3004/clima          # ahora, pronóstico y eventos programados
# Evento a mano (horas simuladas); "en_horas" es opcional, para verlo primero en el pronóstico
curl -X POST http://localhost:3004/clima/evento -H "Content-Type: application/json" \
     -d '{"tipo":"helada","duracion_horas":3,"en_horas":4}'
# tipos: lluvia | helada | ola_calor | viento
curl -X DELETE http://localhost:3004/clima/eventos   # cancela los eventos en curso y programados
curl -X POST http://localhost:3004/clima/aleatorio -H "Content-Type: application/json" -d '{"activo":false}'
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

Probar respaldo y restauración (con la API directa):

```bash
curl -X POST http://localhost:3005/backups                    # 1. respaldo manual
curl http://localhost:3005/backups                            # 2. aparece en la lista
curl -o prueba.sql.gz http://localhost:3005/backups/<nombre>/descargar   # 3. descarga (no la subas al repo)
# 4. borra algo de prueba (p. ej. un cultivo desde la web) y restaura:
curl -X POST http://localhost:3005/backups/<nombre>/restaurar
# 5. el dato vuelve. Antes de restaurar se crea un respaldo "seguridad" del estado anterior.
```

Antes de restaurar se crea siempre un respaldo de seguridad. Si el puerto 3005 queda accesible fuera
de tu PC, define `BACKUP_API_TOKEN` (web-admin lo envía en la cabecera `x-backup-token`).

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
