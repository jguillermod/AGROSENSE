-- Migración 005: cultivos a nivel de finca o de parcela.
-- - cultivos.finca_id (obligatorio): la finca del cultivo.
-- - cultivos.parcela_id pasa a ser opcional: NULL = cultivo "de la finca"
--   (varias parcelas o la finca completa). Si viene, debe ser de esa finca
--   (lo valida fincas-service).
-- - Al borrar una parcela sus cultivos quedan en la finca (parcela_id = NULL);
--   al borrar una finca se borran sus cultivos.
-- Para una base que ya existe. Es repetible y no borra datos:
--
--   docker exec -i agrosense-mysql sh -c 'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/005_cultivos_finca.sql

ALTER TABLE cultivos ADD COLUMN IF NOT EXISTS finca_id INT NULL AFTER id;

-- Los cultivos existentes toman la finca de su parcela
UPDATE cultivos c JOIN parcelas p ON p.id = c.parcela_id
SET c.finca_id = p.finca_id
WHERE c.finca_id IS NULL;

-- La llave de parcela_id era ON DELETE CASCADE con nombre automático
-- (cultivos_ibfk_N): se busca por la columna, se quita y se vuelve a crear.
SET @fk_parcela := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cultivos'
    AND COLUMN_NAME = 'parcela_id' AND REFERENCED_TABLE_NAME = 'parcelas'
  LIMIT 1
);
SET @sql := IF(@fk_parcela IS NULL, 'DO 0', CONCAT('ALTER TABLE cultivos DROP FOREIGN KEY `', @fk_parcela, '`'));
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;

ALTER TABLE cultivos MODIFY parcela_id INT NULL;
ALTER TABLE cultivos ADD CONSTRAINT fk_cultivos_parcela
  FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE SET NULL;

ALTER TABLE cultivos MODIFY finca_id INT NOT NULL;
ALTER TABLE cultivos DROP FOREIGN KEY IF EXISTS fk_cultivos_finca;
ALTER TABLE cultivos ADD CONSTRAINT fk_cultivos_finca
  FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE;
