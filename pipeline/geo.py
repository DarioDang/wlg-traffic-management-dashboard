import re

_PAIR = re.compile(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)")

def wkt_to_latlon(wkt):
    """Return (kind, [[lat, lon], ...]). kind is 'point', 'line' or None."""
    if not isinstance(wkt, str) or not wkt.strip():
        return None, []
    coords = [[float(lat), float(lon)] for lon, lat in _PAIR.findall(wkt)]
    if not coords:
        return None, []
    kind = "point" if wkt.strip().upper().startswith("POINT") else "line"
    return kind, coords

