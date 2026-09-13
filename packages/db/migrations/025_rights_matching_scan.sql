-- BaBuLo Play V10.4.9 — verificação de direitos e matching
create table if not exists rights_scans(
 id uuid primary key default gen_random_uuid(),
 track_id uuid references tracks(id) on delete cascade,
 storage_key text,
 audio_sha256 text not null,
 provider text not null default 'INTERNAL',
 status text not null default 'COMPLETED' check(status in ('QUEUED','SCANNING','COMPLETED','FAILED')),
 result_status text not null default 'NO_MATCH' check(result_status in ('NO_MATCH','POSSIBLE_MATCH','CONFIRMED_MATCH','REVIEW')),
 confidence numeric(5,2),
 provider_reference text,
 scanned_at timestamptz not null default now(),
 created_by uuid references users(id) on delete set null
);
create index if not exists idx_rights_scans_track on rights_scans(track_id,scanned_at desc);
create index if not exists idx_rights_scans_hash on rights_scans(audio_sha256);

create table if not exists rights_matches(
 id uuid primary key default gen_random_uuid(),
 scan_id uuid not null references rights_scans(id) on delete cascade,
 rights_holder_id uuid references rights_holders(id) on delete set null,
 holder_name text,
 holder_email text,
 country text,
 right_category text check(right_category in ('MASTER','COMPOSITION','LYRICS','PRODUCTION','PERFORMANCE','OTHER')),
 isrc text,
 iswc text,
 ipi text,
 catalog_code text,
 match_type text not null default 'POSSIBLE',
 confidence numeric(5,2),
 confirmed boolean not null default false,
 royalty_percentage numeric(5,2),
 source text,
 source_reference text,
 created_at timestamptz not null default now()
);
create index if not exists idx_rights_matches_scan on rights_matches(scan_id);

create table if not exists royalty_reservations(
 id uuid primary key default gen_random_uuid(),
 track_id uuid not null references tracks(id) on delete cascade,
 rights_match_id uuid references rights_matches(id) on delete set null,
 holder_id uuid references rights_holders(id) on delete set null,
 holder_name text not null,
 holder_email text,
 right_category text not null,
 percentage numeric(5,2) not null check(percentage >= 0 and percentage <= 100),
 currency text not null default 'AOA',
 amount numeric(18,2) not null default 0,
 status text not null default 'RESERVED' check(status in ('RESERVED','READY','PAID','ON_HOLD','CANCELLED')),
 monthly_period text,
 payout_code text unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_royalty_reservations_track on royalty_reservations(track_id,status);
create index if not exists idx_royalty_reservations_period on royalty_reservations(monthly_period,status);
