-- OceanCore AI production schema baseline.
-- Run this in the Supabase SQL editor, then restart/deploy the backend.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  username text,
  boat_name text,
  home_port text,
  favourite_species text,
  role_plan text,
  avatar_url text,
  accepted_terms_at timestamptz,
  accepted_privacy_at timestamptz,
  accepted_disclaimer_at timestamptz,
  legal_version text,
  app_role text not null default 'user',
  plan text not null default 'free',
  subscription_status text not null default 'none',
  account_status text not null default 'active',
  admin_notes text,
  suspended_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_current_period_end timestamptz,
  subscription_cancel_at_period_end boolean not null default false,
  ads_enabled boolean not null default true,
  ai_daily_limit integer not null default 5,
  saved_area_limit integer not null default 3,
  catch_card_level text not null default 'basic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_email text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  species text,
  weight_kg numeric,
  length_cm numeric,
  legal_limit_cm numeric,
  is_legal boolean,
  lat numeric,
  lng numeric,
  general_area text,
  privacy text not null default 'private',
  notes text,
  photo_url text,
  photo_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  area_type text default 'custom',
  lat numeric,
  lng numeric,
  radius_km numeric default 35,
  general_area text,
  notes text,
  privacy text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  type text not null default 'bug',
  message text not null,
  page text,
  status text not null default 'open',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  author_name text,
  species text,
  title text,
  caption text,
  general_area text,
  privacy text not null default 'public',
  category text not null default 'feed',
  media_url text,
  media_mime text,
  media_type text,
  media_storage_path text,
  allow_comments boolean not null default true,
  comment_permission text not null default 'everyone',
  hold_link_comments boolean not null default true,
  blocked_words text,
  upload_quality text not null default 'hd',
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  reports_count integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.community_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  created_at timestamptz not null default now(),
  unique(post_id, user_id)
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  reason text not null default 'user_report',
  notes text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  feedback text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_key text not null,
  memory_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, memory_key)
);

create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  message_id uuid,
  rating text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  ai_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, usage_date)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.boat_models (
  id uuid primary key default gen_random_uuid(),
  brand text,
  model text,
  material text,
  hull_type text,
  hull_shape text,
  category text,
  loa_m numeric,
  beam_m numeric,
  fuel_l numeric,
  dry_tow_weight_kg numeric,
  min_hp numeric,
  max_hp numeric,
  persons integer,
  year_from integer,
  year_to integer,
  source_name text,
  data_quality text,
  search_keywords text,
  created_at timestamptz not null default now()
);

create table if not exists public.outboard_models (
  id uuid primary key default gen_random_uuid(),
  brand text,
  model text,
  hp numeric,
  engine_type text,
  stroke_type text,
  fuel_type text,
  year_from integer,
  year_to integer,
  source_name text,
  data_quality text,
  search_keywords text,
  created_at timestamptz not null default now()
);

create table if not exists public.boat_ai_trip_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  boat_name text,
  hull_type text,
  loa_m numeric,
  beam_m numeric,
  loaded_weight_kg numeric,
  hp numeric,
  engine_type text,
  engine_count integer,
  trip_type text,
  distance_km numeric,
  extra_km numeric,
  avg_speed_kn numeric,
  wind_state text,
  swell_state text,
  wind_angle text,
  fuel_onboard_l numeric,
  reserve_percent numeric,
  predicted_burn_lph numeric,
  predicted_trip_fuel_l numeric,
  actual_trip_fuel_l numeric,
  prediction_error_percent numeric,
  decision text,
  confidence numeric,
  spare_above_reserve_l numeric,
  return_bias_percent numeric,
  data_quality_score numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.boat_ai_learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  trip_log_id uuid references public.boat_ai_trip_logs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.community_posts add column if not exists author_name text;
alter table public.community_posts add column if not exists media_mime text;
alter table public.community_posts add column if not exists allow_comments boolean not null default true;
alter table public.community_posts add column if not exists comment_permission text not null default 'everyone';
alter table public.community_posts add column if not exists hold_link_comments boolean not null default true;
alter table public.community_posts add column if not exists blocked_words text;
alter table public.community_posts add column if not exists upload_quality text not null default 'hd';
alter table public.community_comments add column if not exists author_name text;
alter table public.community_likes add column if not exists user_email text;
alter table public.community_reports add column if not exists notes text;
alter table public.catches add column if not exists general_area text;
alter table public.catches add column if not exists privacy text not null default 'private';

create index if not exists catches_user_created_idx on public.catches(user_id, created_at desc);
create index if not exists account_settings_updated_idx on public.account_settings(updated_at desc);
create index if not exists saved_areas_user_idx on public.saved_areas(user_id, created_at desc);
create index if not exists community_posts_status_created_idx on public.community_posts(status, created_at desc);
create index if not exists community_posts_user_idx on public.community_posts(user_id, created_at desc);
create index if not exists community_comments_post_idx on public.community_comments(post_id, created_at asc);
create index if not exists community_reports_status_idx on public.community_reports(status, created_at desc);
create index if not exists ai_messages_session_idx on public.ai_chat_messages(session_id, created_at asc);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);
create index if not exists boat_models_search_idx on public.boat_models using gin (to_tsvector('simple', coalesce(search_keywords,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(model,'')));
create index if not exists outboard_models_search_idx on public.outboard_models using gin (to_tsvector('simple', coalesce(search_keywords,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(model,'')));

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'profiles','account_settings','catches','saved_areas','feedback_reports','community_posts',
    'community_comments','community_reports','ai_chat_sessions','ai_memory','usage_daily'
  ]
  loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', tbl, tbl);
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', tbl, tbl);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.account_settings enable row level security;
alter table public.catches enable row level security;
alter table public.saved_areas enable row level security;
alter table public.feedback_reports enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_reports enable row level security;
alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_messages enable row level security;
alter table public.ai_memory enable row level security;
alter table public.ai_feedback enable row level security;
alter table public.usage_daily enable row level security;
alter table public.boat_ai_trip_logs enable row level security;
alter table public.boat_ai_learning_events enable row level security;

-- The backend uses the service-role key for trusted writes. These RLS policies
-- make direct client reads/writes safe if the frontend later uses Supabase JS.
drop policy if exists "profiles own rows" on public.profiles;
create policy "profiles own rows" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "account settings own row" on public.account_settings;
create policy "account settings own row" on public.account_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "catches own rows" on public.catches;
create policy "catches own rows" on public.catches for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "saved areas own rows" on public.saved_areas;
create policy "saved areas own rows" on public.saved_areas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "feedback own rows" on public.feedback_reports;
create policy "feedback own rows" on public.feedback_reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "community public reads" on public.community_posts;
create policy "community public reads" on public.community_posts for select using (status = 'active' and privacy <> 'private');
drop policy if exists "community own posts" on public.community_posts;
create policy "community own posts" on public.community_posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "community comments readable" on public.community_comments;
create policy "community comments readable" on public.community_comments for select using (status = 'active');
drop policy if exists "community own comments" on public.community_comments;
create policy "community own comments" on public.community_comments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "community own likes" on public.community_likes;
create policy "community own likes" on public.community_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "community own reports" on public.community_reports;
create policy "community own reports" on public.community_reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai sessions own rows" on public.ai_chat_sessions;
create policy "ai sessions own rows" on public.ai_chat_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai messages own rows" on public.ai_chat_messages;
create policy "ai messages own rows" on public.ai_chat_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai memory own rows" on public.ai_memory;
create policy "ai memory own rows" on public.ai_memory for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai feedback own rows" on public.ai_feedback;
create policy "ai feedback own rows" on public.ai_feedback for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "usage own rows" on public.usage_daily;
create policy "usage own rows" on public.usage_daily for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "boat trips own rows" on public.boat_ai_trip_logs;
create policy "boat trips own rows" on public.boat_ai_trip_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
