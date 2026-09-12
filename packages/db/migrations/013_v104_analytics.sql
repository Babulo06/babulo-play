-- BaBuLo Play V10.4: analytics de audiência e geografia aproximada
-- Não guarda IP bruto. listener_key é um identificador técnico não reversível para métricas agregadas.
alter table stream_events add column if not exists listener_country text;
alter table stream_events add column if not exists listener_city text;
alter table stream_events add column if not exists listener_key text;
create index if not exists idx_stream_events_geo on stream_events(listener_country,listener_city,occurred_at);
create index if not exists idx_stream_events_listener_key on stream_events(listener_key,occurred_at);
