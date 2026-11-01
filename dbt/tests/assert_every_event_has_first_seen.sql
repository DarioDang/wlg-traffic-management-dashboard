select c.event_id
from {{ ref('stg_events_current') }} c
left join (
    select distinct event_id
    from {{ ref('fct_event_history') }}
    where is_first_seen
) h using (event_id)
where h.event_id is null