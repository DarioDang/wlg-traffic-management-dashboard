"""Print shell exports (DBT_HOST, ...) built from a Postgres URL.

Usage from the repo root:  eval "$(python dbt/env_from_url.py DATABASE_URL)"
Reads the variable from the environment, or from the repo's .env file.
"""

import os
import shlex
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

def read_dotenv(path):
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out

name = sys.argv[1]
env_file = Path(__file__).resolve().parent.parent / ".env"
raw = os.environ.get(name) or read_dotenv(env_file).get(name)
if not raw:
    sys.exit(f"{name} was not found in the environment or in .env")

url = urlparse(raw)
values = {
    "DBT_HOST": url.hostname or "",
    "DBT_PORT": str(url.port or 5432),
    "DBT_USER": unquote(url.username or ""),
    "DBT_PASSWORD": unquote(url.password or ""),
    "DBT_DBNAME": url.path.lstrip("/"),
}
for key, value in values.items():
    print(f"export {key}={shlex.quote(value)}")
