create extension if not exists pgcrypto;

create table if not exists users(
 id uuid primary key default gen_random_uuid(), email text unique, phone text unique,
 password_hash text not null, role text not null default 'LISTENER', status text not null default 'ACTIVE',
 email_verified boolean not null default false, phone_verified boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists genres(id uuid primary key default gen_random_uuid(),name text unique not null);
create table if not exists artists(
 id uuid primary key default gen_random_uuid(), user_id uuid references users(id) on delete set null,
 stage_name text not null, legal_name text, bio text, country text, city text, photo_url text,
 verification_status text not null default 'UNVERIFIED', status text not null default 'ACTIVE', created_at timestamptz not null default now()
);
create table if not exists releases(
 id uuid primary key default gen_random_uuid(), title text not null, type text not null,
 primary_artist_id uuid references artists(id), genre_id uuid references genres(id), language text,
 country text, release_date date, pre_release_date date, cover_url text, description text,
 upc text, ean text, label_name text, phonographic_copyright text, copyright_text text,
 preflight_status text not null default 'NOT_CHECKED', preflight_reason text, submitted_at timestamptz,
 status text not null default 'DRAFT', created_at timestamptz not null default now()
);
create table if not exists tracks(
 id uuid primary key default gen_random_uuid(), title text not null, version text, duration_ms integer,
 language text, genre_id uuid references genres(id), is_explicit boolean not null default false,
 explicit_reason text, isrc text, isrc_status text not null default 'NOT_PROVIDED', isrc_source text, original_release_date date, composer text, lyricist text, producer text, performer text, publisher text, status text not null default 'DRAFT',
 primary_release_id uuid references releases(id), created_at timestamptz not null default now()
);
create table if not exists track_artists(track_id uuid references tracks(id) on delete cascade,artist_id uuid references artists(id) on delete cascade,role text not null,display_order integer not null default 0,primary key(track_id,artist_id,role));
create table if not exists track_files(id uuid primary key default gen_random_uuid(),track_id uuid references tracks(id) on delete cascade,storage_key text not null,file_type text not null,format text,size_bytes bigint,checksum text,status text not null default 'UPLOADED',created_at timestamptz not null default now());

insert into genres(name) values ('Kuduro'),('Kizomba'),('Semba'),('Rap'),('Amapiano'),('Afrobeat') on conflict do nothing;


-- BaBuLo Play V7: Direitos, aprovação e reclamações
create table if not exists rights_declarations(
 id uuid primary key default gen_random_uuid(),
 release_id uuid not null references releases(id) on delete cascade,
 track_id uuid references tracks(id) on delete cascade,
 party_name text not null,
 party_role text not null,
 right_type text not null default 'STREAMING',
 percentage numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
 territory text not null default 'WORLDWIDE',
 valid_from date, valid_to date,
 document_url text,
 status text not null default 'PENDING',
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_rights_release on rights_declarations(release_id);
create index if not exists idx_rights_status on rights_declarations(status);

alter table releases add column if not exists review_reason text;
alter table releases add column if not exists reviewed_at timestamptz;
alter table releases add column if not exists reviewed_by uuid references users(id) on delete set null;

create table if not exists copyright_complaints(
 id uuid primary key default gen_random_uuid(),
 release_id uuid references releases(id) on delete set null,
 track_id uuid references tracks(id) on delete set null,
 complainant_name text not null,
 complainant_email text not null,
 claim_type text not null,
 description text not null,
 evidence_url text,
 status text not null default 'OPEN',
 decision_reason text,
 reviewed_by uuid references users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_complaints_status on copyright_complaints(status);

create table if not exists audit_logs(
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid references users(id) on delete set null,
 action text not null,
 entity_type text not null,
 entity_id uuid,
 details jsonb,
 created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_logs(entity_type,entity_id);


-- BaBuLo Play V8: Royalty Engine + immutable-ish financial ledger
create table if not exists stream_events(
 id uuid primary key default gen_random_uuid(),
 user_id uuid references users(id) on delete set null,
 track_id uuid not null references tracks(id) on delete cascade,
 event_type text not null,
 played_seconds integer not null default 0,
 session_id text,
 is_valid boolean not null default false,
 fraud_score numeric(5,2) not null default 0,
 occurred_at timestamptz not null default now()
);
create index if not exists idx_stream_events_track_period on stream_events(track_id,occurred_at);
create index if not exists idx_stream_events_valid_period on stream_events(is_valid,occurred_at);

create table if not exists royalty_periods(
 id uuid primary key default gen_random_uuid(),
 period_start date not null,
 period_end date not null,
 currency text not null default 'AOA',
 gross_revenue numeric(18,2) not null default 0,
 payment_fees numeric(18,2) not null default 0,
 taxes numeric(18,2) not null default 0,
 adjustments numeric(18,2) not null default 0,
 eligible_revenue numeric(18,2) not null default 0,
 artist_share_percent numeric(5,2) not null default 70 check (artist_share_percent>=0 and artist_share_percent<=100),
 babulo_share_percent numeric(5,2) not null default 30 check (babulo_share_percent>=0 and babulo_share_percent<=100),
 status text not null default 'OPEN',
 calculated_at timestamptz,
 calculated_by uuid references users(id) on delete set null,
 unique(period_start,period_end)
);

create table if not exists royalty_entries(
 id uuid primary key default gen_random_uuid(),
 period_id uuid not null references royalty_periods(id) on delete cascade,
 artist_id uuid not null references artists(id) on delete cascade,
 track_id uuid not null references tracks(id) on delete cascade,
 valid_streams integer not null default 0,
 stream_share numeric(18,8) not null default 0,
 eligible_revenue numeric(18,2) not null default 0,
 artist_share_percent numeric(5,2) not null,
 artist_amount numeric(18,2) not null default 0,
 status text not null default 'PAYABLE',
 created_at timestamptz not null default now(),
 unique(period_id,artist_id,track_id)
);
create index if not exists idx_royalty_entries_artist on royalty_entries(artist_id,created_at);

create table if not exists financial_ledger(
 id uuid primary key default gen_random_uuid(),
 artist_id uuid not null references artists(id) on delete cascade,
 entry_type text not null,
 reference_type text,
 reference_id uuid,
 amount numeric(18,2) not null,
 currency text not null default 'AOA',
 balance_after numeric(18,2) not null,
 description text,
 created_at timestamptz not null default now()
);
create index if not exists idx_financial_ledger_artist on financial_ledger(artist_id,created_at);

create table if not exists withdrawals(
 id uuid primary key default gen_random_uuid(),
 artist_id uuid not null references artists(id) on delete cascade,
 amount numeric(18,2) not null check(amount>0),
 currency text not null default 'AOA',
 method text not null,
 destination text not null,
 status text not null default 'PENDING',
 fee numeric(18,2) not null default 0,
 net_amount numeric(18,2) not null,
 rejection_reason text,
 reviewed_by uuid references users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_withdrawals_artist on withdrawals(artist_id,created_at);
create index if not exists idx_withdrawals_status on withdrawals(status);

alter table users add column if not exists kyc_status text not null default 'NOT_STARTED';


-- BaBuLo Play V9: Payment Engine
\i migrations/004_payment_engine.sql

\i migrations/005_distribution_engine.sql
