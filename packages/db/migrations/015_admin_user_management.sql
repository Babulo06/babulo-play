-- BaBuLo Play V10.4.2: gestão administrativa de contas e artistas
-- Os estados ACTIVE/SUSPENDED/BLOCKED já existem nas tabelas base.
-- Mantemos a regra no backend para impedir alterações indevidas ao OWNER.
create index if not exists idx_users_role_status_created on users(role,status,created_at desc);
create index if not exists idx_artists_status_verification on artists(status,verification_status,created_at desc);
