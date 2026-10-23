"""
Healthcheck del ETL (lo usa Docker): sano si el archivo de latido existe y se
actualizó hace menos de ETL_HEARTBEAT_MAX_SECONDS (por defecto 120 s; el bucle
principal lo toca cada 30 s).
"""

import os
import sys
import time

HEARTBEAT_FILE = os.getenv("ETL_HEARTBEAT_FILE", "/tmp/etl_heartbeat")
MAX_EDAD = int(os.getenv("ETL_HEARTBEAT_MAX_SECONDS", "120"))

try:
    edad = time.time() - os.path.getmtime(HEARTBEAT_FILE)
except OSError:
    print(f"Sin latido: no existe {HEARTBEAT_FILE}")
    sys.exit(1)

if edad > MAX_EDAD:
    print(f"Latido viejo: hace {int(edad)} s")
    sys.exit(1)

print(f"OK: último latido hace {int(edad)} s")
