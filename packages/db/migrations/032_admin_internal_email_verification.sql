-- BaBuLo Play V10.4.16: contas administrativas internas
-- ADMIN/OWNER são contas criadas/geridas internamente pela plataforma.
-- Não devem ficar bloqueadas pelo fluxo de verificação de email do público.
-- A alteração é idempotente e também corrige contas administrativas já existentes.

UPDATE users
SET email_verified = true, updated_at = now()
WHERE role IN ('ADMIN','OWNER')
  AND email_verified = false;

