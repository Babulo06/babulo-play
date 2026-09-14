-- V10.4.14 — fluxo de publicidade controlado pelo ADMIN de Publicidade
create table if not exists ad_campaign_placements(
  campaign_id uuid not null references ad_campaigns(id) on delete cascade,
  placement_id uuid not null references ad_placements(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(campaign_id,placement_id)
);
create index if not exists idx_ad_campaign_placements_placement on ad_campaign_placements(placement_id,campaign_id);

-- Compatibilidade: cada campanha antiga recebe o espaço com o mesmo código do seu formato.
insert into ad_campaign_placements(campaign_id,placement_id)
select c.id,p.id from ad_campaigns c join ad_placements p on p.code=c.format
where not exists(select 1 from ad_campaign_placements cp where cp.campaign_id=c.id);
