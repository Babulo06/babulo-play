alter table releases add column if not exists preflight_status text not null default 'NOT_CHECKED';
alter table releases add column if not exists preflight_reason text;
alter table releases add column if not exists submitted_at timestamptz;
alter table tracks add column if not exists isrc_status text not null default 'NOT_PROVIDED';
alter table tracks add column if not exists isrc_source text;
