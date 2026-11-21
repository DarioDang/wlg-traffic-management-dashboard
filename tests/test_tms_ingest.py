from datetime import date

from pipeline import tms_ingest


class FakeCursor:
    def __init__(self, calls):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((" ".join(sql.split()), params))

    def fetchone(self):
        return (7,)


class FakeConn:
    def __init__(self):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self.calls)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


COUNT = {"site_ref": "A", "day": date(2026, 9, 22), "flow_direction": 1,
         "class_weight": "Light", "traffic_count": 10.0}
SITE = {"site_ref": "A", "description": "d", "state_highway": "1", "lane_type": "Inc",
        "site_type": "Continuous", "lat": -41.1, "lon": 174.8}


def _capture(monkeypatch):
    captured = []

    def fake_execute_values(cur, sql, rows, **kwargs):
        captured.append((" ".join(sql.split()), list(rows)))

    monkeypatch.setattr(tms_ingest, "execute_values", fake_execute_values)
    return captured


def test_sites_without_coordinates_are_skipped(monkeypatch):
    captured = _capture(monkeypatch)
    conn = FakeConn()
    counts = [COUNT, {**COUNT, "site_ref": "B"}]

    result = tms_ingest.run_tms_ingest(conn, counts=counts, sites=[SITE])

    assert result["success"] is True
    assert result["rows"] == 1
    assert result["skipped_sites"] == 1
    assert [r[0] for r in captured[1][1]] == ["A"]  # only site A's counts were written


def test_empty_response_is_refused(monkeypatch):
    _capture(monkeypatch)
    conn = FakeConn()

    result = tms_ingest.run_tms_ingest(conn, counts=[], sites=[])

    assert result["success"] is False
    assert "0 count rows" in result["error"]
    assert conn.rollbacks == 1