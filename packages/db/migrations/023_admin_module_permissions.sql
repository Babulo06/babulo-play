-- V10.4.7: permissões operacionais de Publicidade e Segurança para ADMIN
alter table users alter column admin_permissions set default '["USERS","ARTISTS","TEAM","RELEASES","FINANCE","WITHDRAWALS","MODERATION","ANALYTICS","ADS","SECURITY","SETTINGS"]'::jsonb;
