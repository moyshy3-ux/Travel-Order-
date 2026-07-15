-- ============================================================
-- Travel Order Tracking System - Supabase Schema
-- Run this whole file once in Supabase SQL Editor
-- ============================================================

-- Note: gen_random_uuid() is built into Supabase's Postgres (v13+) natively,
-- no CREATE EXTENSION needed. (Older versions of this file tried to run
-- "create extension pgcrypto" here, which some Supabase projects block
-- in the SQL editor with "cannot execute CREATE EXTENSION in a read-only
-- transaction" — safe to skip entirely.)

create table if not exists travel_orders (
  id uuid primary key default gen_random_uuid(),
  to_no text unique,                    -- auto-generated, e.g. 07-01-26
  seq_number int,                       -- resets every month, e.g. 1, 2, 3...
  order_month int,                      -- 1-12, derived from date_of_travel_order
  order_year int,                       -- full year, e.g. 2026, derived from date_of_travel_order
  date_of_travel_order date not null,
  name_of_personnel text not null,
  division text not null default '',
  status text not null default 'Still in the Office'
    check (status in ('Still in the Office', 'Disseminated to Region', 'Received from Region')),
  date_disseminated_to_region date,
  date_received date,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_travel_orders_month_year on travel_orders (order_year, order_month);
create index if not exists idx_travel_orders_date on travel_orders (date_of_travel_order);

-- ------------------------------------------------------------
-- Auto-numbering trigger
-- Format: MM-SEQ-YY  (e.g. 07-01-26, 07-02-26 ... resets to 01 in Aug)
-- SEQ has no fixed cap: 1,2,...9,10,...99,100 (no truncation past 99)
-- ------------------------------------------------------------
create or replace function generate_travel_order_number()
returns trigger as $$
declare
  next_seq int;
begin
  new.order_month := extract(month from new.date_of_travel_order);
  new.order_year  := extract(year from new.date_of_travel_order);

  -- lock existing rows for this month/year so concurrent inserts don't collide
  select coalesce(max(seq_number), 0) + 1
    into next_seq
    from travel_orders
    where order_month = new.order_month
      and order_year = new.order_year
    for update;

  new.seq_number := next_seq;
  new.to_no := lpad(new.order_month::text, 2, '0')
            || '-' || lpad(next_seq::text, 2, '0')
            || '-' || lpad((new.order_year % 100)::text, 2, '0');

  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generate_to_number on travel_orders;
create trigger trg_generate_to_number
  before insert on travel_orders
  for each row
  execute function generate_travel_order_number();

-- keep updated_at fresh on edits
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_updated_at on travel_orders;
create trigger trg_touch_updated_at
  before update on travel_orders
  for each row
  execute function touch_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- The backend talks to Supabase using the SERVICE ROLE key, which
-- bypasses RLS entirely. We enable RLS with NO policies so that if
-- the anon/public key ever leaks or is used directly from a browser,
-- it cannot read or write this table.
-- ------------------------------------------------------------
alter table travel_orders enable row level security;
