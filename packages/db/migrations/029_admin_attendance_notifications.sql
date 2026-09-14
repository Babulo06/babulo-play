-- V10.4.12: faltas marcadas pelo Owner + notificações ao ADMIN
alter table admin_attendance add column if not exists marked_by uuid references users(id) on delete set null;
alter table admin_attendance add column if not exists marked_at timestamptz;
create index if not exists idx_admin_attendance_marked_by on admin_attendance(marked_by,attendance_date desc);

create table if not exists admin_notifications(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references users(id) on delete cascade,
 type text not null,
 title text not null,
 message text not null,
 reference_id uuid,
 read_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_admin_notifications_admin_created on admin_notifications(admin_user_id,created_at desc);
