import hashlib
import json
import logging
import sys

from psycopg2.extras import Json

from pipeline.db import get_conn
from pipeline.fetch import fetch_events, wellington_only
from pipeline.geo import wkt_to_latlon

log = logging.getLogger("ingest")

HASH_FIELDS = [
    "id", "status", "eventType", "eventDescription", "eventComments", "impact",
    "startDate", "endDate", "expectedResolution", "geometry", "locationArea",
    "locations", "alternativeRoute", "planned", "restrictions",
    "informationSource", "supplier",
]


def _geometry_signature(wkt):
    """NZTA alternates the same line between full-detail and simplified versions.
    Compare only the kind and the rounded start and end points (about 1 m), so a
    change in detail is ignored but a real move is still caught."""
    kind, coords = wkt_to_latlon(wkt)
    if not coords:
        return None
    return [kind, [round(v, 5) for v in coords[0]], [round(v, 5) for v in coords[-1]]]


def content_hash(e: dict) -> str:
    subset = {k: e.get(k) for k in HASH_FIELDS}
    subset["geometry"] = _geometry_signature(e.get("geometry"))
    subset["region"] = (e.get("region") or {}).get("name")
    return hashlib.sha256(
        json.dumps(subset, sort_keys=True, default=str).encode()
    ).hexdigest()


def diff_events(feed: dict, current: dict) -> dict:
    """feed: {id: hash}   current: {id: (hash, in_feed)}"""
    return {
        "new":       [i for i in feed if i not in current],
        "changed":   [i for i in feed if i in current and current[i][0] != feed[i]],
        "unchanged": [i for i in feed if i in current and current[i][0] == feed[i]],
        "gone":      [i for i, (_, live) in current.items() if live and i not in feed],
    }


def run_ingest(conn, events=None) -> dict:
    # 1. Record the run first and commit, so failures are always logged.
    with conn.cursor() as cur:
        cur.execute("insert into ingest_runs (started_at) values (now()) returning run_id")
        run_id = cur.fetchone()[0]
    conn.commit()

    stats = {"run_id": run_id, "success": False, "error": None}
    try:
        events = events if events is not None else fetch_events()
        if not events:
            raise RuntimeError("Feed returned 0 events; refusing to mark everything as gone")

        wgtn = wellington_only(events)
        feed_hashes = {eid: content_hash(e) for eid, e in wgtn.items()}

        with conn.cursor() as cur:
            cur.execute("select event_id, content_hash, in_feed from road_events_current")
            current = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

            d = diff_events(feed_hashes, current)

            for eid in d["new"] + d["changed"]:
                e = wgtn[eid]
                cur.execute(
                    """insert into road_event_versions
                       (event_id, content_hash, status, payload, observed_at, ingest_run_id)
                       values (%s, %s, %s, %s, now(), %s)""",
                    (eid, feed_hashes[eid], e.get("status"), Json(e), run_id),
                )

            for eid in d["new"]:
                e = wgtn[eid]
                cur.execute(
                    """insert into road_events_current
                       (event_id, region, status, content_hash, payload,
                        first_seen_at, last_seen_at, last_changed_at, in_feed)
                       values (%s, %s, %s, %s, %s, now(), now(), now(), true)""",
                    (eid, (e.get("region") or {}).get("name"), e.get("status"),
                     feed_hashes[eid], Json(e)),
                )

            for eid in d["changed"]:
                e = wgtn[eid]
                cur.execute(
                    """update road_events_current
                       set status=%s, content_hash=%s, payload=%s,
                           last_seen_at=now(), last_changed_at=now(), in_feed=true
                       where event_id=%s""",
                    (e.get("status"), feed_hashes[eid], Json(e), eid),
                )

            if d["unchanged"]:
                cur.execute(
                    """update road_events_current
                       set last_seen_at=now(), in_feed=true
                       where event_id = any(%s)""",
                    (d["unchanged"],),
                )
            if d["gone"]:
                cur.execute(
                    "update road_events_current set in_feed=false where event_id = any(%s)",
                    (d["gone"],),
                )

            cur.execute(
                """update ingest_runs
                   set finished_at=now(), success=true, events_in_feed=%s,
                       wellington_events=%s, new_events=%s, changed_events=%s,
                       unchanged_events=%s, gone_events=%s
                   where run_id=%s""",
                (len(events), len(wgtn), len(d["new"]), len(d["changed"]),
                 len(d["unchanged"]), len(d["gone"]), run_id),
            )
        conn.commit()
        stats.update(success=True, events_in_feed=len(events), wellington_events=len(wgtn),
                     **{k: len(v) for k, v in d.items()})

    except Exception as exc:
        conn.rollback()
        log.exception("ingest failed")
        with conn.cursor() as cur:
            cur.execute(
                "update ingest_runs set finished_at=now(), success=false, error=%s where run_id=%s",
                (str(exc)[:1000], run_id),
            )
        conn.commit()
        stats["error"] = str(exc)

    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    conn = get_conn()
    try:
        result = run_ingest(conn)
    finally:
        conn.close()
    print(result)
    sys.exit(0 if result["success"] else 1)