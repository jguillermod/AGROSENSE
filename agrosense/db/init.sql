-- Schema inicial AgroSense
-- Se ejecuta automáticamente al levantar el contenedor de MySQL por primera vez.

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('admin', 'agricultor') NOT NULL DEFAULT 'agricultor',
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
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (finca_id) REFERENCES fincas(id)
);

CREATE TABLE IF NOT EXISTS estaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    parcela_id INT NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id)
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

CREATE TABLE IF NOT EXISTS alertas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parcela_id INT NOT NULL,
    estacion_id INT NOT NULL,
    tipo VARCHAR(100) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parcela_id) REFERENCES parcelas(id),
    FOREIGN KEY (estacion_id) REFERENCES estaciones(id)
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
