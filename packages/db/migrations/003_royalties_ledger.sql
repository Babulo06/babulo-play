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
