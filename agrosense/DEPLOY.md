# Publicar AgroSense en un servidor (dominio + HTTPS)

Guía para quien publica AgroSense en un servidor propio. Al terminar tendrás:

- El panel web en `https://TU_DOMINIO`, con certificado HTTPS automático (Let's Encrypt, vía Caddy).
- Las APIs de la app móvil en el mismo dominio: `https://TU_DOMINIO/api/auth`, `/api/fincas` y `/api/lecturas`.
- Uptime Kuma, opcional, en un subdominio aparte.
- Nada más expuesto a internet: MariaDB, los microservicios, el servicio de respaldos y el control de las
  estaciones solo se hablan por la red interna de Docker.

Todo se define en `docker-compose.prod.yml` y `caddy/Caddyfile`.

---

## 1. Requisitos del servidor

- Linux de 64 bits (por ejemplo Ubuntu Server 22.04 o 24.04) con IP pública.
- Mínimo **2 vCPU, 4 GB de RAM y 20 GB de disco** (la base crece con las lecturas; deja margen para los respaldos).
- **Docker Engine 24+** con el plugin **Docker Compose v2** (`docker compose version`).
  Instalación oficial: <https://docs.docker.com/engine/install/>.
- `git` y `openssl` (`sudo apt install git openssl`).
- Un **dominio** al que puedas agregarle registros DNS.
- Puertos **80/tcp, 443/tcp y 443/udp** abiertos hacia el servidor (en el firewall del proveedor y en el del sistema).
  Caddy necesita el 80 para validar el certificado y redirigir a HTTPS.

## 2. Apuntar el DNS al servidor

Hazlo **antes** de levantar los servicios: Caddy pide el certificado al arrancar y Let's Encrypt
tiene que poder llegar al servidor por ese nombre.

| Tipo | Nombre | Valor |
|---|---|---|
| A | `agrosense` (o `@`) | IP pública del servidor |
| AAAA | `agrosense` | IPv6 del servidor (solo si tiene) |
| A | `estado` (opcional, para Uptime Kuma) | IP pública del servidor |

Comprueba que ya resuelve (puede tardar unos minutos):

```bash
dig +short agrosense.tudominio.com
```

## 3. Clonar el repositorio

```bash
git clone <URL-del-repositorio> agrosense-repo
cd agrosense-repo/agrosense      # carpeta donde están docker-compose.prod.yml y .env.example
```

## 4. Crear el `.env` con secretos nuevos

Nunca reutilices los secretos de desarrollo y nunca subas el `.env` a Git (ya está en `.gitignore`).

```bash
cp .env.example .env
chmod 600 .env

# secretos nuevos, largos y aleatorios (cada uno distinto)
for clave in JWT_SECRET SERVICE_TOKEN BACKUP_API_TOKEN; do
  sed -i "s|^$clave=.*|$clave=$(openssl rand -hex 32)|" .env
done
for clave in DB_PASSWORD DB_ROOT_PASSWORD; do
  sed -i "s|^$clave=.*|$clave=$(openssl rand -hex 24)|" .env
done
```

Luego edita el `.env` (`nano .env`) y ajusta:

| Variable | Valor en producción |
|---|---|
| `DOMINIO` | `agrosense.tudominio.com` (sin `https://`) |
| `KUMA_DOMINIO` | `estado.tudominio.com`, o vacío para no publicar Uptime Kuma |
| `WEB_PUBLIC_URL` | `https://agrosense.tudominio.com` (se usa en el enlace de recuperación de contraseña) |
| `DEV_SHOW_RESET_TOKEN` | `false` (`docker-compose.prod.yml` igual lo fuerza) |
| `ETL_INTERVAL_MINUTES` | `60` |
| `JWT_SECRET`, `SERVICE_TOKEN`, `BACKUP_API_TOKEN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` | los generados arriba; no los copies a ningún otro lado |

Notas:

- `DB_PASSWORD` y `DB_ROOT_PASSWORD` solo se aplican la **primera vez**, cuando el volumen de la base está
  vacío. Cambiarlas después en el `.env` no cambia la base.
- Si falta `DOMINIO`, `JWT_SECRET`, `SERVICE_TOKEN`, `BACKUP_API_TOKEN` o alguna contraseña de la base,
  `docker compose` se niega a arrancar y te dice cuál.

## 5. Levantar AgroSense

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # todos deben quedar "healthy" (1-2 minutos)
docker compose -f docker-compose.prod.yml logs -f caddy   # verás "certificate obtained successfully"
```

Solo el contenedor `caddy` publica puertos (80 y 443). Los volúmenes persistentes son
`agrosense-prod_mysql_data` (base), `agrosense-prod_backups_data` (respaldos), `agrosense-prod_uploads_data`
(fotos de perfil), `agrosense-prod_uptime_data` (Uptime Kuma) y `agrosense-prod_caddy_data` (certificados).
Todos sobreviven a `down`/`up` y a reinicios del servidor (`restart: unless-stopped`).

> **Nunca** uses `docker compose ... down -v` en producción: `-v` borra esos volúmenes (base, respaldos y certificados).

## 6. Restaurar un respaldo

Si traes los datos de otro ambiente, usa un respaldo `.sql.gz` del backup-service (se descarga desde
**Respaldos** en el panel web). Conserva su nombre original (`agrosense_AAAAMMDD-HHMMSS_manual.sql.gz`).

1. Cópialo al servidor, fuera de la carpeta del repositorio:
   ```bash
   scp agrosense_20261023-175114_manual.sql.gz usuario@servidor:/tmp/
   ```
2. Pásalo al volumen de respaldos y borra la copia suelta:
   ```bash
   docker compose -f docker-compose.prod.yml cp /tmp/agrosense_20261023-175114_manual.sql.gz backup-service:/backups/
   rm /tmp/agrosense_20261023-175114_manual.sql.gz
   ```
3. Entra a `https://TU_DOMINIO` con un usuario **administrador** del respaldo, ve a **Respaldos**, busca el
   archivo, pulsa **Restaurar**, escribe **`RESTAURAR`** (en mayúsculas) y confirma. Antes de restaurar
   se guarda solo un respaldo "de seguridad" del estado actual.
   - Si la base está vacía (instalación nueva) todavía no hay administrador para entrar a la web: restaura con
     la API interna, desde el servidor:
     ```bash
     docker compose -f docker-compose.prod.yml exec -T backup-service node -e '
       const t = require("jsonwebtoken").sign({ id: "restauracion", rol: "admin", email: "restauracion@interno" }, process.env.JWT_SECRET, { expiresIn: "5m" });
       fetch("http://127.0.0.1:3000/backups/" + process.argv[1] + "/restaurar", { method: "POST",
         headers: { Authorization: "Bearer " + t, "x-backup-token": process.env.BACKUP_API_TOKEN } })
         .then(async (r) => console.log(r.status, await r.text()));' agrosense_20261023-175114_manual.sql.gz
     ```
4. No hay más pasos: el servicio de estaciones detecta que sus llaves ya no valen, genera unas nuevas,
   rellena con lecturas el tiempo transcurrido desde el respaldo (hasta 7 días) y sigue enviando. Los
   usuarios entran con las mismas contraseñas de siempre. Las sesiones abiertas en el ambiente anterior
   no sirven aquí (el `JWT_SECRET` es otro): basta con volver a iniciar sesión.

Las **fotos de perfil** no van en el respaldo de la base (son archivos). Si las necesitas, cópialas aparte
desde el volumen de fotos del ambiente anterior a `web-admin:/app/public/uploads/avatars/`.

Sin respaldo (instalación desde cero): registra tu cuenta en la web, hazla administradora y, si quieres,
carga los datos iniciales (ver README, *Datos iniciales*):

```bash
docker compose -f docker-compose.prod.yml exec mysql sh -c \
  'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "UPDATE usuarios SET rol=\"admin\" WHERE email=\"tu@correo.com\""'
```

## 7. Verificar

```bash
curl https://TU_DOMINIO/api/auth/health        # {"status":"ok","service":"auth-service"}
curl https://TU_DOMINIO/api/fincas/health      # {"status":"ok","service":"fincas-service"}
curl https://TU_DOMINIO/api/lecturas/health    # {"status":"ok","service":"lecturas-service"}
curl -I http://TU_DOMINIO                      # 308 hacia https://
```

- Abre `https://TU_DOMINIO`, inicia sesión y revisa dashboard, lecturas en vivo, alertas y riego.
- Lo que **no** debe responder desde internet (404): `https://TU_DOMINIO/backups`, `/status`, `/reloj`,
  `/clima` y `/phpmyadmin`.
- **Uptime Kuma** (si definiste `KUMA_DOMINIO`): abre `https://estado.tudominio.com` **enseguida** y crea la
  cuenta de administración con una contraseña fuerte (el primero que entra la crea). Agrega monitores HTTP
  con las URLs internas: `http://auth-service:3000/health`, `http://fincas-service:3000/health`,
  `http://lecturas-service:3000/health`, `http://simulator-service:3000/health` (Estaciones),
  `http://backup-service:3000/health` y `http://web-admin:3000/health` (detalles en el README, *Monitoreo
  con Uptime Kuma*). Kuma guarda en caché las IP de los servicios: después de cada `up --build` ejecuta
  `docker compose -f docker-compose.prod.yml restart uptime-kuma` (o desactiva su caché DNS en
  *Configuración*) para que no marque falsos caídos.

## 8. App móvil

Compila la app con la URL pública (sin ella usa las direcciones de desarrollo):

```bash
cd mobile-app
flutter build apk --release --dart-define=API_BASE_URL=https://TU_DOMINIO
```

## 9. Actualizar y respaldar

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml restart uptime-kuma
```

El backup-service hace un respaldo automático cada 24 h y guarda 7 días. **Saca copias fuera del servidor**
con regularidad (Respaldos → Descargar) y guárdalas cifradas: contienen hashes de contraseñas.

## 10. Checklist de seguridad

- [ ] `.env` creado en el servidor con secretos **nuevos** (`openssl rand -hex 32`), distintos a los de desarrollo, y con `chmod 600`.
- [ ] `.env` y los respaldos `.sql.gz` **nunca** en Git ni en carpetas compartidas.
- [ ] `DEV_SHOW_RESET_TOKEN=false` y `WEB_PUBLIC_URL` con `https://`.
- [ ] Solo los puertos 22, 80 y 443 abiertos en el firewall (`sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable`). Docker publica únicamente los de Caddy.
- [ ] `docker compose -f docker-compose.prod.yml ps` muestra puertos publicados **solo** en `caddy`.
- [ ] `https://TU_DOMINIO/backups`, `/status` y `/phpmyadmin` responden 404.
- [ ] El certificado es válido (candado en el navegador) y `http://` redirige a `https://`.
- [ ] Uptime Kuma: cuenta de administración creada con contraseña fuerte, o `KUMA_DOMINIO` vacío.
- [ ] Contraseñas de administradores de AgroSense fuertes y únicas; cuentas de prueba o antiguas eliminadas.
- [ ] Acceso SSH solo con llave (sin contraseña) y usuario sin privilegios para el día a día.
- [ ] Copias de los respaldos fuera del servidor, y una restauración probada al menos una vez.
- [ ] Actualizaciones del sistema operativo y de Docker al día (`sudo apt update && sudo apt upgrade`).
