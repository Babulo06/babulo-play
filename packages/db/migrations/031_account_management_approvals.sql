-- V10.4.15: Gestor de Contas com aprovação do Owner
create table if not exists account_action_requests(
 id uuid primary key default gen_random_uuid(),
 target_user_id uuid references users(id) on delete cascade,
 target_artist_id uuid references artists(id) on delete cascade,
 requested_by uuid not null references users(id) on delete restrict,
 action_type text not null,
 requested_status text,
 reason text,
 status text not null default 'PENDING',
 reviewed_by uuid references users(id) on delete set null,
 reviewed_at timestamptz,
 review_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint account_action_target_chk check (target_user_id is not null or target_artist_id is not null),
 constraint account_action_status_chk check (status in ('PENDING','APPROVED','REJECTED')),
 constraint account_action_type_chk check (action_type in ('STATUS_CHANGE','ARTIST_VERIFICATION'))
);
create index if not exists idx_account_action_requests_pending on account_action_requests(status,created_at desc);
create index if not exists idx_account_action_requests_target_user on account_action_requests(target_user_id,status);
create index if not exists idx_account_action_requests_target_artist on account_action_requests(target_artist_id,status);
