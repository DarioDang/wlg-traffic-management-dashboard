import psycopg2
from pipeline.config import DATABASE_URL


def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("NEON_DATABASE_URL is not set (check your .env)")
    return psycopg2.connect(DATABASE_URL)