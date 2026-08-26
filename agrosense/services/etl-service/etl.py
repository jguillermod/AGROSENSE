"""
ETL de AgroSense
Extrae lecturas crudas de sensores, las agrega (promedio diario por parcela)
y las carga en la tabla `reportes_diarios` para consulta/descarga desde el sitio web admin.
"""

import os
import time
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

engine = create_engine(
    f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)


def extraer():
    query = """
        SELECT l.estacion_id, e.parcela_id, l.humedad_suelo, l.temperatura,
               l.humedad_ambiental, l.fecha
        FROM lecturas l
        JOIN estaciones e ON e.id = l.estacion_id
        WHERE l.fecha >= NOW() - INTERVAL 1 DAY
    """
    return pd.read_sql(query, engine)


def transformar(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    df["dia"] = pd.to_datetime(df["fecha"]).dt.date

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


def ejecutar_job():
    print("[ETL] Iniciando corrida...")
    df_crudo = extraer()
    df_resumen = transformar(df_crudo)
    cargar(df_resumen)
    print("[ETL] Corrida terminada.")


if __name__ == "__main__":
    # Corre una vez al iniciar y luego según el cron definido en ETL_SCHEDULE_CRON (por defecto cada hora)
    ejecutar_job()
    schedule.every(1).hours.do(ejecutar_job)

    while True:
        schedule.run_pending()
        time.sleep(30)
