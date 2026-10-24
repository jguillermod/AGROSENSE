"""
ETL de AgroSense
Extrae lecturas crudas de sensores, las agrega (promedio diario por parcela)
y las carga en la tabla `reportes_diarios` para consulta/descarga desde el sitio web admin.

Los días son los de APP_TIMEZONE (America/Guatemala), no los de UTC. Cada
corrida rehace los días completos desde la medianoche local de hace N días
(por defecto 1: ayer completo y lo que va de hoy).

Uso:
  python etl.py                      # servicio: corre al iniciar y cada ETL_INTERVAL_MINUTES
  python etl.py --dias 15 --una-vez  # rehace los reportes de los últimos 15 días y termina
"""

import argparse
import os
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import schedule
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME")
ZONA = ZoneInfo(os.getenv("APP_TIMEZONE", "America/Guatemala"))

# Archivo de latido: el bucle principal lo actualiza en cada vuelta y el
# healthcheck de Docker (healthcheck.py) revisa que no esté viejo
HEARTBEAT_FILE = os.getenv("ETL_HEARTBEAT_FILE", "/tmp/etl_heartbeat")

engine = create_engine(
    f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)


def inicio_ventana(dias: int) -> datetime:
    """Medianoche local de hace `dias` días, en UTC sin zona (como la guarda la base)."""
    hoy_local = datetime.now(ZONA).replace(hour=0, minute=0, second=0, microsecond=0)
    return (hoy_local - timedelta(days=dias)).astimezone(timezone.utc).replace(tzinfo=None)


def extraer(dias: int):
    # la base guarda los TIMESTAMP en UTC; se piden días locales completos
    query = text("""
        SELECT l.estacion_id, e.parcela_id, l.humedad_suelo, l.temperatura,
               l.humedad_ambiental, l.fecha
        FROM lecturas l
        JOIN estaciones e ON e.id = l.estacion_id
        WHERE l.fecha >= :desde
    """)
    return pd.read_sql(query, engine, params={"desde": inicio_ventana(dias)})


def transformar(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    # día local (Guatemala) de cada lectura
    df["dia"] = pd.to_datetime(df["fecha"]).dt.tz_localize("UTC").dt.tz_convert(ZONA).dt.date

    resumen = (
        df.groupby(["parcela_id", "dia"])
        .agg(
            humedad_promedio=("humedad_suelo", "mean"),
            temperatura_promedio=("temperatura", "mean"),
            humedad_ambiental_promedio=("humedad_ambiental", "mean"),
            lecturas_totales=("estacion_id", "count"),
        )
        .reset_index()
    )
    return resumen


def cargar(df: pd.DataFrame):
    if df.empty:
        print("[ETL] Sin datos nuevos que procesar.")
        return

    with engine.begin() as conn:
        for _, row in df.iterrows():
            conn.execute(
                text(
                    """
                    INSERT INTO reportes_diarios
                        (parcela_id, dia, humedad_promedio, temperatura_promedio,
                         humedad_ambiental_promedio, lecturas_totales)
                    VALUES
                        (:parcela_id, :dia, :humedad_promedio, :temperatura_promedio,
                         :humedad_ambiental_promedio, :lecturas_totales)
                    ON DUPLICATE KEY UPDATE
                        humedad_promedio = VALUES(humedad_promedio),
                        temperatura_promedio = VALUES(temperatura_promedio),
                        humedad_ambiental_promedio = VALUES(humedad_ambiental_promedio),
                        lecturas_totales = VALUES(lecturas_totales)
                    """
                ),
                row.to_dict(),
            )
    print(f"[ETL] {len(df)} registros de resumen actualizados.")


def latido():
    with open(HEARTBEAT_FILE, "w") as f:
        f.write(str(int(time.time())))


def ejecutar_job(dias: int = 1):
    print(f"[ETL] Iniciando corrida (desde hace {dias} día(s), hora local)...")
    df_crudo = extraer(dias)
    df_resumen = transformar(df_crudo)
    cargar(df_resumen)
    print("[ETL] Corrida terminada.")


if __name__ == "__main__":
    argumentos = argparse.ArgumentParser(description="ETL de reportes diarios de AgroSense")
    argumentos.add_argument("--dias", type=int, default=1, help="días hacia atrás a rehacer (por defecto 1)")
    argumentos.add_argument("--una-vez", action="store_true", help="corre una sola vez y termina")
    args = argumentos.parse_args()
    dias = max(0, args.dias)

    if args.una_vez:
        ejecutar_job(dias)
        raise SystemExit(0)

    # Corre una vez al iniciar y luego cada ETL_INTERVAL_MINUTES (por defecto 60;
    # docker-compose.yml lo pone en 5 para que la gráfica del dashboard avance
    # durante el día)
    try:
        intervalo = max(1, int(os.getenv("ETL_INTERVAL_MINUTES", "60")))
    except ValueError:
        intervalo = 60
    print(f"[ETL] Corriendo cada {intervalo} minutos.")
    ejecutar_job(dias)
    schedule.every(intervalo).minutes.do(ejecutar_job, dias)

    while True:
        schedule.run_pending()
        latido()
        time.sleep(30)
