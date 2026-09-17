-- V10.4.18 — Distribution Engine: jobs, connector logs and idempotency
create table if not exists distribution_jobs(
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null references distribution_deliveries(id) on delete cascade,
 order_id uuid not null references distribution_orders(id) on delete cascade,
 platform_id uuid not null references distribution_platforms(id) on delete cascade,
 job_type text not null default 'DELIVER_RELEASE' check(job_type in ('DELIVER_RELEASE','RETRY')),
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 attempt_count integer not null default 0,
 idempotency_key text not null unique,
 request_id text,
 last_http_status integer,
 last_error text,
 next_attempt_at timestamptz,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_distribution_jobs_delivery on distribution_jobs(delivery_id,created_at desc);
create index if not exists idx_distribution_jobs_queue on distribution_jobs(status,next_attempt_at,created_at);
create table if not exists distribution_connector_logs(
 id uuid primary key default gen_random_uuid(),
 job_id uuid references distribution_jobs(id) on delete cascade,
 platform_id uuid references distribution_platforms(id) on delete set null,
 direction text not null check(direction in ('OUTBOUND','INBOUND')),
 http_status integer,
 response_body text,
 error_message text,
 created_at timestamptz not null default now()
);
create index if not exists idx_distribution_connector_logs_job on distribution_connector_logs(job_id,created_at desc);
