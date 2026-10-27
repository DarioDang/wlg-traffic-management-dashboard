import os
from dotenv import load_dotenv

load_dotenv()

CRON_SECRET = os.getenv("CRON_SECRET")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "30"))
STALE_AFTER_MINUTES = int(os.getenv("STALE_AFTER_MINUTES", "30"))