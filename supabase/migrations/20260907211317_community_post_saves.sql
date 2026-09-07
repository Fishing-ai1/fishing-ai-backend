-- Cross-device saved posts for the existing community feed.
-- This intentionally references community_posts while the newer content_items
-- migration is rolled out behind feature flags.

create table if not exists public.community_saves (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_saves_user_created_idx
  on public.community_saves(user_id, created_at desc);

alter table public.community_saves enable row level security;

drop policy if exists "community saves own rows" on public.community_saves;
create policy "community saves own rows" on public.community_saves
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
