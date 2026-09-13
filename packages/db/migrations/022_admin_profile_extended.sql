-- BaBuLo Play V10.4.7: perfil administrativo completo
alter table users add column if not exists profile_photo_url text;
alter table users add column if not exists gender text;
alter table users add column if not exists height_cm numeric(5,2);
alter table users add column if not exists education text;
alter table users add column if not exists address text;
alter table users add column if not exists marital_status text;
