""" NZTA TMS daily traffic counts for the Wellington region (ArcGIS REST, no API key) """

import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import requests 

BASE = "https://services.arcgis.com/CXBb7LAjgIIdcsPt/ArcGIS/rest/services"
COUNTS_URL = f"{BASE}/TMS_Telemetry_Sites/FeatureServer/0/query"
SITES_URL = f"{BASE}/Assets_SHTrafficMonitoringSites/FeatureServer/0/query"
REGION = "09 - Wellington"
PAGE = 2000
HEADERS = {"User-Agent": "wlg-roadworks-portfolio"}

def _post(url, params, attempts=3, delays=(5, 20)):
    params = {**params, "f": "json"}
    last = None
    for i in range(attempts):
        try:
            r = requests.post(url, data=params, headers=HEADERS, timeout=60)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(f"ArcGIS error: {data['error']}")
            return data
        except (requests.RequestException, RuntimeError, ValueError) as e:
            last = e
            if i < attempts - 1:
                time.sleep(delays[min(i, len(delays) - 1)])
    raise last

def _query_all(url, where, **extra):
    rows, offset = [], 0
    while True:
        data = _post(url, {
            "where": where, "outFields": "*", "orderByFields": "OBJECTID",
            "resultOffset": offset, "resultRecordCount": PAGE, **extra,
        })
        feats = data.get("features", [])
        rows.extend(feats)
        if not data.get("exceededTransferLimit") or not feats:
            break
        offset += len(feats)
    return rows

def aggregate_counts(attribute_rows):
    """Sum the lanes: one row per site, UTC day, direction and vehicle class."""
    totals = defaultdict(float)
    for a in attribute_rows:
        if a.get("trafficCount") is None or a.get("startDate") is None or a.get("flowDirection") is None:
            continue
        day = datetime.fromtimestamp(a["startDate"] / 1000, tz=timezone.utc).date()
        key = (a["SiteRef"], day, int(a["flowDirection"]), a["classWeight"])
        totals[key] += float(a["trafficCount"])
    return [
        {"site_ref": k[0], "day": k[1], "flow_direction": k[2], "class_weight": k[3], "traffic_count": round(v, 1)}
        for k, v in sorted(totals.items())
    ]

def fetch_counts(days_back=14, today=None):
    today = today or date.today()
    since = (today - timedelta(days=days_back)).isoformat()
    where = f"regionName='{REGION}' AND startDate >= TIMESTAMP '{since} 00:00:00'"
    rows = _query_all(COUNTS_URL, where, returnGeometry="false")
    return aggregate_counts([r["attributes"] for r in rows])

def fetch_sites(site_refs):
    refs = sorted(set(site_refs))
    if not refs:
        return []
    quoted = ",".join("'" + r.replace("'", "''") + "'" for r in refs)
    rows = _query_all(SITES_URL, f"siteref IN ({quoted})", outSR=4326, returnGeometry="true")
    out = {}
    for r in rows:
        a, g = r["attributes"], r.get("geometry")
        if not g or a.get("siteref") is None:
            continue
        out[a["siteref"]] = {
            "site_ref": a["siteref"], "description": a.get("description"),
            "state_highway": a.get("sh"), "lane_type": a.get("lane"),
            "site_type": a.get("sitetype"), "lat": g["y"], "lon": g["x"],
        }
    return list(out.values())