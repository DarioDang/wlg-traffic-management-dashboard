import argparse
import logging
import sys

from psycopg2.extras import execute_values

from pipeline.db import get_conn
from pipeline.tms import fetch_counts, fetch_sites

log = logging.getLogger("tms_ingest")


def run_tms_ingest(conn, days_back=14, counts=None, sites=None) -> dict:
    # 1. Record the run first and commit, so failures are always logged.
    with conn.cursor() as cur:
        cur.execute(
            "insert into tms_ingest_runs (days_back) values (%s) returning run_id", (days_back,)
        )
        run_id = cur.fetchone()[0]
    conn.commit()

    stats = {"run_id": run_id, "success": False, "error": None}
    try:
        counts = counts if counts is not None else fetch_counts(days_back)
        if not counts:
            raise RuntimeError("TMS returned 0 count rows; refusing to continue")

        refs = {c["site_ref"] for c in counts}
        sites = sites if sites is not None else fetch_sites(refs)
        have = {s["site_ref"] for s in sites}
        missing = sorted(refs - have)
        if missing:
            log.warning("No coordinates for %d sites, skipped: %s", len(missing), missing)

        rows = [c for c in counts if c["site_ref"] in have]
        if not rows:
            raise RuntimeError("None of the count sites have coordinates")

        with conn.cursor() as cur:
            execute_values(
                cur,
                """insert into tms_sites
                   (site_ref, description, state_highway, lane_type, site_type, lat, lon)
                   values %s
                   on conflict (site_ref) do update set
                     description = excluded.description,
                     state_highway = excluded.state_highway,
                     lane_type = excluded.lane_type,
                     site_type = excluded.site_type,
                     lat = excluded.lat, lon = excluded.lon,
                     updated_at = now()""",
                [(s["site_ref"], s["description"], s["state_highway"], s["lane_type"],
                  s["site_type"], s["lat"], s["lon"]) for s in sites],
            )
            execute_values(
                cur,
                """insert into tms_daily_counts
                   (site_ref, day, flow_direction, class_weight, traffic_count)
                   values %s
                   on conflict (site_ref, day, flow_direction, class_weight) do update set
                     traffic_count = excluded.traffic_count, loaded_at = now()
                   where tms_daily_counts.traffic_count is distinct from excluded.traffic_count""",
                [(r["site_ref"], r["day"], r["flow_direction"], r["class_weight"],
                  r["traffic_count"]) for r in rows],
                page_size=1000,
            )
            cur.execute(
                """update tms_ingest_runs
                   set finished_at = now(), success = true, rows_upserted = %s
                   where run_id = %s""",
                (len(rows), run_id),
            )
        conn.commit()
        stats.update(success=True, rows=len(rows), sites=len(sites), skipped_sites=len(missing))

    except Exception as exc:
        conn.rollback()
        log.exception("tms ingest failed")
        with conn.cursor() as cur:
            cur.execute(
                "update tms_ingest_runs set finished_at = now(), success = false, error = %s where run_id = %s",
                (str(exc)[:1000], run_id),
            )
        conn.commit()
        stats["error"] = str(exc)

    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=14, help="how many days back to load")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    conn = get_conn()
    try:
        result = run_tms_ingest(conn, days_back=args.days)
    finally:
        conn.close()
    print(result)
    sys.exit(0 if result["success"] else 1)