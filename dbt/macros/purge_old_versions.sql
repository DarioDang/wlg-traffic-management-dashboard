{% macro purge_old_versions(days=90, dry_run=true, ts_col='fetched_at', id_col='event_id') %}

  {% set cond %}
    v.{{ ts_col }} < now() - interval '{{ days }} days'
    and exists (
      select 1
      from public.road_event_versions n
      where n.{{ id_col }} = v.{{ id_col }}
        and n.{{ ts_col }} > v.{{ ts_col }}
    )
  {% endset %}

  {% if execute %}
    {% set total = run_query("select count(*) from public.road_event_versions").columns[0].values()[0] %}
    {% set doomed = run_query("select count(*) from public.road_event_versions v where " ~ cond).columns[0].values()[0] %}
    {{ log("purge_old_versions: " ~ doomed ~ " of " ~ total ~ " rows are older than " ~ days ~ " days and superseded", info=True) }}

    {% if dry_run %}
      {{ log("dry_run=true, nothing deleted", info=True) }}
    {% else %}
      {% do run_query("delete from public.road_event_versions as v where " ~ cond) %}
      {% do run_query("commit") %}
      {{ log("Deleted " ~ doomed ~ " rows", info=True) }}
    {% endif %}
  {% endif %}

{% endmacro %}