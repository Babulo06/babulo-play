-- BaBuLo Play V10.3: capa 600x600, trecho promocional e 33 destinos de distribuição
alter table tracks add column if not exists promo_start_ms integer not null default 0;
alter table tracks add column if not exists promo_end_ms integer not null default 0;
create index if not exists idx_tracks_promo on tracks(primary_release_id, track_number);

insert into distribution_platforms(code,name,requires_isrc,requires_upc,active,status) values
('SPOTIFY','Spotify',true,true,true,'READY'),
('APPLE_MUSIC','Apple Music',true,true,true,'READY'),
('YOUTUBE_MUSIC','YouTube Music',true,true,true,'READY'),
('AMAZON_MUSIC','Amazon Music',true,true,true,'READY'),
('DEEZER','Deezer',true,true,true,'READY'),
('TIDAL','TIDAL',true,true,true,'READY'),
('AUDIOMACK','Audiomack',true,false,true,'READY'),
('BOOMPLAY','Boomplay',true,false,true,'READY'),
('SOUNDCLOUD','SoundCloud',true,false,true,'READY'),
('PANDORA','Pandora',true,false,true,'READY'),
('IHEARTRADIO','iHeartRadio',true,false,true,'READY'),
('NAPSTER','Napster',true,false,true,'READY'),
('QOBUZ','Qobuz',true,false,true,'READY'),
('ANGHAMI','Anghami',true,false,true,'READY'),
('JOOX','JOOX',true,false,true,'READY'),
('TENCENT_MUSIC','Tencent Music',true,false,true,'READY'),
('NETEASE_CLOUD_MUSIC','NetEase Cloud Music',true,false,true,'READY'),
('KKBOX','KKBOX',true,false,true,'READY'),
('CLARO_MUSICA','Claro Música',true,false,true,'READY'),
('AWA','AWA',true,false,true,'READY'),
('TIKTOK','TikTok Music / TikTok',true,false,true,'READY'),
('INSTAGRAM_MUSIC','Instagram Music',true,false,true,'READY'),
('FACEBOOK_MUSIC','Facebook Music',true,false,true,'READY'),
('YOUTUBE_SHORTS','YouTube Shorts',true,false,true,'READY'),
('SNAPCHAT','Snapchat',true,false,true,'READY'),
('TRILLER','Triller',true,false,true,'READY'),
('SHAZAM','Shazam',true,false,true,'READY'),
('ITUNES_STORE','iTunes Store',true,true,true,'READY'),
('AMAZON_DIGITAL_MUSIC','Amazon Digital Music',true,false,true,'READY'),
('BEATPORT','Beatport',true,false,true,'READY'),
('TRAXSOURCE','Traxsource',true,false,true,'READY'),
('7DIGITAL','7digital',true,false,true,'READY'),
('JUNO_DOWNLOAD','Juno Download',true,false,true,'READY')
on conflict(code) do update set name=excluded.name,requires_isrc=excluded.requires_isrc,requires_upc=excluded.requires_upc,active=true,status='READY';
update distribution_platforms set active=false where code='OTHER';
