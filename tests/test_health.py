from datetime import datetime, timedelta, timezone

import api.main as m


def _use(monkeypatch, recent):
    ok_at = datetime.now(timezone.utc) - timedelta(minutes=10)

    def fake(sql, params=()):
        if "limit 2" in sql:
            return [{"success": s} for s in recent]
        if "pg_database_size" in sql:
            return [{"b": 1}]
        if "max(finished_at)" in sql:
            return [{"t": ok_at}]
        return [{"run_id": 1, "started_at": ok_at, "finished_at": ok_at, "success": recent[0], "error": None}]

    monkeypatch.setattr(m, "query", fake)


def test_one_failed_run_is_only_delayed(monkeypatch):
    _use(monkeypatch, [False, True])
    assert m.health()["status"] == "stale"


def test_two_failed_runs_in_a_row_is_failing(monkeypatch):
    _use(monkeypatch, [False, False])
    assert m.health()["status"] == "failing"


def test_healthy_run_is_ok(monkeypatch):
    _use(monkeypatch, [True, False])
    assert m.health()["status"] == "ok"