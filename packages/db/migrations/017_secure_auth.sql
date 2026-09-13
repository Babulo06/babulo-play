-- BaBuLo Play V10.4.4: autenticação segura
alter table users add column if not exists mfa_enabled boolean not null default false;
alter table users add column if not exists mfa_pending boolean not null default false;
alter table users add column if not exists mfa_secret_enc text;
alter table auth_sessions add column if not exists user_agent_hash text;
create table if not exists auth_email_tokens(
 id uuid primary key,
 user_id uuid not null references users(id) on delete cascade,
 token_hash text not null unique,
 type text not null,
 expires_at timestamptz not null,
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_auth_email_tokens_lookup on auth_email_tokens(token_hash,type,expires_at);
create index if not exists idx_auth_email_tokens_user on auth_email_tokens(user_id,type,used_at);
create table if not exists auth_challenges(
 id uuid primary key,
 user_id uuid not null references users(id) on delete cascade,
 challenge_hash text not null unique,
 type text not null,
 expires_at timestamptz not null,
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_auth_challenges_lookup on auth_challenges(challenge_hash,type,expires_at,used_at);
