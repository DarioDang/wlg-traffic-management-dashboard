import re

# Rules copied from notebook cell 4 (validated against live data). Keep in sync.
CLEARED = re.compile(r"now clear")
ROAD_CLOSED = re.compile(
    r"\b(?:road|ramp|highway|bridge|tunnel)\b[^.]{0,40}\b(?:closed|close|closure)\b"
)
LANE = re.compile(r"\blanes?\b[^.]{0,20}\bclos")
STOP_GO = re.compile(r"stop\s*/\s*go")
SPEED = re.compile(r"speed restriction|\d+\s*km/h")


def classify(event: dict) -> str:
    raw = event.get("eventComments")
    text = raw.lower() if isinstance(raw, str) else ""   # handles None and NaN

    if CLEARED.search(text):
        return "cleared_no_detail"
    if event.get("impact") == "Road Closed" or ROAD_CLOSED.search(text):
        return "road_closure"
    if LANE.search(text):
        return "lane_closure"
    if STOP_GO.search(text):
        return "stop_go"
    if SPEED.search(text):
        return "speed_restriction"
    return "other"