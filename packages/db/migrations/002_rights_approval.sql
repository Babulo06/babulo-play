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
