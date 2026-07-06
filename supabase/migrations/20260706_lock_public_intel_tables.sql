-- Lock down public-schema data tables flagged by Supabase Advisor.
-- These tables are used as backend/reference/intelligence data. The browser
-- should go through the OceanCore backend, not direct Supabase table access.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_embeddings',
    'spot_cells',
    'species_patterns',
    'weather_fcst',
    'audit_log',
    'boat_models',
    'outboard_models',
    'community_post_views',
    'boat_ai_learning_events'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format('grant all on table public.%I to service_role', table_name);
    end if;
  end loop;
end $$;

-- Main user-owned tables. These statements are repeated here so production can
-- be brought into line even if the original baseline was only partly applied.
alter table if exists public.profiles enable row level security;
alter table if exists public.account_settings enable row level security;
alter table if exists public.catches enable row level security;
alter table if exists public.saved_areas enable row level security;
alter table if exists public.feedback_reports enable row level security;
alter table if exists public.community_posts enable row level security;
alter table if exists public.community_comments enable row level security;
alter table if exists public.community_likes enable row level security;
alter table if exists public.community_reports enable row level security;
alter table if exists public.community_follows enable row level security;
alter table if exists public.community_poll_votes enable row level security;
alter table if exists public.ai_chat_sessions enable row level security;
alter table if exists public.ai_chat_messages enable row level security;
alter table if exists public.ai_memory enable row level security;
alter table if exists public.ai_feedback enable row level security;
alter table if exists public.usage_daily enable row level security;
alter table if exists public.reward_ledger enable row level security;
alter table if exists public.boat_ai_trip_logs enable row level security;

drop policy if exists "profiles own rows" on public.profiles;
create policy "profiles own rows" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "account settings own row" on public.account_settings;
create policy "account settings own row" on public.account_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "catches own rows" on public.catches;
create policy "catches own rows" on public.catches
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "saved areas own rows" on public.saved_areas;
create policy "saved areas own rows" on public.saved_areas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "feedback own rows" on public.feedback_reports;
create policy "feedback own rows" on public.feedback_reports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "community public reads" on public.community_posts;
create policy "community public reads" on public.community_posts
  for select to anon, authenticated
  using (status = 'active' and privacy <> 'private');

drop policy if exists "community own posts" on public.community_posts;
create policy "community own posts" on public.community_posts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "community comments readable" on public.community_comments;
create policy "community comments readable" on public.community_comments
  for select to anon, authenticated
  using (status = 'active');

drop policy if exists "community own comments" on public.community_comments;
create policy "community own comments" on public.community_comments
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "community own likes" on public.community_likes;
create policy "community own likes" on public.community_likes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "community own reports" on public.community_reports;
create policy "community own reports" on public.community_reports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "community follows readable" on public.community_follows;
create policy "community follows readable" on public.community_follows
  for select to anon, authenticated
  using (true);

drop policy if exists "community own follows" on public.community_follows;
create policy "community own follows" on public.community_follows
  for all to authenticated
  using ((select auth.uid()) = follower_id)
  with check ((select auth.uid()) = follower_id);

drop policy if exists "community poll votes readable" on public.community_poll_votes;
create policy "community poll votes readable" on public.community_poll_votes
  for select to anon, authenticated
  using (true);

drop policy if exists "community own poll votes" on public.community_poll_votes;
create policy "community own poll votes" on public.community_poll_votes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "ai sessions own rows" on public.ai_chat_sessions;
create policy "ai sessions own rows" on public.ai_chat_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "ai messages own rows" on public.ai_chat_messages;
create policy "ai messages own rows" on public.ai_chat_messages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "ai memory own rows" on public.ai_memory;
create policy "ai memory own rows" on public.ai_memory
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "ai feedback own rows" on public.ai_feedback;
create policy "ai feedback own rows" on public.ai_feedback
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "usage own rows" on public.usage_daily;
create policy "usage own rows" on public.usage_daily
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "reward ledger own reads" on public.reward_ledger;
create policy "reward ledger own reads" on public.reward_ledger
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "boat trips own rows" on public.boat_ai_trip_logs;
create policy "boat trips own rows" on public.boat_ai_trip_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
