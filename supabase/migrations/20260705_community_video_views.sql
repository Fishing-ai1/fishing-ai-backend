alter table public.community_posts
  add column if not exists views_count bigint not null default 0;

alter table public.community_posts
  drop constraint if exists community_posts_views_count_check;

alter table public.community_posts
  add constraint community_posts_views_count_check check (views_count >= 0);

create table if not exists public.community_post_views (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.community_post_views enable row level security;
revoke all on table public.community_post_views from public, anon, authenticated;
grant select, insert, delete on table public.community_post_views to service_role;

create index if not exists community_post_views_post_id_idx
  on public.community_post_views(post_id);
