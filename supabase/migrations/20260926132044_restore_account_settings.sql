create table if not exists public.account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_email text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists account_settings_updated_idx
  on public.account_settings (updated_at desc);
alter table public.account_settings enable row level security;
revoke all on public.account_settings from public, anon;
grant select, insert, update, delete on public.account_settings to authenticated;
grant all on public.account_settings to service_role;
create policy account_settings_owner on public.account_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
