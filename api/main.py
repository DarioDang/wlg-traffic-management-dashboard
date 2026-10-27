import hmac
import logging
import threading
import time
from collections import Counter
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from api import settings
from pipeline.classify import classify 
from pipeline.db import get_conn
from pipeline.geo import wkt_to_latlon
from pipeline.ingest import run_ingest

log = logging.getLogger("api")

app = FastAPI(title="Wellington Roadworks API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------- helpers ----------

_cache: dict = {}

def cached(key, fn):
    """Tiny in-process TTL cache so page loads don't wake Neon every time."""
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < settings.CACHE_TTL_SECONDS:
        return hit[1]
    value = fn()
    _cache[key] = (now, value)
    return value

def query(sql, params=()):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()

def _load_events(include_gone):
    where = "" if include_gone else "where in_feed"
    rows = query(
        f"""select event_id, payload, in_feed, first_seen_at, last_seen_at, last_changed_at
            from road_events_current {where} order by event_id"""
    )
    out = []
    for r in rows:
        p = r["payload"]
        kind, coords = wkt_to_latlon(p.get("geometry"))
        out.append({
            "id": r["event_id"],
            "status": p.get("status"),
            "impact": p.get("impact"),
            "closure_type": classify(p),
            "event_type": p.get("eventType"),
            "description": p.get("eventDescription"),
            "comments": p.get("eventComments"),
            "location_area": p.get("locationArea"),
            "highway": (p.get("way") or {}).get("name"),
            "planned": p.get("planned"),
            "start_date": p.get("startDate"),
            "end_date": p.get("endDate"),
            "expected_resolution": p.get("expectedResolution"),
            "alternative_route": p.get("alternativeRoute"),
            "geometry_type": kind,
            "coords": coords,
            "in_feed": r["in_feed"],
            "first_seen_at": r["first_seen_at"],
            "last_seen_at": r["last_seen_at"],
            "last_changed_at": r["last_changed_at"],
        })
    return out

def get_events(include_gone=False):
    return cached(f"events:{include_gone}", lambda: _load_events(include_gone))

# ---------- endpoints ----------

@app.get("/ping")
def ping():
    """No DB access on purpose, so uptime monitoring never wakes Neon."""
    return {"status": "ok"}


@app.get("/api/events")
def events(status: str | None = None, closure_type: str | None = None,
           include_gone: bool = False):
    rows = get_events(include_gone)
    if status:
        rows = [e for e in rows if e["status"] == status]
    if closure_type:
        rows = [e for e in rows if e["closure_type"] == closure_type]
    return {
        "count": len(rows),
        "generated_at": datetime.now(timezone.utc),
        "events": rows,
    }


@app.get("/api/stats")
def stats():
    def build():
        rows = get_events(False)
        meta = query(
            """select max(finished_at) filter (where success) as last_success_at,
                      count(*) as total_runs from ingest_runs"""
        )[0]
        tracked = query("select count(*) as n from road_events_current")[0]["n"]
        return {
            "events_in_feed": len(rows),
            "events_tracked_total": tracked,
            "by_status": dict(Counter(e["status"] or "Unknown" for e in rows)),
            "by_closure_type": dict(Counter(e["closure_type"] for e in rows)),
            "active_by_closure_type": dict(
                Counter(e["closure_type"] for e in rows if e["status"] == "Active")
            ),
            "last_success_at": meta["last_success_at"],
            "total_runs": meta["total_runs"],
        }
    return cached("stats", build)


@app.get("/api/health")
def health():
    """For dashboards and debugging. Hits the DB, so don't point UptimeRobot here."""
    last = query(
        """select run_id, started_at, finished_at, success, error
           from ingest_runs order by run_id desc limit 1"""
    )
    last_ok = query("select max(finished_at) as t from ingest_runs where success")[0]["t"]
    size = query("select pg_database_size(current_database()) as b")[0]["b"]

    age_min = None
    if last_ok:
        age_min = round((datetime.now(timezone.utc) - last_ok).total_seconds() / 60, 1)

    if not last:
        status = "no_runs"
    elif last[0]["success"] is False:
        status = "failing"
    elif age_min is None or age_min > settings.STALE_AFTER_MINUTES:
        status = "stale"
    else:
        status = "ok"

    return {
        "status": status,
        "minutes_since_last_success": age_min,
        "last_run": last[0] if last else None,
        "database_bytes": size,
    }

# ---------- ingest trigger (called by cron-job.org) ----------

_ingest_lock = threading.Lock()


def _ingest_job():
    try:
        conn = get_conn()
        try:
            result = run_ingest(conn)
        finally:
            conn.close()
        log.info("ingest finished: %s", result)
    except Exception:
        log.exception("ingest job crashed")
    finally:
        _cache.clear()
        _ingest_lock.release()


@app.post("/api/trigger/ingest", status_code=202)
def trigger_ingest(background: BackgroundTasks,
                   x_cron_secret: str | None = Header(default=None)):
    expected = settings.CRON_SECRET
    if not expected or not x_cron_secret or not hmac.compare_digest(
        x_cron_secret.encode(), expected.encode()
    ):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not _ingest_lock.acquire(blocking=False):
        return {"status": "already_running"}
    background.add_task(_ingest_job)       # work happens after the response is sent
    return {"status": "started"}

