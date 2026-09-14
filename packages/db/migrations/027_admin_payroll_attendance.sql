-- BaBuLo Play V10.4.10: controlo de remuneração, faltas e descontos dos ADMINs pelo OWNER
create table if not exists admin_payroll_settings(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null unique references users(id) on delete cascade,
 daily_rate numeric(18,2) not null default 0 check(daily_rate>=0),
 monthly_salary numeric(18,2) not null default 0 check(monthly_salary>=0),
 currency text not null default 'AOA',
 effective_from date not null default current_date,
 updated_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists admin_attendance(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references users(id) on delete cascade,
 attendance_date date not null,
 status text not null default 'ABSENT' check(status in ('PRESENT','ABSENT','EXCUSED')),
 note text,
 justification_document_key text,
 justification_document_name text,
 justification_mime_type text,
 reviewed_by uuid references users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(admin_user_id,attendance_date)
);
create index if not exists idx_admin_attendance_admin_date on admin_attendance(admin_user_id,attendance_date desc);

create table if not exists admin_payroll_adjustments(
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references users(id) on delete cascade,
 adjustment_type text not null default 'DISCOUNT' check(adjustment_type in ('DISCOUNT','BONUS')),
 amount numeric(18,2) not null check(amount>0),
 reference_month text not null,
 description text not null,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists idx_admin_payroll_adjustments_admin_month on admin_payroll_adjustments(admin_user_id,reference_month,created_at desc);
