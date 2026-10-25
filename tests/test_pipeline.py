import copy
import json
from pathlib import Path

import pytest

from pipeline.classify import classify
from pipeline.fetch import wellington_only
from pipeline.ingest import content_hash, diff_events

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "events_sample.json").read_text()
)


def one_wellington_event():
    return next(iter(wellington_only(FIXTURE).values()))


def test_wellington_filter_only_returns_region_9():
    w = wellington_only(FIXTURE)
    assert len(w) > 0
    assert all(str(e["region"]["id"]) == "9" for e in w.values())


def test_hash_is_deterministic():
    e = one_wellington_event()
    assert content_hash(e) == content_hash(copy.deepcopy(e))


def test_hash_ignores_volatile_fields():
    e = one_wellington_event()
    e2 = copy.deepcopy(e)
    e2["eventModified"] = "2099-01-01T00:00:00"
    e2["journeyLeg"] = {"flow": 999}
    assert content_hash(e) == content_hash(e2)


def test_hash_changes_when_comments_change():
    e = one_wellington_event()
    e2 = copy.deepcopy(e)
    e2["eventComments"] = (e.get("eventComments") or "") + " changed"
    assert content_hash(e) != content_hash(e2)


def test_diff_new_changed_unchanged_gone():
    feed = {1: "a", 2: "b2", 3: "c"}
    current = {2: ("b", True), 3: ("c", True), 4: ("d", True)}
    d = diff_events(feed, current)
    assert d == {"new": [1], "changed": [2], "unchanged": [3], "gone": [4]}


def test_diff_ignores_events_already_gone():
    d = diff_events({}, {5: ("x", False)})
    assert d["gone"] == []


def test_diff_reappearing_event_is_unchanged_not_new():
    d = diff_events({5: "x"}, {5: ("x", False)})
    assert d["unchanged"] == [5] and d["new"] == []


@pytest.mark.parametrize("comment,impact,expected", [
    ("The road is now clear.", "Caution", "cleared_no_detail"),
    ("", "Road Closed", "road_closure"),
    ("Newlands on-ramp closed overnight.", "Caution", "road_closure"),
    ("Left lane closed.", "Delays", "lane_closure"),
    ("Left lane of the road closed.", "Delays", "road_closure"),   # road beats lane
    ("Footpath closed.", "Caution", "other"),                      # no road/ramp noun
    ("Stop/go traffic management in place.", "Delays", "stop_go"),
    ("Temporary 30km/h speed restriction.", "Caution", "speed_restriction"),
    ("Roadworks ahead.", "Caution", "other"),
    (None, "Caution", "other"),
])

def test_classify(comment, impact, expected):
    assert classify({"eventComments": comment, "impact": impact}) == expected