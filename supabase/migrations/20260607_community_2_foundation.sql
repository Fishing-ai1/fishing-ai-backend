-- OceanCore Community 2.0 foundation

alter table public.community_posts add column if not exists author_name text;
alter table public.community_posts add column if not exists caption text;
alter table public.community_posts add column if not exists category text not null default 'local';
alter table public.community_posts add column if not exists post_type text not null default 'discussion';
alter table public.community_posts add column if not exists topic text;
alter table public.community_posts add column if not exists bait text;
alter table public.community_posts add column if not exists conditions text;
alter table public.community_posts add column if not exists length_cm numeric;
alter table public.community_posts add column if not exists weight_kg numeric;
alter table public.community_posts add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.community_posts add column if not exists poll_question text;
alter table public.community_posts add column if not exists poll_options jsonb not null default '[]'::jsonb;
alter table public.community_posts add column if not exists privacy text not null default 'public';
alter table public.community_posts add column if not exists media_mime text;
alter table public.community_posts add column if not exists allow_comments boolean not null default true;
alter table public.community_posts add column if not exists comment_permission text not null default 'everyone';
alter table public.community_posts add column if not exists hold_link_comments boolean not null default true;
alter table public.community_posts add column if not exists blocked_words text not null default '';
alter table public.community_posts add column if not exists upload_quality text not null default 'hd';
alter table public.community_posts add column if not exists status text not null default 'active';

update public.community_posts
set
  author_name = coalesce(author_name, display_name, user_email, 'OceanCore fisher'),
  caption = coalesce(caption, body, ''),
  privacy = coalesce(nullif(privacy, ''), visibility, 'public')
where author_name is null or caption is null or privacy is null;

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  author_name text,
  body text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  reason text not null default 'user_report',
  notes text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create index if not exists community_comments_post_idx on public.community_comments(post_id, created_at asc);
create index if not exists community_reports_status_idx on public.community_reports(status, created_at desc);

alter table public.community_follows enable row level security;
alter table public.community_poll_votes enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reports enable row level security;

drop policy if exists "community follows readable" on public.community_follows;
create policy "community follows readable" on public.community_follows for select using (true);
drop policy if exists "community own follows" on public.community_follows;
create policy "community own follows" on public.community_follows for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);
drop policy if exists "community poll votes readable" on public.community_poll_votes;
create policy "community poll votes readable" on public.community_poll_votes for select using (true);
drop policy if exists "community own poll votes" on public.community_poll_votes;
create policy "community own poll votes" on public.community_poll_votes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
