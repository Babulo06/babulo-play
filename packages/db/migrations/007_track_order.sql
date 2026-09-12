-- BaBuLo Play V10.3: multi-track release ordering
alter table tracks add column if not exists track_number integer;
create index if not exists idx_tracks_release_track_number on tracks(primary_release_id, track_number);
