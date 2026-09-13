-- BaBuLo Play V10.4.7: Owner Finance Control Center
create table if not exists owner_finance_transactions(
 id uuid primary key default gen_random_uuid(),
 transaction_type text not null check(transaction_type in ('ARTIST_PAYOUT','ADMIN_SALARY','AD_REVENUE','OTHER_INCOME','EXPENSE')),
 status text not null default 'PENDING_APPROVAL' check(status in ('PENDING_APPROVAL','APPROVED','SENT_TO_BANK','PAID','REJECTED','CANCELLED')),
 amount numeric(18,2) not null check(amount>0),
 currency text not null default 'AOA',
 payment_method text not null default 'BANK',
 recipient_user_id uuid references users(id) on delete set null,
 recipient_artist_id uuid references artists(id) on delete set null,
 destination text,
 reference text unique,
 description text,
 metadata jsonb not null default '{}'::jsonb,
 created_by uuid references users(id) on delete set null,
 approved_by uuid references users(id) on delete set null,
 approved_at timestamptz,
 executed_at timestamptz,
 rejection_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_owner_finance_tx_status on owner_finance_transactions(status,created_at desc);
create index if not exists idx_owner_finance_tx_type on owner_finance_transactions(transaction_type,created_at desc);
create index if not exists idx_owner_finance_tx_artist on owner_finance_transactions(recipient_artist_id,created_at desc);

create table if not exists owner_finance_ledger(
 id uuid primary key default gen_random_uuid(),
 account_code text not null,
 entry_type text not null check(entry_type in ('CREDIT','DEBIT')),
 amount numeric(18,2) not null check(amount>0),
 currency text not null default 'AOA',
 reference_type text,
 reference_id uuid,
 description text,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists idx_owner_finance_ledger_account on owner_finance_ledger(account_code,created_at desc);

alter table users add column if not exists salary_amount numeric(18,2);
alter table users add column if not exists salary_currency text not null default 'AOA';
