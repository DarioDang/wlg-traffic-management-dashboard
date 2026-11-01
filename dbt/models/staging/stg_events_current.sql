select
    event_id,
    region,
    status,
    in_feed,
    first_seen_at,
    last_seen_at,
    last_changed_at
from {{ source('raw', 'road_events_current') }}