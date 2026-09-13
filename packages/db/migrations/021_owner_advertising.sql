create table if not exists ad_pricing(
 id uuid primary key default gen_random_uuid(), name text not null, format text not null,
 pricing_model text not null check(pricing_model in ('FIXED','CPM','CPC','CPV')),
 price numeric(18,2) not null check(price>0), currency text not null default 'AOA',
 unit text not null default 'CAMPAIGN', active boolean not null default true,
 sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists ad_campaigns(
 id uuid primary key default gen_random_uuid(), name text not null, advertiser_name text not null,
 contact_email text, format text not null check(format in ('HOME_BANNER','SONG_BREAK','AUDIO_PREROLL','VIDEO_PREROLL','CONTENT','ARTIST_PAGE','PLAYLIST','SPONSORED')),
 pricing_model text not null default 'FIXED' check(pricing_model in ('FIXED','CPM','CPC','CPV')),
 budget numeric(18,2) not null check(budget>0), spend numeric(18,2) not null default 0, currency text not null default 'AOA',
 status text not null default 'DRAFT' check(status in ('DRAFT','PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE','PAUSED','COMPLETED','REJECTED','CANCELLED')),
 payment_status text not null default 'PENDING' check(payment_status in ('PENDING','PAID','REFUNDED')),
 payment_reference text, paid_at timestamptz, start_at timestamptz not null, end_at timestamptz not null,
 target_country text, target_city text, target_audience text not null default 'FREE_USERS', destination_url text,
 impressions bigint not null default 0, clicks bigint not null default 0, video_views bigint not null default 0,
 rejection_reason text, created_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_ad_campaigns_delivery on ad_campaigns(status,payment_status,format,start_at,end_at);
create index if not exists idx_ad_campaigns_created on ad_campaigns(created_at desc);
create table if not exists ad_creatives(
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references ad_campaigns(id) on delete cascade,
 name text not null, format text not null, asset_url text not null, headline text, body_text text, cta text, destination_url text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_ad_creatives_campaign on ad_creatives(campaign_id,created_at desc);
create table if not exists ad_placements(
 id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, description text, active boolean not null default true,
 sort_order integer not null default 0, created_at timestamptz not null default now()
);
insert into ad_placements(code,name,description,sort_order) values
('HOME_BANNER','Banner inicial','Banner principal na página inicial',1),('SONG_BREAK','Entre músicas','Anúncio entre reproduções para utilizadores gratuitos',2),('AUDIO_PREROLL','Áudio pré-reprodução','Áudio antes da música',3),('VIDEO_PREROLL','Vídeo pré-reprodução','Vídeo antes do conteúdo',4),('CONTENT','Conteúdo patrocinado','Bloco patrocinado dentro do conteúdo',5),('ARTIST_PAGE','Página do artista','Publicidade na página do artista',6),('PLAYLIST','Playlist','Publicidade em playlists',7),('SPONSORED','Destaque patrocinado','Posição premium patrocinada',8)
on conflict(code) do nothing;
create table if not exists ad_events(
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references ad_campaigns(id) on delete cascade, creative_id uuid references ad_creatives(id) on delete set null,
 event_type text not null check(event_type in ('IMPRESSION','CLICK','VIDEO_VIEW','INTERACTION')), value numeric(18,4) not null default 0,
 user_id uuid references users(id) on delete set null, country text, city text, visitor_key text, created_at timestamptz not null default now()
);
create index if not exists idx_ad_events_campaign_date on ad_events(campaign_id,created_at desc,event_type);
create index if not exists idx_ad_events_visitor on ad_events(visitor_key,created_at desc);
