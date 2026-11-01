{{ config(severity='warn') }}

select event_id, start_date, latest_end_date
from {{ ref('dim_events') }}
where latest_end_date is not null
  and start_date is not null
  and latest_end_date < start_date