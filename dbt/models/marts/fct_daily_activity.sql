with days as (

    select generate_series(
        (select min(first_seen_at at time zone 'Pacific/Auckland')::date from {{ ref('dim_events') }}),
        (now() at time zone 'Pacific/Auckland')::date,
        interval '1 day'
    )::date as day

),

events as (

    select
        event_id,
        (first_seen_at at time zone 'Pacific/Auckland')::date as first_day,
        (left_feed_at at time zone 'Pacific/Auckland')::date  as left_day
    from {{ ref('dim_events') }}

),

changes as (

    select
        (observed_at at time zone 'Pacific/Auckland')::date as day,
        count(*) as n_changes
    from {{ ref('fct_event_history') }}
    where not is_first_seen
    group by 1

)

select
    d.day,
    count(e.event_id) filter (where e.first_day = d.day)  as new_events,
    count(e.event_id) filter (where e.left_day = d.day)   as cleared_events,
    count(e.event_id) filter (
        where e.first_day <= d.day and (e.left_day is null or e.left_day >= d.day)
    )                                                      as events_open,
    coalesce(max(c.n_changes), 0)                          as updates
from days d
left join events e on true
left join changes c on c.day = d.day
group by d.day
order by d.day