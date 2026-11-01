{{
    config(
        materialized='incremental',
        unique_key='version_id',
        on_schema_change='append_new_columns'
    )
}}

{% set tracked = [
    'status', 'impact', 'event_description', 'comments', 'location_area',
    'alternative_route', 'expected_resolution', 'start_date', 'end_date',
    'geom_start_lon', 'geom_start_lat', 'geom_end_lon', 'geom_end_lat'
] %}
{% set context_cols = [
    'version_id', 'event_id', 'observed_at', 'event_type', 'is_planned',
    'highway_code', 'journey_name', 'journey_leg_name', 'journey_leg_km', 'event_created_at'
] %}
{% set cols = context_cols + tracked %}

with new_versions as (

    select {{ cols | join(', ') }}
    from {{ ref('stg_event_versions') }}
    {% if is_incremental() %}
    where version_id > (select coalesce(max(version_id), 0) from {{ this }})
    {% endif %}

),

combined as (

    {% if is_incremental() %}
    select {{ cols | join(', ') }}, true as is_seed
    from (
        select distinct on (event_id) {{ cols | join(', ') }}
        from {{ this }}
        order by event_id, version_id desc
    ) as last_known

    union all

    {% endif %}
    select {{ cols | join(', ') }}, false as is_seed
    from new_versions

),

compared as (

    select
        *,
        lag(version_id) over w as prev_version_id,
        {% for c in tracked %}
        lag({{ c }}) over w as prev_{{ c }}{{ "," if not loop.last }}
        {% endfor %}
    from combined
    window w as (partition by event_id order by version_id)

),

flagged as (

    select
        *,
        prev_version_id is null as is_first_seen,
        array_remove(array[
            {% for c in tracked %}
            case when {{ c }} is distinct from prev_{{ c }} then '{{ c }}' end{{ "," if not loop.last }}
            {% endfor %}
        ], null) as changed_fields
    from compared

)

select
    {{ cols | join(', ') }},
    is_first_seen,
    changed_fields,
    case
        when end_date is not null and prev_end_date is not null
        then extract(epoch from (end_date - prev_end_date)) / 3600.0
    end as end_date_shift_hours
from flagged
where not is_seed
  and (is_first_seen or cardinality(changed_fields) > 0)