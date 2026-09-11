-- BaBuLo Play V9: Payment Engine
create table if not exists payment_products(
 id uuid primary key default gen_random_uuid(),
 code text unique not null,
 service_type text not null check(service_type in ('SUBSCRIPTION','DISTRIBUTION')),
 name text not null,
 amount numeric(18,2) not null check(amount>=0),
 currency text not null default 'AOA',
 duration_days integer,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists payment_transactions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid references users(id) on delete set null,
 product_id uuid references payment_products(id) on delete set null,
 service_type text not null,
 payment_method text not null,
 gateway text,
 gateway_transaction_id text,
 reference text unique,
 idempotency_key text unique,
 amount numeric(18,2) not null,
 currency text not null default 'AOA',
 gateway_fee numeric(18,2) not null default 0,
 net_amount numeric(18,2) not null default 0,
 status text not null default 'PENDING' check(status in ('PENDING','PAID','FAILED','CANCELLED','REFUNDED')),
 metadata jsonb not null default '{}'::jsonb,
 paid_at timestamptz,
 failed_at timestamptz,
 refunded_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_payment_transactions_user on payment_transactions(user_id,created_at desc);
create index if not exists idx_payment_transactions_status on payment_transactions(status,created_at desc);

create table if not exists subscriptions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references users(id) on delete cascade,
 product_id uuid not null references payment_products(id),
 payment_transaction_id uuid references payment_transactions(id) on delete set null,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','EXPIRED','CANCELLED')),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 auto_renew boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_user on subscriptions(user_id,status,ends_at desc);

create table if not exists payment_webhook_events(
 id uuid primary key default gen_random_uuid(),
 gateway text not null,
 event_id text not null,
 event_type text,
 payload jsonb not null,
 processed boolean not null default false,
 processed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(gateway,event_id)
);

insert into payment_products(code,service_type,name,amount,duration_days) values
 ('SUB_DAILY','SUBSCRIPTION','Diário',1000,1),
 ('SUB_WEEKLY','SUBSCRIPTION','Semanal',5000,7),
 ('SUB_MONTHLY','SUBSCRIPTION','Mensal',8000,30),
 ('SUB_3_MONTHS','SUBSCRIPTION','3 meses',22000,90),
 ('DIST_SINGLE','DISTRIBUTION','Single',5000,null),
 ('DIST_EP','DISTRIBUTION','EP',10000,null),
 ('DIST_ALBUM','DISTRIBUTION','Album',14000,null),
 ('DIST_ALBUM_PRO','DISTRIBUTION','Album Pro',20000,null)
on conflict(code) do update set amount=excluded.amount,duration_days=excluded.duration_days,updated_at=now();
