-- OceanCore Community 2.0 foundation

alter table public.community_posts add column if not exists post_type text not null default 'discussion';
alter table public.community_posts add column if not exists topic text;
alter table public.community_posts add column if not exists bait text;
alter table public.community_posts add column if not exists conditions text;
alter table public.community_posts add column if not exists length_cm numeric;
alter table public.community_posts add column if not exists weight_kg numeric;
alter table public.community_posts add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.community_posts add column if not exists poll_question text;
alter table public.community_posts add column if not exists poll_options jsonb not null default '[]'::jsonb;

create table if not exists public.community_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id, following_id),
  check(follower_id <> following_id)
);

create table if not exists public.community_poll_votes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  option_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id, user_id)
);

create index if not exists community_follows_following_idx on public.community_follows(following_id, created_at desc);
create index if not exists community_posts_category_idx on public.community_posts(category, created_at desc);
create index if not exists community_posts_type_idx on public.community_posts(post_type, created_at desc);

alter table public.community_follows enable row level security;
alter table public.community_poll_votes enable row level security;

drop policy if exists "community follows readable" on public.community_follows;
create policy "community follows readable" on public.community_follows for select using (true);
drop policy if exists "community own follows" on public.community_follows;
create policy "community own follows" on public.community_follows for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);
drop policy if exists "community poll votes readable" on public.community_poll_votes;
create policy "community poll votes readable" on public.community_poll_votes for select using (true);
drop policy if exists "community own poll votes" on public.community_poll_votes;
create policy "community own poll votes" on public.community_poll_votes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
