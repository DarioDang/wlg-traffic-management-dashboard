select event_id
from {{ ref('fct_event_history') }}
where is_first_seen
group by event_id
having count(*) > 1