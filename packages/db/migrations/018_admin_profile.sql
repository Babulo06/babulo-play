-- BaBuLo Play V10.4.5: perfil pessoal dos ADMIN
alter table users add column if not exists full_name text;
alter table users add column if not exists birth_date date;
create index if not exists idx_users_admin_profile on users(role,full_name,birth_date);
