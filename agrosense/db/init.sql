-- Schema inicial AgroSense
-- Se ejecuta automáticamente al levantar el contenedor de MySQL por primera vez.

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    -- agronomo: rol de solo lectura para quien va a campo; solo ve las
    -- parcelas que el admin le asignó en usuario_parcelas (RF-08).
    rol ENUM('admin', 'agricultor', 'agronomo') NOT NULL DEFAULT 'agricultor',
    foto_url VARCHAR(255) NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fincas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    ubicacion VARCHAR(255),
    usuario_id INT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS parcelas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    finca_id INT NOT NULL,
    humedad_min DECIMAL(5,2) DEFAULT 30.00,
    humedad_max DECIMAL(5,2) DEFAULT 85.00,
    temperatura_max DECIMAL(5,2) DEFAULT 38.00,
    -- Debajo de esta temperatura se genera la alerta de helada
    temperatura_min DECIMAL(5,2) DEFAULT 5.00,
    -- Si está activo, el motor de riego riega solo cuando la humedad baja del mínimo
    riego_automatico BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (finca_id) REFERENCES fincas(id)
);

CREATE TABLE IF NOT EXISTS estaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    parcela_id INT NOT NULL,
    api_key_hash CHAR(64) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id)
);

-- Tokens de un solo uso para vincular un sensor físico a una parcela (RF-06)
CREATE TABLE IF NOT EXISTS sensor_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token CHAR(32) NOT NULL UNIQUE,
    parcela_id INT NOT NULL,
    estado ENUM('pendiente', 'usado', 'expirado') NOT NULL DEFAULT 'pendiente',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expira_en TIMESTAMP NOT NULL,
    usado_en TIMESTAMP NULL,
    estacion_id INT NULL,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id),
    FOREIGN KEY (estacion_id) REFERENCES estaciones(id)
);

CREATE TABLE IF NOT EXISTS lecturas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    estacion_id INT NOT NULL,
    humedad_suelo DECIMAL(5,2) NOT NULL,
    temperatura DECIMAL(5,2) NOT NULL,
    humedad_ambiental DECIMAL(5,2) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estacion_id) REFERENCES estaciones(id),
    INDEX idx_estacion_fecha (estacion_id, fecha)
);

-- Una alerta vigente (activa o atendida) por (parcela, tipo): mientras la
-- condición sigue se actualiza (repeticiones, último valor) y al terminar se
-- marca resuelta. Las climáticas no tienen estación.
-- (Columnas de ciclo de vida: ver db/migrations/003_alertas_clima.sql.)
CREATE TABLE IF NOT EXISTS alertas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    estacion_id INT NULL,
    tipo VARCHAR(100) NOT NULL,
    categoria ENUM('sensor', 'climatica') NOT NULL DEFAULT 'sensor',
    severidad ENUM('info', 'media', 'alta') NOT NULL DEFAULT 'media',
    estado ENUM('activa', 'atendida', 'resuelta') NOT NULL DEFAULT 'activa',
    detalle VARCHAR(255) NULL,
    repeticiones INT NOT NULL DEFAULT 1,
    ultimo_valor DECIMAL(6,2) NULL,
    ultima_lectura_en TIMESTAMP NULL,
    atendida_por INT NULL,
    atendida_en TIMESTAMP NULL,
    resuelta_en TIMESTAMP NULL,
    clave_vigente VARCHAR(160) AS (IF(estado IN ('activa', 'atendida'), CONCAT(parcela_id, ':', tipo), NULL)) PERSISTENT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id),
    FOREIGN KEY (estacion_id) REFERENCES estaciones(id),
    CONSTRAINT fk_alertas_atendida_por FOREIGN KEY (atendida_por) REFERENCES usuarios(id) ON DELETE SET NULL,
    UNIQUE KEY uq_alertas_vigente (clave_vigente),
    INDEX idx_alertas_estado (estado, severidad)
);

-- Parcelas asignadas a cada usuario (un agricultor puede tener varias)
CREATE TABLE IF NOT EXISTS usuario_parcelas (
    usuario_id INT NOT NULL,
    parcela_id INT NOT NULL,
    PRIMARY KEY (usuario_id, parcela_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE
);

-- Registro manual de campo por parcela: humedad/temperatura observadas a
-- ojo y/o anotaciones libres, cargadas por quien tenga esa parcela
-- asignada (o el admin, en cualquiera). Es independiente de "lecturas"
-- (que llenan los sensores físicos): no participa en el cálculo de
-- "estado" ni en las gráficas, es una bitácora de campo aparte.
CREATE TABLE IF NOT EXISTS registros_manuales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    usuario_id INT NOT NULL,
    humedad_suelo DECIMAL(5,2) NULL,
    temperatura DECIMAL(5,2) NULL,
    anotaciones TEXT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Inventario de cultivos por parcela. Se borra junto con su parcela,
-- igual que registros_manuales y usuario_parcelas.
-- (Copia de db/migrations/001_cultivos.sql para bases que ya existían.)
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

-- Programación de riego por parcela (copia de db/migrations/002_riego.sql).
-- dias_semana: letras separadas por coma, L,M,X,J,V,S,D (X = miércoles).
-- hora_inicio y duracion_minutos se interpretan con el reloj del motor de
-- riego (el simulado durante la demo, el real en producción).
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

-- Bitácora de riegos. inicio/fin son DATETIME (sin zona horaria) en el
-- mismo reloj del motor; creado_en es la hora real de registro.
CREATE TABLE IF NOT EXISTS riego_eventos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    programacion_id INT NULL,
    origen ENUM('programado', 'manual', 'automatico') NOT NULL,
    inicio DATETIME NOT NULL,
    fin DATETIME NULL,
    duracion_minutos INT NOT NULL,
    estado ENUM('en_curso', 'completado', 'cancelado', 'omitido') NOT NULL DEFAULT 'en_curso',
    motivo VARCHAR(255) NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE,
    FOREIGN KEY (programacion_id) REFERENCES riego_programaciones(id) ON DELETE SET NULL,
    INDEX idx_riego_eventos_estado (estado),
    INDEX idx_riego_eventos_parcela_inicio (parcela_id, inicio)
);

-- Tabla que llena el servicio ETL con los resúmenes diarios
CREATE TABLE IF NOT EXISTS reportes_diarios (
    parcela_id INT NOT NULL,
    dia DATE NOT NULL,
    humedad_promedio DECIMAL(5,2),
    temperatura_promedio DECIMAL(5,2),
    humedad_ambiental_promedio DECIMAL(5,2),
    lecturas_totales INT,
    PRIMARY KEY (parcela_id, dia),
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id)
);
