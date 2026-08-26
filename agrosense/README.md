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
│   └── etl-service/            # Resúmenes diarios (Python + pandas)
├── web-admin/                  # Sitio web administrativo (Node + EJS)
├── mobile-app/                 # App Flutter (agricultor)
├── db/init.sql                 # Schema inicial de la base de datos
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
   - phpMyAdmin: http://localhost:8081
4. Para apagar: `docker compose down` (agregar `-v` si además quieres borrar los datos de la DB).

## Cómo levantar el ambiente de PRUEBAS local

Igual, pero copiando `.env.example` a `.env.test` (puedes usar la misma base de datos de contraseña o cambiarla) y:

```bash
docker compose -f docker-compose.test.yml up --build
```

Corre en puertos distintos (4001, 4002, 4003, 8090, mysql en 3316) para que puedas tener
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
