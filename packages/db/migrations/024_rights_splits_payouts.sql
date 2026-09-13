-- BaBuLo Play V10.4.8: direitos, splits, confirmações e perfis de recebimento
create table if not exists rights_holders(
 id uuid primary key default gen_random_uuid(),
 user_id uuid references users(id) on delete set null,
 display_name text not null,
 email text,
 phone text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_rights_holders_user on rights_holders(user_id);

create table if not exists track_rights(
 id uuid primary key default gen_random_uuid(),
 track_id uuid not null references tracks(id) on delete cascade,
 right_category text not null check(right_category in ('MASTER','COMPOSITION','LYRICS','PRODUCTION','PERFORMANCE','OTHER')),
 ownership_mode text not null check(ownership_mode in ('SOLE','SHARED')),
 legitimacy_confirmed boolean not null default false,
 agreement_version integer not null default 1,
 status text not null default 'DRAFT' check(status in ('DRAFT','PENDING_ACCEPTANCE','ACCEPTED','LOCKED','REJECTED')),
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(track_id,right_category)
);
create index if not exists idx_track_rights_track on track_rights(track_id);

create table if not exists rights_splits(
 id uuid primary key default gen_random_uuid(),
 track_right_id uuid not null references track_rights(id) on delete cascade,
 holder_id uuid references rights_holders(id) on delete set null,
 participant_user_id uuid references users(id) on delete set null,
 participant_name text not null,
 participant_email text,
 participant_role text not null,
 percentage numeric(5,2) not null check(percentage >= 0 and percentage <= 100),
 status text not null default 'PENDING' check(status in ('PENDING','INVITED','ACCEPTED','REJECTED','CHANGE_PENDING','LOCKED')),
 accepted_at timestamptz,
 accepted_ip text,
 accepted_user_agent text,
 agreement_version integer not null default 1,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_rights_splits_track_right on rights_splits(track_right_id);
create index if not exists idx_rights_splits_user on rights_splits(participant_user_id);

create table if not exists rights_invitations(
 id uuid primary key default gen_random_uuid(),
 rights_split_id uuid not null references rights_splits(id) on delete cascade,
 invite_email text not null,
 token_hash text unique,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','REJECTED','EXPIRED')),
 sent_at timestamptz,
 expires_at timestamptz,
 accepted_at timestamptz,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists idx_rights_invites_email on rights_invitations(lower(invite_email),status);

create table if not exists rights_agreements(
 id uuid primary key default gen_random_uuid(),
 track_right_id uuid not null references track_rights(id) on delete cascade,
 version integer not null,
 agreement_text text not null,
 content_hash text not null,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(track_right_id,version)
);

create table if not exists rights_change_requests(
 id uuid primary key default gen_random_uuid(),
 rights_split_id uuid not null references rights_splits(id) on delete cascade,
 old_percentage numeric(5,2) not null,
 new_percentage numeric(5,2) not null,
 reason text,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','REJECTED','CANCELLED')),
 requested_by uuid references users(id) on delete set null,
 responded_by uuid references users(id) on delete set null,
 requested_at timestamptz not null default now(),
 responded_at timestamptz,
 request_ip text
);
create index if not exists idx_rights_change_requests_status on rights_change_requests(status,requested_at desc);

create table if not exists royalty_payout_accounts(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references users(id) on delete cascade,
 payout_method text not null check(payout_method in ('MULTICAIXA_EXPRESS','BANK')),
 multicaixa_phone_enc text,
 bank_name text,
 iban_enc text,
 account_number_enc text,
 account_holder text,
 currency text not null default 'AOA',
 verified boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id)
);
