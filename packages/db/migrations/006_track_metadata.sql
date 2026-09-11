-- BaBuLo Play V10.2: metadados profissionais de faixa
alter table tracks add column if not exists featured_artists text;
alter table tracks add column if not exists audio_type text not null default 'SONG';
alter table tracks add column if not exists ai_generated text not null default 'NO';
alter table tracks add column if not exists ai_usage text;
alter table tracks add column if not exists lyrics text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='tracks_audio_type_check') then
    alter table tracks add constraint tracks_audio_type_check check (audio_type in ('SONG','INSTRUMENTAL','ACAPELLA','LIVE','REMIX','COVER'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tracks_ai_generated_check') then
    alter table tracks add constraint tracks_ai_generated_check check (ai_generated in ('NO','PARTIAL','FULL'));
  end if;
end $$;

create table if not exists track_features(
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  artist_name text not null,
  artist_id uuid references artists(id) on delete set null,
  role text not null default 'FEATURED',
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_track_features_track on track_features(track_id);
