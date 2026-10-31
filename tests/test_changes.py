from api.main import _diff

OLD = {
    "status": "Active",
    "impact": "Caution",
    "endDate": "2026-11-03T17:00:00+13:00",
    "geometry": "MULTILINESTRING ((174.88109 -41.106, 174.91483 -41.10702))",
}


def test_identical_versions_have_no_changes():
    assert _diff(OLD, dict(OLD)) == []


def test_detail_only_geometry_change_is_ignored():
    new = {**OLD, "geometry": "MULTILINESTRING ((174.88109 -41.106, 174.9 -41.105, 174.91483 -41.10702))"}
    assert _diff(OLD, new) == []


def test_end_date_change_is_reported():
    new = {**OLD, "endDate": "2026-11-10T17:00:00+13:00"}
    changes = _diff(OLD, new)
    assert [c["field"] for c in changes] == ["endDate"]
    assert changes[0]["from"] == OLD["endDate"]
    assert changes[0]["to"] == new["endDate"]


def test_moved_endpoint_is_reported():
    new = {**OLD, "geometry": "MULTILINESTRING ((174.88109 -41.106, 174.95 -41.10702))"}
    assert [c["field"] for c in _diff(OLD, new)] == ["geometry"]