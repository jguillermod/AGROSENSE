-- Migración 003: alertas con ciclo de vida (activa / atendida / resuelta),
-- alertas climáticas, temperatura mínima (heladas) y riegos omitidos.
-- Para una base que ya existe. Es repetible y no borra datos:
--
--   docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/003_alertas_clima.sql

-- --- Alertas ---
-- Las alertas climáticas no vienen de una estación
ALTER TABLE alertas MODIFY estacion_id INT NULL;

ALTER TABLE alertas ADD COLUMN IF NOT EXISTS categoria ENUM('sensor', 'climatica') NOT NULL DEFAULT 'sensor' AFTER tipo;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS severidad ENUM('info', 'media', 'alta') NOT NULL DEFAULT 'media' AFTER categoria;
-- Se agrega con DEFAULT 'resuelta' para que las alertas que ya existían
-- (una por lectura, sin ciclo de vida) queden resueltas; después el default
-- pasa a 'activa' para las nuevas.
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS estado ENUM('activa', 'atendida', 'resuelta') NOT NULL DEFAULT 'resuelta' AFTER severidad;
ALTER TABLE alertas ALTER COLUMN estado SET DEFAULT 'activa';
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS detalle VARCHAR(255) NULL AFTER estado;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS repeticiones INT NOT NULL DEFAULT 1 AFTER detalle;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS ultimo_valor DECIMAL(6,2) NULL AFTER repeticiones;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS ultima_lectura_en TIMESTAMP NULL AFTER ultimo_valor;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS atendida_por INT NULL AFTER ultima_lectura_en;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS atendida_en TIMESTAMP NULL AFTER atendida_por;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS resuelta_en TIMESTAMP NULL AFTER atendida_en;
-- Clave que solo existe mientras la alerta sigue vigente (activa o atendida):
-- el índice único garantiza una sola alerta vigente por (parcela, tipo).
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS clave_vigente VARCHAR(160)
    AS (IF(estado IN ('activa', 'atendida'), CONCAT(parcela_id, ':', tipo), NULL)) PERSISTENT;

UPDATE alertas SET resuelta_en = fecha WHERE estado = 'resuelta' AND resuelta_en IS NULL;
UPDATE alertas SET ultima_lectura_en = fecha WHERE ultima_lectura_en IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alertas_vigente ON alertas (clave_vigente);
CREATE INDEX IF NOT EXISTS idx_alertas_estado ON alertas (estado, severidad);

-- FK de atendida_por (se agrega solo si todavía no existe)
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'alertas' AND CONSTRAINT_NAME = 'fk_alertas_atendida_por');
SET @sql := IF(@fk = 0,
  'ALTER TABLE alertas ADD CONSTRAINT fk_alertas_atendida_por FOREIGN KEY (atendida_por) REFERENCES usuarios(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- --- Parcelas: temperatura mínima para alertas de helada ---
ALTER TABLE parcelas ADD COLUMN IF NOT EXISTS temperatura_min DECIMAL(5,2) DEFAULT 5.00 AFTER temperatura_max;

-- --- Riego: ejecuciones omitidas (p. ej. por lluvia) ---
ALTER TABLE riego_eventos MODIFY estado ENUM('en_curso', 'completado', 'cancelado', 'omitido') NOT NULL DEFAULT 'en_curso';
ALTER TABLE riego_eventos ADD COLUMN IF NOT EXISTS motivo VARCHAR(255) NULL AFTER estado;
