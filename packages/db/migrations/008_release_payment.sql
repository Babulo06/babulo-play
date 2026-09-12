-- BaBuLo Play V10.3: pagamento obrigatório por lançamento
alter table payment_transactions add column if not exists release_id uuid references releases(id) on delete set null;
create index if not exists idx_payment_transactions_release on payment_transactions(release_id,created_at desc);
