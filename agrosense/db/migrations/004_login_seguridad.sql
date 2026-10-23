-- Migración 004: seguridad del inicio de sesión.
-- - Bloqueo de cuenta: tras 5 intentos fallidos seguidos, 15 minutos sin poder entrar.
-- - Recuperación de contraseña con tokens de un solo uso (se guarda solo su hash sha256).
-- Para una base que ya existe. Es repetible y no borra datos:
--
--   docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/004_login_seguridad.sql

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS intentos_fallidos INT NOT NULL DEFAULT 0 AFTER foto_url;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_hasta DATETIME NULL AFTER intentos_fallidos;

CREATE TABLE IF NOT EXISTS password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expira_en DATETIME NOT NULL,
    usado_en DATETIME NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_password_resets_usuario (usuario_id)
);
