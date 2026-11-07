import pytest
import requests

from pipeline import fetch


class _Resp:
    def __init__(self, code):
        self.status_code = code


def test_retries_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, timeout=None):
        calls["n"] += 1
        if calls["n"] < 3:
            raise requests.ConnectionError("refused")
        return _Resp(200)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr("time.sleep", lambda s: None)
    assert fetch._get_with_retry("http://example.test").status_code == 200
    assert calls["n"] == 3


def test_gives_up_after_three_attempts(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, timeout=None):
        calls["n"] += 1
        raise requests.ConnectionError("refused")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr("time.sleep", lambda s: None)
    with pytest.raises(requests.ConnectionError):
        fetch._get_with_retry("http://example.test")
    assert calls["n"] == 3


def test_does_not_retry_4xx(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, timeout=None):
        calls["n"] += 1
        return _Resp(404)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    assert fetch._get_with_retry("http://example.test").status_code == 404
    assert calls["n"] == 1