-- Shared ledger row — one row for the whole shop
create table if not exists public.ledger_state (
  id          text primary key default 'main',
  data        jsonb not null default '{}'::jsonb,
  version     bigint not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- Insert the singleton row if it doesn't exist yet
insert into public.ledger_state (id, data, version)
values ('main', '{}'::jsonb, 0)
on conflict (id) do nothing;

-- Admin table
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.ledger_state enable row level security;
alter table public.admins      enable row level security;

-- Policies: only admins can read/write the ledger
drop policy if exists "admin read"   on public.ledger_state;
drop policy if exists "admin insert" on public.ledger_state;
drop policy if exists "admin update" on public.ledger_state;
drop policy if exists "self check"   on public.admins;

create policy "admin read" on public.ledger_state for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
create policy "admin insert" on public.ledger_state for insert
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
create policy "admin update" on public.ledger_state for update
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy "self check" on public.admins for select
  using (user_id = auth.uid());

-- Register the two admin users (replace with your real emails)
insert into public.admins (user_id)
select id from auth.users
where email in ('sammali.sd@gmail.com','saman.dware15@gmail.com')
on conflict do nothing;

-- If the old per-user table still exists, drop it so it can't confuse anyone
drop table if exists public.ledger_data;
