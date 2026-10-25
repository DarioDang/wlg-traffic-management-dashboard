import requests
from pipeline.config import API_URL, HTTP_TIMEOUT, REGION_ID

def fetch_events():
    """
    Return the raw national event list from the NZTA feed
    """

    r = requests.get(API_URL, timeout = HTTP_TIMEOUT)
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