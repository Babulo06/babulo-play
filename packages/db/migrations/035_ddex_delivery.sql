create table if not exists ddex_packages(
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null unique references distribution_deliveries(id) on delete cascade,
 release_id uuid not null references releases(id) on delete cascade,
 message_id text not null,
 file_path text not null,
 sha256 text not null,
 status text not null default 'GENERATED' check(status in ('GENERATED','SENT','ACCEPTED','REJECTED','FAILED')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_ddex_packages_release on ddex_packages(release_id);
