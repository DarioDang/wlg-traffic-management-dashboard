with history as (

    select * from {{ ref('fct_event_history') }}

),

latest as (

    select distinct on (event_id) *
    from history
    order by event_id, version_id desc

),

rollup as (

    select
        event_id,
        min(observed_at)                                                    as first_seen_at,
        count(*) filter (where not is_first_seen)                           as n_changes,
        count(*) filter (where end_date_shift_hours > 0)                    as n_end_date_extensions,
        coalesce(sum(end_date_shift_hours) filter (where end_date_shift_hours > 0), 0) as total_extension_hours
    from history
    group by event_id

)

select
    c.event_id,
    l.event_type,
    l.event_description,
    l.is_planned,
    l.highway_code,
    l.journey_name,
    l.journey_leg_name,
    l.location_area,
    l.impact                                           as latest_impact,
    l.status                                           as latest_status,
    l.start_date,
    l.end_date                                         as latest_end_date,
    l.event_created_at,
    r.first_seen_at,
    r.n_changes,
    r.n_end_date_extensions,
    round(r.total_extension_hours::numeric, 1)         as total_extension_hours,
    c.in_feed,
    case when not c.in_feed then c.last_seen_at end    as left_feed_at,
    extract(epoch from (
        coalesce(case when not c.in_feed then c.last_seen_at end, now()) - r.first_seen_at
    )) / 86400.0                                       as days_tracked
from {{ ref('stg_events_current') }} c
left join latest l using (event_id)
left join rollup r using (event_id)