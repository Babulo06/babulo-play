-- BaBuLo Play V10.4.3: funções e permissões granulares dos ADMIN
alter table users add column if not exists admin_title text;
alter table users add column if not exists admin_permissions jsonb not null default '["USERS","ARTISTS","TEAM","RELEASES","FINANCE","WITHDRAWALS","MODERATION","ANALYTICS","SETTINGS"]'::jsonb;

update users
set admin_permissions='["USERS","ARTISTS","TEAM","RELEASES","FINANCE","WITHDRAWALS","MODERATION","ANALYTICS","SETTINGS"]'::jsonb
where role='ADMIN' and (admin_permissions is null or jsonb_array_length(admin_permissions)=0);

create index if not exists idx_users_admin_permissions on users using gin(admin_permissions);
