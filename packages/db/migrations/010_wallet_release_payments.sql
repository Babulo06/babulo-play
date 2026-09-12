-- BaBuLo Play V10.4: pagamentos de lançamentos com saldo de royalties/streams
-- O débito fica registado no financial_ledger para manter o saldo auditável.
create index if not exists idx_financial_ledger_release_payment
  on financial_ledger(reference_type,reference_id)
  where reference_type='RELEASE_PAYMENT';
