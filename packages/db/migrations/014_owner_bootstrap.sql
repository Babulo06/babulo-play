-- BaBuLo Play V10.4.1: marca de bootstrap do primeiro OWNER.
-- A linha é criada apenas quando o primeiro OWNER é provisionado pelos segredos do Render.
create table if not exists system_settings(
  key text primary key,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
