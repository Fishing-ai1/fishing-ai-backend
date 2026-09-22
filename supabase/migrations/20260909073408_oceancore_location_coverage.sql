-- Complete the optional regional envelope without assigning guessed geography to old rows.
begin;
set local lock_timeout='5s';
alter table public.oc_user_preferences add column marine_distance_unit text check(marine_distance_unit in ('km','mi','nm'));
do $$ declare t text; begin
 foreach t in array array['profiles','catches','saved_areas','community_posts','boat_ai_trip_logs','trip_logs','boat_models','outboard_models','user_boats','ramps','ramp_sites','fuel_stations','fuel_spots','fish_data','restricted_zones','content_items','content_entities','oc_records','oc_knowledge','oc_ai_requests'] loop
  if to_regclass('public.'||t) is not null then
   execute format('alter table public.%I add column if not exists country text, add column if not exists subdivision text, add column if not exists region text, add column if not exists locality text, add column if not exists latitude double precision, add column if not exists longitude double precision, add column if not exists timezone text, add column if not exists marine_region text, add column if not exists units text, add column if not exists waters text',t);
   execute format('alter table public.%I add constraint %I foreign key(country) references public.oc_countries(code) not valid',t,t||'_location_country');
   execute format('alter table public.%I add constraint %I foreign key(country,subdivision) references public.oc_subdivisions(country,code) not valid',t,t||'_location_subdivision');
   execute format('alter table public.%I add constraint %I check ((subdivision is null or country is not null) and (latitude is null)=(longitude is null) and (latitude is null or latitude between -90 and 90) and (longitude is null or longitude between -180 and 180) and (units is null or units in (''metric'',''us_customary'')) and (waters is null or waters in (''state'',''federal'',''inland''))) not valid',t,t||'_location_valid');
   execute format('create index if not exists %I on public.%I(country,subdivision)',t||'_oc_country',t);
  end if;
 end loop;
end $$;
-- New constraints apply to writes. Validate historical rows in staging before VALIDATE CONSTRAINT.

-- AI request context is a private snapshot of regional preferences, never exact GPS.
create function public.oc_ai_regional_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
declare prefs public.oc_user_preferences; begin
 select * into prefs from public.oc_user_preferences where user_id=new.user_id;
 if found then
  new.country=prefs.country;new.subdivision=prefs.subdivision;new.region=prefs.region;
  new.locality=prefs.locality;new.timezone=prefs.timezone;new.marine_region=prefs.marine_region;
  new.units=prefs.units;new.waters=prefs.waters;
 end if;
 new.latitude=null;new.longitude=null;
 return new;
end $$;
revoke all on function public.oc_ai_regional_snapshot() from public,anon,authenticated;
grant execute on function public.oc_ai_regional_snapshot() to service_role;
create trigger oc_ai_regional_snapshot before insert on public.oc_ai_requests for each row execute function public.oc_ai_regional_snapshot();
-- Persist the complete regional envelope in the existing atomic admin save/audit path.
create or replace function public.oc_admin_mutate(p_actor uuid,p_action text,p_target text,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous jsonb; result jsonb; begin
 if p_actor is null or length(trim(p_reason))<5 or length(p_reason)>1000 then raise exception 'Actor and reason required'; end if;
 if p_action='record.save' then
  select to_jsonb(r) into previous from public.oc_records r where id=p_target::uuid for update;
  insert into public.oc_records(id,kind,canonical_key,name,aliases,country,subdivision,region,locality,marine_region,timezone,latitude,longitude,source_id,source_url,attributes,status,merged_into,units,waters)
  values(p_target::uuid,p_payload->>'kind',p_payload->>'canonical_key',p_payload->>'name',array(select jsonb_array_elements_text(coalesce(p_payload->'aliases','[]'))),p_payload->>'country',p_payload->>'subdivision',p_payload->>'region',p_payload->>'locality',p_payload->>'marine_region',p_payload->>'timezone',(p_payload->>'latitude')::float8,(p_payload->>'longitude')::float8,p_payload->>'source_id',p_payload->>'source_url',coalesce(p_payload->'attributes','{}'),coalesce(p_payload->>'status','draft'),(p_payload->>'merged_into')::uuid,p_payload->>'units',p_payload->>'waters')
  on conflict(id) do update set name=excluded.name,aliases=excluded.aliases,country=excluded.country,subdivision=excluded.subdivision,region=excluded.region,locality=excluded.locality,marine_region=excluded.marine_region,timezone=excluded.timezone,latitude=excluded.latitude,longitude=excluded.longitude,source_id=excluded.source_id,source_url=excluded.source_url,attributes=excluded.attributes,status=excluded.status,merged_into=excluded.merged_into,units=excluded.units,waters=excluded.waters,updated_at=now() returning to_jsonb(oc_records.*) into result;
 elsif p_action='knowledge.save' then
  select to_jsonb(k) into previous from public.oc_knowledge k where id=p_target::uuid for update;
  insert into public.oc_knowledge(id,kind,title,body,trust,visibility,source_id,source_url,country,subdivision,region,marine_region,waters,status,confidence,effective_from,effective_until,checked_at,review_due_at,locality,timezone,latitude,longitude,units)
  values(p_target::uuid,p_payload->>'kind',p_payload->>'title',p_payload->>'body',p_payload->>'trust','public',p_payload->>'source_id',p_payload->>'source_url',p_payload->>'country',p_payload->>'subdivision',p_payload->>'region',p_payload->>'marine_region',p_payload->>'waters',coalesce(p_payload->>'status','draft'),(p_payload->>'confidence')::numeric,(p_payload->>'effective_from')::timestamptz,(p_payload->>'effective_until')::timestamptz,(p_payload->>'checked_at')::timestamptz,(p_payload->>'review_due_at')::timestamptz,p_payload->>'locality',p_payload->>'timezone',(p_payload->>'latitude')::float8,(p_payload->>'longitude')::float8,p_payload->>'units')
  on conflict(id) do update set title=excluded.title,body=excluded.body,trust=excluded.trust,source_id=excluded.source_id,source_url=excluded.source_url,country=excluded.country,subdivision=excluded.subdivision,region=excluded.region,marine_region=excluded.marine_region,waters=excluded.waters,status=excluded.status,confidence=excluded.confidence,effective_from=excluded.effective_from,effective_until=excluded.effective_until,checked_at=excluded.checked_at,review_due_at=excluded.review_due_at,locality=excluded.locality,timezone=excluded.timezone,latitude=excluded.latitude,longitude=excluded.longitude,units=excluded.units,version=oc_knowledge.version+1,updated_at=now() returning to_jsonb(oc_knowledge.*) into result;
 elsif p_action='role.set' then
  select to_jsonb(r) into previous from public.oc_admin_roles r where user_id=p_target::uuid for update;
  if p_actor=p_target::uuid then raise exception 'Cannot change your own role'; end if;
  if p_payload->>'role'='none' then delete from public.oc_admin_roles where user_id=p_target::uuid; result='{}';
  else insert into public.oc_admin_roles(user_id,role) values(p_target::uuid,p_payload->>'role') on conflict(user_id) do update set role=excluded.role,updated_at=now() returning to_jsonb(oc_admin_roles.*) into result; end if;
 elsif p_action='setting.set' then
  if p_target not in ('ai.enabled','maintenance.notice','marketplace.enabled','ai.strategy') then raise exception 'Unsupported setting'; end if;
  select to_jsonb(s) into previous from public.oc_settings s where key=p_target for update;
  insert into public.oc_settings(key,value) values(p_target,p_payload->'value') on conflict(key) do update set value=excluded.value,updated_at=now() returning to_jsonb(oc_settings.*) into result;
 elsif p_action='moderation.resolve' then
  select to_jsonb(m) into previous from public.oc_moderation m where id=p_target::uuid for update;
  if p_payload->>'decision' in ('hide','restore') then
   if previous->>'target_type'='post' then
    update public.community_posts set status=case when p_payload->>'decision'='hide' then 'hidden' else 'active' end where id=(previous->>'target_id')::uuid;
   elsif previous->>'target_type'='comment' then
    update public.community_comments set status=case when p_payload->>'decision'='hide' then 'hidden' else 'active' end where id=(previous->>'target_id')::uuid;
   else raise exception 'Content action is not supported for this target'; end if;
   if not found then raise exception 'Content target not found'; end if;
  end if;
  update public.oc_moderation set status=p_payload->>'status',decision=p_payload->>'decision',notes=p_payload->>'notes',updated_at=now() where id=p_target::uuid returning to_jsonb(oc_moderation.*) into result;
 elsif p_action='appeal.resolve' then
  select to_jsonb(a) into previous from public.oc_appeals a where id=p_target::uuid for update;
  update public.oc_appeals set status=p_payload->>'status' where id=p_target::uuid returning to_jsonb(oc_appeals.*) into result;
 elsif p_action='user.status' then
  if p_actor=p_target::uuid or p_payload->>'status' not in ('active','restricted','suspended','banned','deactivated') then raise exception 'Invalid status change'; end if;
  select jsonb_build_object('account_status',account_status) into previous from public.profiles where id=p_target::uuid for update;
  update public.profiles set account_status=p_payload->>'status',updated_at=now() where id=p_target::uuid returning jsonb_build_object('account_status',account_status) into result;
 elsif p_action='user.note' then
  result=jsonb_build_object('note',p_payload->>'note');
 else raise exception 'Unsupported action'; end if;
 if result is null then raise exception 'Target not found'; end if;
 insert into public.oc_audit(actor_id,action,target_type,target_id,previous_state,new_state,reason) values(p_actor,p_action,split_part(p_action,'.',1),p_target,previous,result,p_reason);
 return result;
end $$;
commit;
