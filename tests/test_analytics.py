import api.main as m


def _use(monkeypatch, fake):
    m._cache.clear()
    monkeypatch.setattr(m, "query", fake)


def test_trends_returns_oldest_first(monkeypatch):
    rows = [
        {"day": "2026-11-03", "new_events": 2, "cleared_events": 1, "events_open": 9, "updates": 4},
        {"day": "2026-11-02", "new_events": 7, "cleared_events": 0, "events_open": 8, "updates": 1},
    ]

    def fake(sql, params=()):
        return [{"d": "2026-11-02"}] if "min(day)" in sql else rows

    _use(monkeypatch, fake)
    out = m.trends(days=2)
    assert [r["day"] for r in out["items"]] == ["2026-11-02", "2026-11-03"]
    assert out["baseline_day"] == "2026-11-02"
    assert out["count"] == 2


def test_trends_clamps_days(monkeypatch):
    _use(monkeypatch, lambda sql, params=(): [])
    assert m.trends(days=0)["days"] == 1
    assert m.trends(days=9999)["days"] == 180


def test_trends_empty_when_analytics_missing(monkeypatch):
    def boom(sql, params=()):
        raise RuntimeError('relation "analytics.fct_daily_activity" does not exist')

    _use(monkeypatch, boom)
    out = m.trends(days=30)
    assert out["items"] == [] and out["baseline_day"] is None


def test_insights_shape(monkeypatch):
    ev = {"event_id": 1, "n_end_date_extensions": 2, "total_extension_hours": 48.0}

    def fake(sql, params=()):
        if "as events_tracked" in sql:
            return [{"events_tracked": 27, "in_feed": 20, "with_extensions": 3, "avg_changes": 1.2}]
        return [ev]

    _use(monkeypatch, fake)
    out = m.insights()
    assert out["summary"]["events_tracked"] == 27
    assert out["most_extended"] == [ev] and out["longest_open"] == [ev]