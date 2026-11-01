with src as (

    select * from {{ source('raw', 'road_event_versions') }}

),

parsed as (

    select
        version_id,
        event_id,
        content_hash,
        observed_at,
        ingest_run_id,
        payload ->> 'eventType'                                         as event_type,
        payload ->> 'eventDescription'                                  as event_description,
        payload ->> 'impact'                                            as impact,
        payload ->> 'status'                                            as status,
        payload ->> 'locationArea'                                      as location_area,
        payload ->> 'eventComments'                                     as comments,
        payload ->> 'alternativeRoute'                                  as alternative_route,
        payload ->> 'expectedResolution'                                as expected_resolution,
        (payload ->> 'planned')::boolean                                as is_planned,
        nullif(payload ->> 'startDate', '')::timestamptz                as start_date,
        nullif(payload ->> 'endDate', '')::timestamptz                  as end_date,
        nullif(payload ->> 'eventCreated', '')::timestamptz             as event_created_at,
        payload -> 'way' ->> 'name'                                     as highway_code,
        payload -> 'journey' ->> 'name'                                 as journey_name,
        payload -> 'journeyLeg' ->> 'name'                              as journey_leg_name,
        nullif(payload -> 'journeyLeg' ->> 'totalLength', '')::numeric  as journey_leg_km,
        payload ->> 'geometry'                                          as geometry_wkt
    from src

),

geo as (

    select
        *,
        regexp_match(geometry_wkt, '(-?\d+\.\d+)\s+(-?\d+\.\d+)')                 as first_pair,
        regexp_match(geometry_wkt, '(-?\d+\.\d+)\s+(-?\d+\.\d+)[^0-9]*$')         as last_pair
    from parsed

)

select
    version_id,
    event_id,
    content_hash,
    observed_at,
    ingest_run_id,
    event_type,
    event_description,
    impact,
    status,
    location_area,
    comments,
    alternative_route,
    expected_resolution,
    is_planned,
    start_date,
    end_date,
    event_created_at,
    highway_code,
    journey_name,
    journey_leg_name,
    journey_leg_km,
    round(first_pair[1]::numeric, 5) as geom_start_lon,
    round(first_pair[2]::numeric, 5) as geom_start_lat,
    round(last_pair[1]::numeric, 5)  as geom_end_lon,
    round(last_pair[2]::numeric, 5)  as geom_end_lat
from geo

