import os
from dotenv import load_dotenv

load_dotenv()

API_URL = "https://trafficnz.info/service/traffic/rest/4/events/all/10"
REGION_ID = "9"            # Wellington region (includes Wairarapa)
HTTP_TIMEOUT = 30
DATABASE_URL = os.getenv("NEON_DATABASE_URL")