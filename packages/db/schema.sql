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
 id uuid primary key default gen_random_uuid(), title text not null, version text, duration_ms integer, track_number integer,
 language text, genre_id uuid references genres(id), is_explicit boolean not null default false,
 explicit_reason text, isrc text, isrc_status text not null default 'NOT_PROVIDED', isrc_source text, original_release_date date, composer text, lyricist text, producer text, performer text, publisher text, status text not null default 'DRAFT',
 primary_release_id uuid references releases(id), created_at timestamptz not null default now()
);
create table if not exists track_artists(track_id uuid references tracks(id) on delete cascade,artist_id uuid references artists(id) on delete cascade,role text not null,display_order integer not null default 0,primary key(track_id,artist_id,role));
create table if not exists track_files(id uuid primary key default gen_random_uuid(),track_id uuid references tracks(id) on delete cascade,storage_key text not null,file_type text not null,format text,size_bytes bigint,checksum text,status text not null default 'UPLOADED',created_at timestamptz not null default now());

insert into genres(name) values
('Kuduro'),('Kizomba'),('Semba'),('Rap'),('Hip-Hop'),('Trap'),('Drill'),('Boom Bap'),('Gangsta Rap'),('Conscious Rap'),('Melodic Rap'),('Alternative Rap'),('Rap Lusófono'),('Rap Angolano'),('Afro Rap'),('Afro Trap'),
('Amapiano'),('Afrobeat'),('Afrobeats'),('Afro House'),('Afro Tech'),('Afro Soul'),('Afro Pop'),('Afro Dancehall'),('Dancehall'),('Reggae'),('Bashment'),('Zouk'),('Ghetto Zouk'),('Tarraxinha'),('Tarraxada'),('Rebita'),('Kazukuta'),('Kilapanga'),('Merengue Angolano'),('Gospel Africano'),
('R&B'),('Soul'),('Funk'),('Pop'),('Urban Pop'),('Alternative'),('Indie'),('Lo-fi'),('Reggaeton'),('Latin Pop'),('Salsa'),('Bachata'),
('House'),('Deep House'),('Afro Deep House'),('Tech House'),('Techno'),('Electronic'),('EDM'),('Lounge'),('Chillout'),('Drum & Bass'),('Jungle'),('Dubstep'),
('Rock'),('Alternative Rock'),('Hard Rock'),('Metal'),('Jazz'),('Blues'),('Folk'),('Country'),('Acoustic'),('Instrumental'),('Classical'),('Orchestral'),
('Gospel'),('Worship'),('Spoken Word')
on conflict do nothing;


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


-- BaBuLo Play V10.2: Track Metadata
\i migrations/006_track_metadata.sql

-- BaBuLo Play V10.3: Multi-track ordering
\i migrations/007_track_order.sql
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


-- V10.4.9
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



-- BaBuLo Play V10.4.10: controlo de remuneração, faltas e descontos dos ADMINs pelo OWNER
create table if not exists admin_payroll_settings(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null unique references users(id) on delete cascade,
 daily_rate numeric(18,2) not null default 0 check(daily_rate>=0),
 monthly_salary numeric(18,2) not null default 0 check(monthly_salary>=0),
 currency text not null default 'AOA',
 effective_from date not null default current_date,
 updated_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists admin_attendance(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references users(id) on delete cascade,
 attendance_date date not null,
 status text not null default 'ABSENT' check(status in ('PRESENT','ABSENT','EXCUSED')),
 note text,
 justification_document_key text,
 justification_document_name text,
 justification_mime_type text,
 reviewed_by uuid references users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(admin_user_id,attendance_date)
);
create index if not exists idx_admin_attendance_admin_date on admin_attendance(admin_user_id,attendance_date desc);

create table if not exists admin_payroll_adjustments(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references users(id) on delete cascade,
 adjustment_type text not null default 'DISCOUNT' check(adjustment_type in ('DISCOUNT','BONUS')),
 amount numeric(18,2) not null check(amount>0),
 reference_month text not null,
 description text not null,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists idx_admin_payroll_adjustments_admin_month on admin_payroll_adjustments(admin_user_id,reference_month,created_at desc);


-- BaBuLo Play V10.4.11: workflow de faltas/justificações dos ADMINs
alter table admin_attendance add column if not exists justification_status text not null default 'NONE' check(justification_status in ('NONE','PENDING','APPROVED','REJECTED'));
alter table admin_attendance add column if not exists submitted_by uuid references users(id) on delete set null;
alter table admin_attendance add column if not exists submitted_at timestamptz;
alter table admin_attendance add column if not exists review_reason text;
update admin_attendance set justification_status=case when status='EXCUSED' then 'APPROVED' else 'NONE' end where justification_status='NONE';
create index if not exists idx_admin_attendance_pending on admin_attendance(justification_status,attendance_date desc) where justification_status='PENDING';
-- V10.4.12: faltas marcadas pelo Owner + notificações ao ADMIN
alter table admin_attendance add column if not exists marked_by uuid references users(id) on delete set null;
alter table admin_attendance add column if not exists marked_at timestamptz;
create index if not exists idx_admin_attendance_marked_by on admin_attendance(marked_by,attendance_date desc);

create table if not exists admin_notifications(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references users(id) on delete cascade,
 type text not null,
 title text not null,
 message text not null,
 reference_id uuid,
 read_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_admin_notifications_admin_created on admin_notifications(admin_user_id,created_at desc);
