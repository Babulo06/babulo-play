-- V10.4.23 — Perfil central do artista e sincronização com perfis externos
create table if not exists artist_profile_sync_jobs(
 id uuid primary key default gen_random_uuid(),
 artist_id uuid not null references artists(id) on delete cascade,
 artist_platform_profile_id uuid not null references artist_platform_profiles(id) on delete cascade,
 platform_id uuid not null references distribution_platforms(id) on delete cascade,
 status text not null default 'QUEUED' check(status in ('QUEUED','SYNCING','SYNCED','FAILED')),
 idempotency_key text not null unique,
 payload jsonb not null default '{}'::jsonb,
 attempt_count integer not null default 0,
 request_id text,
 last_http_status integer,
 last_error text,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_artist_profile_sync_artist on artist_profile_sync_jobs(artist_id,created_at desc);
create index if not exists idx_artist_profile_sync_status on artist_profile_sync_jobs(status,created_at desc);
