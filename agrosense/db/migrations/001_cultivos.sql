-- Migración 001: inventario de cultivos
-- init.sql solo se ejecuta cuando el volumen de MySQL está vacío; para una
-- base que ya existe, aplicar este script a mano (es idempotente):
--
--   docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/001_cultivos.sql
--
-- (En el ambiente de pruebas: contenedor agrosense-mysql-test.)

CREATE TABLE IF NOT EXISTS cultivos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    tipo VARCHAR(100) NOT NULL,
    variedad VARCHAR(100) NULL,
    fecha_siembra DATE NOT NULL,
    fecha_cosecha_estimada DATE NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    unidad ENUM('plantas', 'kg', 'quintales') NOT NULL DEFAULT 'plantas',
    estado ENUM('sembrado', 'en_crecimiento', 'cosechado') NOT NULL DEFAULT 'sembrado',
    notas TEXT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE,
    INDEX idx_cultivos_estado (estado)
);
