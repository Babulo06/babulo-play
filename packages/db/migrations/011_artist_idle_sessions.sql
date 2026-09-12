-- BaBuLo Play V10.3.4: controlo de inatividade da sessão do artista
-- Mantido para compatibilidade: a sessão por dispositivo fica na migração 012.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_last_activity_at ON users(last_activity_at);
