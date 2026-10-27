from pipeline.geo import wkt_to_latlon


def test_point():
    assert wkt_to_latlon("POINT (174.78 -41.29)") == ("point", [[-41.29, 174.78]])


def test_multilinestring():
    kind, coords = wkt_to_latlon("MULTILINESTRING ((174.0 -41.0, 174.1 -41.1), (174.2 -41.2, 174.3 -41.3))")
    assert kind == "line"
    assert coords[0] == [-41.0, 174.0] and len(coords) == 4


def test_missing_geometry():
    assert wkt_to_latlon(None) == (None, [])
    assert wkt_to_latlon("") == (None, [])