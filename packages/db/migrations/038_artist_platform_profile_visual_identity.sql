-- BaBuLo Play V10.4.29 — identidade visual e dados de referência dos perfis externos
alter table artist_platform_profiles add column if not exists profile_image_url text;
alter table artist_platform_profiles add column if not exists external_artist_name text;
create index if not exists idx_artist_platform_profiles_mapping_status on artist_platform_profiles(mapping_status);
