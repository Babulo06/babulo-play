-- BaBuLo Play V10.3.4: sessões independentes da área do artista
-- Cada login de artista recebe uma sessão própria, que expira após 30 minutos sem atividade.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, created_at desc);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(user_id, revoked_at, last_activity_at);
