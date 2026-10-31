from pipeline.ingest import content_hash

BASE = {
    "id": 1, "status": "Active", "eventType": "Area Warning", "impact": "Caution",
    "region": {"id": 9, "name": "Wellington"},
}

FULL = "MULTILINESTRING ((174.88109000000566 -41.1060000869719, 174.88606000000553 -41.1056900869718, 174.91483000000477 -41.10702008697223))"
TWO = "MULTILINESTRING ((174.88109000000566 -41.1060000869719, 174.91483000000477 -41.10702008697223))"
MOVED = "MULTILINESTRING ((174.88109000000566 -41.1060000869719, 174.93000000000000 -41.10702008697223))"


def ev(geom):
    return {**BASE, "geometry": geom}


def test_detail_level_does_not_change_hash():
    assert content_hash(ev(FULL)) == content_hash(ev(TWO))


def test_moved_endpoint_changes_hash():
    assert content_hash(ev(FULL)) != content_hash(ev(MOVED))


def test_missing_geometry_is_stable():
    assert content_hash(ev(None)) == content_hash(ev(""))