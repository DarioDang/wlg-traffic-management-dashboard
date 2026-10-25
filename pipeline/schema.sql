create table if not exists ingest_runs (
    run_id            bigserial primary key,
    started_at        timestamptz not null default now(),
    finished_at       timestamptz,
    success           boolean,
    events_in_feed    int,
    wellington_events int,
    new_events        int,
    changed_events    int,
    unchanged_events  int,
    gone_events       int,
    error             text
);

create table if not exists road_events_current (
    event_id        bigint primary key,
    region          text,
    status          text,
    content_hash    text not null,
    payload         jsonb not null,
    first_seen_at   timestamptz not null,
    last_seen_at    timestamptz not null,
    last_changed_at timestamptz not null,
    in_feed         boolean not null default true
);

create table if not exists road_event_versions (
    version_id    bigserial primary key,
    event_id      bigint not null,
    content_hash  text not null,
    status        text,
    payload       jsonb not null,
    observed_at   timestamptz not null default now(),
    ingest_run_id bigint references ingest_runs(run_id)
);

create index if not exists idx_versions_event_observed
    on road_event_versions (event_id, observed_at);