import requests
import time
from pipeline.config import API_URL, HTTP_TIMEOUT, REGION_ID

def fetch_events():
    """
    Return the raw national event list from the NZTA feed
    """

    r = _get_with_retry(API_URL)
    r.raise_for_status()
    events = (r.json().get("response") or {}).get("roadevent") or []
    if isinstance(events, dict):
        events = [events] # a single event can come back as a dict
    return events

def wellington_only(events):
    """Filter to the Wellington region. Returns {event_id: event}."""
    return {
        int(e["id"]): e
        for e in events
        if str((e.get("region") or {}).get("id")) == REGION_ID
    }

def _get_with_retry(url, attempts=3, delays=(5, 20)):
    """GET with retries for connection errors, timeouts and 5xx. 4xx is returned as-is."""
    import time

    last_err = None
    for i in range(attempts):
        try:
            r = requests.get(url, timeout=HTTP_TIMEOUT)
            if r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            return r
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
            last_err = e
            if i < attempts - 1:
                time.sleep(delays[min(i, len(delays) - 1)])
    raise last_err