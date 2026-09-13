-- BaBuLo Play V10.4.7: Owner financial approvals
alter table payment_transactions add column if not exists reviewed_by uuid references users(id) on delete set null;
alter table payment_transactions add column if not exists reviewed_at timestamptz;
alter table payment_transactions add column if not exists review_reason text;
create index if not exists idx_payment_transactions_review on payment_transactions(status,reviewed_at,created_at desc);
create index if not exists idx_withdrawals_pending_created on withdrawals(status,created_at asc);
