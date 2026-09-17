-- V10.4.21 — Partner Distribution Connectors
create table if not exists distribution_platform_connectors(
 id uuid primary key default gen_random_uuid(),
 platform_id uuid not null unique references distribution_platforms(id) on delete cascade,
 partner_name text not null,
 endpoint_url text not null,
 protocol text not null default 'DDEX' check(protocol in ('DDEX','JSON')),
 auth_env_key text not null,
 callback_url text,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_distribution_platform_connectors_active on distribution_platform_connectors(active);
