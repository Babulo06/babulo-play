-- V10.4.9 fix
-- Faz apenas uma vez a transição das contas LISTENER/ARTIST já existentes
-- antes desta migração, para que a nova verificação de email não bloqueie
-- contas antigas. Novas contas continuam com email_verified=false.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM system_settings WHERE key='v1049_existing_email_verification_done'
  ) THEN
    UPDATE users
    SET email_verified=true, updated_at=now()
    WHERE role in ('LISTENER','ARTIST')
      AND email is not null
      AND email_verified=false;

    INSERT INTO system_settings(key,value)
    VALUES ('v1049_existing_email_verification_done','true')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
