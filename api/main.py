import hmac
import logging
import threading
import time
import logging
import re
from collections import Counter
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from api import settings
from pipeline.classify import classify 
from pipeline.db import get_conn
from pipeline.geo import wkt_to_latlon
from pipeline.ingest import run_ingest
from pipeline.ingest import _geometry_signature

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

_CODE = r"[0-9A-Z]+-[0-9A-Z]+(?:-[0-9A-Z]+)?/[\d.]+(?:-[A-Z])?"
_SECTION_PREFIX = re.compile(rf"^\s*{_CODE}\s*(?:-\s*{_CODE}\s*)?")


def _route(p):
    journey = p.get("journey") or {}
    leg = p.get("journeyLeg") or {}
    if not journey.get("name") and not leg.get("name"):
        return None
    return {
        "journey": journey.get("name"),
        "leg": leg.get("name"),
        "leg_km": leg.get("totalLength"),
    }


def _sections(raw):
    """locations is a string or a list: strip the road-reference codes, keep the words."""
    if not raw:
        return []
    items = raw if isinstance(raw, list) else [raw]
    out = []
    for item in items:
        if not isinstance(item, str):
            continue
        text = _SECTION_PREFIX.sub("", item).strip()
        if text:
            out.append(re.sub(r"\bTo\b", "to", text.title()))
    return out[:3]

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
            "event_created": p.get("eventCreated"),
            "event_modified": p.get("eventModified"),
            "route": _route(p),
            "sections": _sections(p.get("locations")),
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

# ---------- change detection (reads road_event_versions) ----------

_TRACKED = [
    ("status", "Status"), ("impact", "Impact"), ("startDate", "Start"), ("endDate", "End"),
    ("expectedResolution", "Expected resolution"), ("eventDescription", "Cause"),
    ("eventComments", "Comments"), ("locationArea", "Location"), ("alternativeRoute", "Detour"),
]


def _short(v, n=160):
    if v is None:
        return None
    s = str(v).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _diff(old, new):
    """What really changed between two stored versions. Detail-only geometry changes are ignored."""
    out = []
    for key, label in _TRACKED:
        a, b = old.get(key), new.get(key)
        if a != b:
            out.append({"field": key, "label": label, "from": _short(a), "to": _short(b)})
    if _geometry_signature(old.get("geometry")) != _geometry_signature(new.get("geometry")):
        out.append({"field": "geometry", "label": "Mapped location", "from": None, "to": None})
    return out


def _brief(e):
    keys = ("id", "highway", "location_area", "closure_type", "event_type",
            "description", "status", "impact", "in_feed")
    return {k: e.get(k) for k in keys}


def _build_changes(hours):
    rows = query(
        """with touched as (
               select distinct event_id from road_event_versions
               where observed_at >= now() - make_interval(hours => %s)
           ), ranked as (
               select v.version_id, v.event_id, v.observed_at, v.payload,
                      lag(v.payload) over (partition by v.event_id order by v.version_id) as prev
               from road_event_versions v
               join touched t using (event_id)
           )
           select version_id, event_id, observed_at, payload, prev
           from ranked
           where observed_at >= now() - make_interval(hours => %s)
           order by observed_at desc, version_id desc""",
        (hours, hours),
    )
    briefs = {e["id"]: _brief(e) for e in get_events(True)}
    items = []
    for r in rows:
        eid = r["event_id"]
        event = briefs.get(eid) or {"id": eid}
        if r["prev"] is None:
            items.append({"kind": "new", "at": r["observed_at"], "event": event, "changes": []})
            continue
        changes = _diff(r["prev"], r["payload"])
        if changes:
            items.append({"kind": "updated", "at": r["observed_at"], "event": event, "changes": changes})

    gone = query(
        """select event_id, last_seen_at from road_events_current
           where not in_feed and last_seen_at >= now() - make_interval(hours => %s)""",
        (hours,),
    )
    for g in gone:
        eid = g["event_id"]
        items.append({"kind": "gone", "at": g["last_seen_at"],
                      "event": briefs.get(eid) or {"id": eid}, "changes": []})

    items.sort(key=lambda i: i["at"], reverse=True)
    return items[:100]

# ---------- endpoints ----------

@app.api_route("/ping", methods=["GET", "HEAD"])
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

@app.get("/api/changes")
def changes(hours: int = 72):
    hours = max(1, min(hours, 336))
    items = cached(f"changes:{hours}", lambda: _build_changes(hours))
    return {
        "hours": hours,
        "generated_at": datetime.now(timezone.utc),
        "count": len(items),
        "items": items,
    }


@app.get("/api/events/{event_id}/history")
def event_history(event_id: int):
    rows = query(
        """select version_id, observed_at, payload,
                  lag(payload) over (order by version_id) as prev
           from road_event_versions where event_id = %s order by version_id""",
        (event_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Unknown event")
    history = []
    for r in rows:
        if r["prev"] is None:
            history.append({"at": r["observed_at"], "kind": "first_seen", "changes": []})
        else:
            ch = _diff(r["prev"], r["payload"])
            if ch:
                history.append({"at": r["observed_at"], "kind": "updated", "changes": ch})
    history.reverse()
    return {"event_id": event_id, "versions": len(rows), "history": history[:50]}


# ---------- analytics (dbt marts) ----------
def _analytics(sql):
    """Read a dbt mart. Returns [] if analytics isn't built yet, so the API never 500s on it."""
    try:
        return query(sql)
    except Exception:
        logging.getLogger(__name__).exception("analytics query failed")
        return []


@app.get("/api/trends")
def trends(days: int = 30):
    days = max(1, min(int(days), 180))

    def build():
        rows = _analytics(
            f"""select day, new_events, cleared_events, events_open, updates
                from analytics.fct_daily_activity
                order by day desc limit {days}"""
        )
        first = _analytics("select min(day) as d from analytics.fct_daily_activity")
        baseline = first[0]["d"] if first and first[0]["d"] else None
        return {"items": list(reversed(rows)), "baseline_day": baseline}

    out = cached(f"trends:{days}", build)
    return {
        "days": days,
        "count": len(out["items"]),
        "baseline_day": out["baseline_day"],  # that day counts everything already open as "new"
        "items": out["items"],
    }


@app.get("/api/insights")
def insights():
    def build():
        summary = _analytics(
            """select count(*) as events_tracked,
                      count(*) filter (where in_feed) as in_feed,
                      count(*) filter (where n_end_date_extensions > 0) as with_extensions,
                      coalesce(round(avg(n_changes), 1), 0) as avg_changes
               from analytics.dim_events"""
        )
        cols = """event_id, event_type, event_description, highway_code, location_area,
                  n_changes, n_end_date_extensions, total_extension_hours,
                  round(days_tracked, 1) as days_tracked, in_feed, latest_end_date"""
        most_extended = _analytics(
            f"""select {cols} from analytics.dim_events
                where n_end_date_extensions > 0
                order by total_extension_hours desc, n_end_date_extensions desc
                limit 5"""
        )
        longest_open = _analytics(
            f"""select {cols} from analytics.dim_events
                where in_feed
                order by days_tracked desc
                limit 5"""
        )
        return {
            "summary": summary[0] if summary else {},
            "most_extended": most_extended,
            "longest_open": longest_open,
        }

    return cached("insights", build)

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

