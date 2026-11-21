from datetime import date

from pipeline.tms import aggregate_counts

MS_SEP_22 = 1790035200000  # 2026-09-22 00:00 UTC


def row(site="01N10999", ms=MS_SEP_22, direction=1, cls="Light", count=10.0, lane=1):
    return {"SiteRef": site, "startDate": ms, "flowDirection": direction,
            "classWeight": cls, "trafficCount": count, "laneNumber": lane}


def test_lanes_are_summed():
    out = aggregate_counts([row(count=10.5, lane=1), row(count=4.5, lane=2)])
    assert out == [{"site_ref": "01N10999", "day": date(2026, 9, 22),
                    "flow_direction": 1, "class_weight": "Light", "traffic_count": 15.0}]


def test_direction_and_class_stay_separate():
    out = aggregate_counts([row(direction=1), row(direction=2), row(cls="Heavy")])
    assert len(out) == 3


def test_day_comes_from_the_utc_timestamp():
    out = aggregate_counts([row(ms=MS_SEP_22 + 86_400_000)])
    assert out[0]["day"] == date(2026, 9, 23)


def test_rows_without_a_count_are_skipped():
    assert aggregate_counts([row(count=None)]) == []