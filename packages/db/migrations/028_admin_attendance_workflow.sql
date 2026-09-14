-- BaBuLo Play V10.4.11: workflow de faltas/justificações dos ADMINs
alter table admin_attendance add column if not exists justification_status text not null default 'NONE' check(justification_status in ('NONE','PENDING','APPROVED','REJECTED'));
alter table admin_attendance add column if not exists submitted_by uuid references users(id) on delete set null;
alter table admin_attendance add column if not exists submitted_at timestamptz;
alter table admin_attendance add column if not exists review_reason text;
update admin_attendance set justification_status=case when status='EXCUSED' then 'APPROVED' else 'NONE' end where justification_status='NONE';
create index if not exists idx_admin_attendance_pending on admin_attendance(justification_status,attendance_date desc) where justification_status='PENDING';
