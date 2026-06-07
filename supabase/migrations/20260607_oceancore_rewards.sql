-- OceanCore Rewards Phase 1
-- Apply once in the Supabase SQL editor before enabling cloud OceanPoints.

create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  event_type text not null,
  event_key text not null,
  points integer not null check (points <> 0),
  title text not null,
  source_type text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'earned',
  created_at timestamptz not null default now(),
  unique(user_id, event_key)
);

create index if not exists reward_ledger_user_created_idx
  on public.reward_ledger(user_id, created_at desc);

create index if not exists reward_ledger_user_event_idx
  on public.reward_ledger(user_id, event_type, created_at desc);

alter table public.reward_ledger enable row level security;

drop policy if exists "reward ledger own reads" on public.reward_ledger;
create policy "reward ledger own reads"
  on public.reward_ledger
  for select
  using (auth.uid() = user_id);
