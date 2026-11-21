{{ config(materialized='view') }}

select
    c.site_ref,
    c.day,
    s.description,
    s.state_highway,
    s.lat,
    s.lon,
    sum(c.traffic_count)                                          as vehicles,
    sum(c.traffic_count) filter (where c.class_weight = 'Light')  as light_vehicles,
    sum(c.traffic_count) filter (where c.class_weight = 'Heavy')  as heavy_vehicles,
    count(distinct c.flow_direction)                              as n_directions
from {{ source('tms', 'tms_daily_counts') }} c
join {{ source('tms', 'tms_sites') }} s using (site_ref)
group by 1, 2, 3, 4, 5, 6