-- Migración 002: programación de riego
-- Para una base que ya existe (init.sql solo corre con el volumen vacío).
-- Es idempotente y no borra datos:
--
--   docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/002_riego.sql

ALTER TABLE parcelas ADD COLUMN IF NOT EXISTS riego_automatico BOOLEAN NOT NULL DEFAULT FALSE AFTER temperatura_max;

CREATE TABLE IF NOT EXISTS riego_programaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    dias_semana VARCHAR(20) NOT NULL,
    hora_inicio TIME NOT NULL,
    duracion_minutos INT NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS riego_eventos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    programacion_id INT NULL,
    origen ENUM('programado', 'manual', 'automatico') NOT NULL,
    inicio DATETIME NOT NULL,
    fin DATETIME NULL,
    duracion_minutos INT NOT NULL,
    estado ENUM('en_curso', 'completado', 'cancelado') NOT NULL DEFAULT 'en_curso',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE,
    FOREIGN KEY (programacion_id) REFERENCES riego_programaciones(id) ON DELETE SET NULL,
    INDEX idx_riego_eventos_estado (estado),
    INDEX idx_riego_eventos_parcela_inicio (parcela_id, inicio)
);
