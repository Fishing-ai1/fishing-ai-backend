-- Reviewed against deployed schema 2026-09-08. No deletion or coordinate publication.
begin;
set local lock_timeout='5s';
alter table public.catches add column if not exists general_area text;
alter table public.catches add column if not exists privacy text not null default 'private';
-- Geography remains optional. Existing records are never assigned a guessed country.
do $$ declare t text; begin
 foreach t in array array['profiles','catches','saved_areas','community_posts','boat_ai_trip_logs','trip_logs','boat_models','outboard_models','ramps','fuel_stations'] loop
  if to_regclass('public.'||t) is not null then
   execute format('alter table public.%I add column if not exists country text references public.oc_countries(code), add column if not exists subdivision text, add column if not exists region text, add column if not exists locality text, add column if not exists timezone text, add column if not exists marine_region text',t);
   execute format('create index if not exists %I on public.%I(country,subdivision)',t||'_oc_country',t);
  end if;
 end loop;
 -- These legacy tables are not used for direct browser access in the active frontend.
 foreach t in array array['ai_catch_features','ai_doc_chunks','ai_docs','ai_memories','chat_sessions','env_ticks','fuel_spots','grid_stats','model_features','ramp_sites','restricted_zones','undersized_summary'] loop
  if to_regclass('public.'||t) is not null then
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from anon,authenticated',t);
  end if;
 end loop;
 foreach t in array array['ai_species_means','undersize_area_30d','boat_ai_trip_accuracy_summary'] loop
  if to_regclass('public.'||t) is not null then
   execute format('alter view public.%I set (security_invoker=true)',t);
   execute format('revoke all on public.%I from anon,authenticated',t);
  end if;
 end loop;
end $$;
-- User-owned rows must not grant users control of billing, role or moderation columns.
revoke insert,update,delete on public.profiles from anon,authenticated;
grant update(full_name,username,boat_name,home_port,favourite_species,avatar_url) on public.profiles to authenticated;
revoke insert,update,delete on public.usage_daily from anon,authenticated;
revoke all on public.audit_log from anon,authenticated;
alter table public.audit_log enable row level security;
create trigger oc_legacy_audit_immutable before update or delete or truncate on public.audit_log for each statement execute function public.oc_immutable_audit();
-- Restrictive policies intersect ALL old permissive policies; old visibility aliases cannot defeat privacy.
create policy oc_post_privacy_gate on public.community_posts as restrictive for select to anon,authenticated
 using (user_id=(select auth.uid()) or (status='active' and privacy in ('public','area_only')));
create policy oc_comment_parent_gate on public.community_comments as restrictive for select to anon,authenticated
 using (exists(select 1 from public.community_posts p where p.id=post_id));
create index if not exists oc_catches_owner_time on public.catches(user_id,created_at desc,id);
create index if not exists oc_profiles_signup on public.profiles(created_at desc,id);
commit;
