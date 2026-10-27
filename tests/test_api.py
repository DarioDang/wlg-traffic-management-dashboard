import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.main as main
from pipeline.fetch import wellington_only

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "events_sample.json").read_text())
WGTN = wellington_only(FIXTURE)
NOW = datetime(2026, 10, 26, tzinfo=timezone.utc)


def fake_query(sql, params=()):
    return [
        {"event_id": eid, "payload": e, "in_feed": True,
         "first_seen_at": NOW, "last_seen_at": NOW, "last_changed_at": NOW}
        for eid, e in WGTN.items()
    ]


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    main._cache.clear()
    monkeypatch.setattr(main, "query", fake_query)
    monkeypatch.setattr(main.settings, "CRON_SECRET", "s3cret")


client = TestClient(main.app)


def test_ping_needs_no_db():
    assert client.get("/ping").json() == {"status": "ok"}


def test_events_returns_all_wellington_events_with_closure_type():
    body = client.get("/api/events").json()
    assert body["count"] == len(WGTN)
    assert all(e["closure_type"] for e in body["events"])


def test_events_filter_by_closure_type():
    all_ = client.get("/api/events").json()["events"]
    target = all_[0]["closure_type"]
    filtered = client.get(f"/api/events?closure_type={target}").json()
    assert filtered["count"] == sum(e["closure_type"] == target for e in all_)


def test_trigger_rejects_missing_secret():
    assert client.post("/api/trigger/ingest").status_code == 401


def test_trigger_rejects_wrong_secret():
    r = client.post("/api/trigger/ingest", headers={"X-Cron-Secret": "nope"})
    assert r.status_code == 401


def test_trigger_with_secret_starts_job(monkeypatch):
    monkeypatch.setattr(main, "_ingest_job", lambda: main._ingest_lock.release())
    r = client.post("/api/trigger/ingest", headers={"X-Cron-Secret": "s3cret"})
    assert r.status_code == 202 and r.json() == {"status": "started"}