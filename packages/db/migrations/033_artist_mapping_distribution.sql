-- BaBuLo Play V10.4.17: Artist Mapping + motor de distribuição
-- Guarda os perfis oficiais do artista nas plataformas externas e associa cada entrega ao perfil correto.
create table if not exists artist_platform_profiles(
 id uuid primary key default gen_random_uuid(),
 artist_id uuid not null references artists(id) on delete cascade,
 platform_id uuid not null references distribution_platforms(id) on delete cascade,
 profile_mode text not null default 'NEW' check(profile_mode in ('NEW','EXISTING')),
 profile_url text,
 external_artist_id text,
 mapping_status text not null default 'PENDING' check(mapping_status in ('PENDING','VERIFIED','REJECTED','NOT_FOUND')),
 verified_by uuid references users(id) on delete set null,
 verified_at timestamptz,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(artist_id,platform_id)
);
create index if not exists idx_artist_platform_profiles_artist on artist_platform_profiles(artist_id);
create index if not exists idx_artist_platform_profiles_platform on artist_platform_profiles(platform_id);
alter table distribution_deliveries add column if not exists artist_profile_id uuid references artist_platform_profiles(id) on delete set null;
alter table distribution_deliveries add column if not exists mapping_status text not null default 'NOT_REQUIRED';
alter table distribution_deliveries add column if not exists external_artist_id text;
alter table distribution_deliveries add column if not exists artist_profile_url text;
