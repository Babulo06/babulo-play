-- BaBuLo Play V10.4.30 — destino interno de lançamento
-- A BaBuLo Play é um destino próprio. Não requer Artist Mapping externo nem conector DSP.
insert into distribution_platforms(code,name,requires_isrc,requires_upc,active,status)
values ('BABULO_PLAY','BaBuLo Play',false,false,true,'READY')
on conflict(code) do update
set name=excluded.name,
    requires_isrc=false,
    requires_upc=false,
    active=true,
    status='READY';
