-- OceanCore Social Platform Foundation
-- Non-destructive Phase 1 schema. Existing community_* tables stay in place.

create extension if not exists pgcrypto;

create table if not exists public.social_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  legacy_community_post_id uuid unique,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_email text,
  content_type text not null check (content_type in (
    'standard_post',
    'catch_post',
    'boat_post',
    'video',
    'short_video',
    'trip_post',
    'question_post',
    'poll_post'
  )),
  status text not null default 'active' check (status in ('draft','active','processing','restricted','under_review','removed','deleted')),
  visibility text not null default 'public' check (visibility in ('public','followers','group','private')),
  title text,
  body text,
  general_location text,
  precise_location_private jsonb,
  tagged_species text[] not null default '{}',
  tagged_boats uuid[] not null default '{}',
  tagged_users uuid[] not null default '{}',
  hashtags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  score numeric not null default 0,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  saves_count integer not null default 0,
  shares_count integer not null default 0,
  views_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_media (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'supabase',
  provider_asset_id text,
  media_type text not null check (media_type in ('image','video','audio','document')),
  mime_type text,
  url text,
  thumbnail_url text,
  duration_seconds integer,
  width integer,
  height integer,
  processing_status text not null default 'ready' check (processing_status in ('pending','uploading','processing','ready','failed','removed')),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.content_entities (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  entity_slug text,
  label text,
  confidence numeric,
  source text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists public.social_reactions (
  content_id uuid not null references public.content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (content_id, user_id, reaction_type)
);

create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  parent_comment_id uuid references public.social_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  body text not null,
  status text not null default 'active' check (status in ('active','held','hidden','deleted','removed')),
  likes_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_saves (
  content_id uuid not null references public.content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_name text not null default 'Saved',
  created_at timestamptz not null default now(),
  primary key (content_id, user_id, collection_name)
);

create table if not exists public.social_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('user','creator','boat','business','group','topic')),
  target_id uuid not null,
  status text not null default 'active' check (status in ('active','muted','blocked','pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, target_type, target_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null,
  target_type text,
  target_id uuid,
  title text,
  body text,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id text,
  event_name text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_items_feed_idx on public.content_items(status, visibility, created_at desc);
create index if not exists content_items_author_idx on public.content_items(author_id, created_at desc);
create index if not exists content_items_type_idx on public.content_items(content_type, created_at desc);
create index if not exists content_media_content_idx on public.content_media(content_id, sort_order asc);
create index if not exists content_entities_content_idx on public.content_entities(content_id);
create index if not exists content_entities_lookup_idx on public.content_entities(entity_type, entity_slug);
create index if not exists social_comments_content_idx on public.social_comments(content_id, created_at asc);
create index if not exists social_saves_user_idx on public.social_saves(user_id, created_at desc);
create index if not exists social_follows_target_idx on public.social_follows(target_type, target_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications(user_id, read_at, created_at desc);
create index if not exists analytics_events_name_idx on public.analytics_events(event_name, created_at desc);
create index if not exists analytics_events_target_idx on public.analytics_events(target_type, target_id, created_at desc);

alter table public.social_feature_flags enable row level security;
alter table public.content_items enable row level security;
alter table public.content_media enable row level security;
alter table public.content_entities enable row level security;
alter table public.social_reactions enable row level security;
alter table public.social_comments enable row level security;
alter table public.social_saves enable row level security;
alter table public.social_follows enable row level security;
alter table public.notifications enable row level security;
alter table public.analytics_events enable row level security;

drop policy if exists "feature flags public read" on public.social_feature_flags;
create policy "feature flags public read" on public.social_feature_flags
  for select
  to anon, authenticated
  using (true);

drop policy if exists "content public read" on public.content_items;
create policy "content public read" on public.content_items
  for select
  to anon, authenticated
  using (status = 'active' and visibility = 'public');

drop policy if exists "content own rows" on public.content_items;
create policy "content own rows" on public.content_items
  for all
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

drop policy if exists "content media public read" on public.content_media;
create policy "content media public read" on public.content_media
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.content_items ci
    where ci.id = content_media.content_id
      and ci.status = 'active'
      and ci.visibility = 'public'
  ));

drop policy if exists "content media own rows" on public.content_media;
create policy "content media own rows" on public.content_media
  for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "content entities public read" on public.content_entities;
create policy "content entities public read" on public.content_entities
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.content_items ci
    where ci.id = content_entities.content_id
      and ci.status = 'active'
      and ci.visibility = 'public'
  ));

drop policy if exists "content entities author manage" on public.content_entities;
create policy "content entities author manage" on public.content_entities
  for all
  to authenticated
  using (exists (
    select 1 from public.content_items ci
    where ci.id = content_entities.content_id
      and ci.author_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.content_items ci
    where ci.id = content_entities.content_id
      and ci.author_id = (select auth.uid())
  ));

drop policy if exists "reactions public read" on public.social_reactions;
create policy "reactions public read" on public.social_reactions
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.content_items ci
    where ci.id = social_reactions.content_id
      and ci.status = 'active'
      and ci.visibility = 'public'
  ));

drop policy if exists "reactions own rows" on public.social_reactions;
create policy "reactions own rows" on public.social_reactions
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "comments public read" on public.social_comments;
create policy "comments public read" on public.social_comments
  for select
  to anon, authenticated
  using (status = 'active' and exists (
    select 1 from public.content_items ci
    where ci.id = social_comments.content_id
      and ci.status = 'active'
      and ci.visibility = 'public'
  ));

drop policy if exists "comments own rows" on public.social_comments;
create policy "comments own rows" on public.social_comments
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "saves own rows" on public.social_saves;
create policy "saves own rows" on public.social_saves
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "follows public active read" on public.social_follows;
create policy "follows public active read" on public.social_follows
  for select
  to anon, authenticated
  using (status = 'active');

drop policy if exists "follows own rows" on public.social_follows;
create policy "follows own rows" on public.social_follows
  for all
  to authenticated
  using ((select auth.uid()) = follower_id)
  with check ((select auth.uid()) = follower_id);

drop policy if exists "notifications own rows" on public.notifications;
create policy "notifications own rows" on public.notifications
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "analytics own insert" on public.analytics_events;
create policy "analytics own insert" on public.analytics_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id or user_id is null);

insert into public.social_feature_flags (key, enabled, description)
values
  ('new_feed', false, 'New ranked social home feed'),
  ('watch', false, 'Long-form OceanCore Watch product'),
  ('shorts', false, 'Vertical short-form video feed'),
  ('groups', false, 'Marine community groups'),
  ('boat_profiles', false, 'First-class boat profile system'),
  ('new_profiles', false, 'Public profile/channel rebuild'),
  ('social_graph_v2', false, 'Universal follow graph for users, boats, businesses, groups and topics')
on conflict (key) do update
set description = excluded.description,
    updated_at = now();
