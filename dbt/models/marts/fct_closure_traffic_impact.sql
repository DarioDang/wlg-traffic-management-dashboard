{{ config(materialized='table') }}

{% set radius_km = var('tms_radius_km', 2) %}
{% set baseline_days = var('tms_baseline_days', 28) %}

-- One representative point per event: the average of its geometry vertices.
with geo as (
    select
        e.event_id,
        avg(m[1]::float8) as lon,
        avg(m[2]::float8) as lat
    from {{ source('raw', 'road_events_current') }} e
    cross join lateral regexp_matches(
        e.payload->>'geometry', '(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)', 'g'
    ) as m
    group by e.event_id
),

-- Only events that ended at least 4 days ago (TMS data lags ~3 days).
events as (
    select
        d.event_id,
        d.event_type,
        d.event_description,
        d.highway_code,
        d.location_area,
        d.start_date::timestamptz                                   as start_ts,
        least(d.latest_end_date::timestamptz,
              coalesce(d.left_feed_at, d.latest_end_date::timestamptz)) as end_ts,
        g.lat,
        g.lon
    from {{ ref('dim_events') }} d
    join geo g using (event_id)
    where d.start_date is not null
      and d.latest_end_date is not null
),

events_ok as (
    select *,
           (start_ts at time zone 'UTC')::date as start_day
    from events
    where end_ts > start_ts
      and end_ts <= now() - interval '4 days'
),

sites as (
    select distinct site_ref, lat, lon from {{ ref('stg_tms_daily') }}
),

-- TMS lanes within the radius of each event (haversine, km).
nearby as (
    select
        e.event_id,
        e.start_ts,
        e.end_ts,
        e.start_day,
        s.site_ref,
        6371 * 2 * asin(sqrt(
            power(sin(radians(s.lat - e.lat) / 2), 2)
            + cos(radians(e.lat)) * cos(radians(s.lat))
              * power(sin(radians(s.lon - e.lon) / 2), 2)
        )) as distance_km
    from events_ok e
    cross join sites s
),

nearby_close as (
    select * from nearby where distance_km <= {{ radius_km }}
),

-- Only whole UTC days that lie fully inside the closure window.
event_days as (
    select n.event_id, n.site_ref, n.distance_km, t.day, t.vehicles,
           extract(isodow from t.day) as dow
    from nearby_close n
    join {{ ref('stg_tms_daily') }} t on t.site_ref = n.site_ref
    where (t.day::timestamp at time zone 'UTC') >= n.start_ts
      and ((t.day + 1)::timestamp at time zone 'UTC') <= n.end_ts
),

-- Same-weekday average over the weeks before the closure started.
baseline as (
    select n.event_id, n.site_ref,
           extract(isodow from t.day) as dow,
           avg(t.vehicles)            as base_avg,
           count(*)                   as n_base
    from nearby_close n
    join {{ ref('stg_tms_daily') }} t on t.site_ref = n.site_ref
    where t.day >= n.start_day - {{ baseline_days }}
      and t.day <  n.start_day
    group by 1, 2, 3
),

day_ratio as (
    select ed.event_id, ed.site_ref, ed.day, ed.distance_km,
           ed.vehicles / nullif(b.base_avg, 0) as ratio,
           b.n_base
    from event_days ed
    join baseline b
      on b.event_id = ed.event_id and b.site_ref = ed.site_ref and b.dow = ed.dow
    where b.n_base >= 2
),

per_site as (
    select event_id, site_ref,
           min(distance_km)       as distance_km,
           avg(ratio)             as ratio,
           count(*)               as n_days,
           avg(n_base)            as avg_baseline_obs
    from day_ratio
    group by 1, 2
),

per_event as (
    select event_id,
           count(*)                          as n_sites,
           min(distance_km)                  as nearest_km,
           avg(ratio)                        as avg_ratio,
           sum(n_days)                       as n_site_days,
           max(n_days)                       as n_event_days,
           avg(avg_baseline_obs)             as avg_baseline_obs
    from per_site
    group by 1
)

select
    e.event_id,
    e.event_type,
    e.event_description,
    e.highway_code,
    e.location_area,
    e.start_ts,
    e.end_ts,
    round(p.nearest_km::numeric, 2)                  as nearest_km,
    p.n_sites,
    p.n_event_days,
    round(p.avg_baseline_obs::numeric, 1)            as avg_baseline_obs,
    round(((p.avg_ratio - 1) * 100)::numeric, 1)     as pct_change,
    case when p.n_event_days < 2 or p.avg_baseline_obs < 3 or p.n_sites < 2
         then 'low' else 'ok' end                    as confidence
from events_ok e
join per_event p using (event_id)