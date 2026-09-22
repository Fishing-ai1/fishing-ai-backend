-- Additive foundation. Apply before OCEANCORE_PLATFORM_ENABLED=true.
-- Existing tables and legacy policy remediation are intentionally separate migrations.
begin;
set local lock_timeout = '5s';
create table public.oc_countries (code text primary key check(code ~ '^[A-Z]{2}$'), name text not null, default_units text not null check(default_units in ('metric','us_customary')), active boolean not null default false);
insert into public.oc_countries values ('AU','Australia','metric',true),('US','United States','us_customary',true);
create table public.oc_subdivisions (country text references public.oc_countries(code), code text, name text not null, active boolean not null default true, primary key(country,code));
create table public.oc_user_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 country text references public.oc_countries(code), subdivision text, region text, locality text,
 latitude double precision check(latitude between -90 and 90), longitude double precision check(longitude between -180 and 180),
 timezone text, marine_region text, units text not null default 'metric' check(units in ('metric','us_customary')),
 waters text check(waters in ('state','federal','inland')), share_for_patterns boolean not null default false,
 ai_personal_context boolean not null default false, updated_at timestamptz not null default now(),
 foreign key(country,subdivision) references public.oc_subdivisions(country,code), check((latitude is null)=(longitude is null))
);
create table public.oc_admin_roles (user_id uuid primary key references auth.users(id) on delete cascade, role text not null check(role in ('owner','admin','moderator','support','data_manager')), updated_at timestamptz not null default now());
create table public.oc_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, target_type text not null, target_id text not null,
 previous_state jsonb, new_state jsonb, reason text not null, created_at timestamptz not null default now()
);
create index oc_audit_target_time on public.oc_audit(target_id,created_at desc,id);
create index oc_audit_time on public.oc_audit(created_at desc,id);
create function public.oc_immutable_audit() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Audit history is append-only'; end $$;
create trigger oc_audit_immutable before update or delete or truncate on public.oc_audit for each statement execute function public.oc_immutable_audit();
create table public.oc_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into public.oc_settings values ('ai.enabled','true'),('maintenance.notice','""'),('marketplace.enabled','false');
create table public.oc_sources (
 id text primary key, name text not null, country text references public.oc_countries(code), subdivision text,
 source_url text not null check(source_url ~ '^https://'), licence_url text, attribution text,
 status text not null default 'not_connected' check(status in ('not_connected','review_required','connected','disabled','error')),
 adapter text, licence_approved boolean not null default false, checked_at timestamptz, last_success_at timestamptz, error_code text
);
create table public.oc_records (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('species','manufacturer','boat','outboard','tackle','technique','region','fishing_zone','ramp','marina','fuel','fad','reef','closure','business','charter','product','announcement','marketplace')),
 canonical_key text not null, name text not null, aliases text[] not null default '{}', country text references public.oc_countries(code), subdivision text, region text, locality text, marine_region text, timezone text,
 latitude double precision check(latitude between -90 and 90), longitude double precision check(longitude between -180 and 180),
 source_id text references public.oc_sources(id), source_url text, attributes jsonb not null default '{}',
 status text not null default 'draft' check(status in ('draft','approved','disabled','merged')), merged_into uuid references public.oc_records(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(kind,canonical_key), check(id is distinct from merged_into)
);
create index oc_records_kind_page on public.oc_records(kind,updated_at desc,id);
create index oc_records_aliases on public.oc_records using gin(aliases);
create index oc_records_search on public.oc_records using gin(to_tsvector('simple', name || ' ' || canonical_key));
create table public.oc_knowledge (
 id uuid primary key default gen_random_uuid(), canonical_id uuid references public.oc_records(id), kind text not null,
 title text not null, body text not null check(length(body)<=30000),
 trust text not null check(trust in ('official','verified','user')), visibility text not null default 'private' check(visibility in ('private','public')),
 owner_id uuid references auth.users(id) on delete cascade, source_id text references public.oc_sources(id), source_url text,
 country text references public.oc_countries(code), subdivision text, region text, marine_region text, waters text check(waters in ('state','federal','inland')),
 status text not null default 'draft' check(status in ('draft','approved','invalidated')),
 confidence numeric check(confidence between 0 and 1), effective_from timestamptz, effective_until timestamptz,
 checked_at timestamptz, review_due_at timestamptz, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 search tsvector generated always as (to_tsvector('english',title || ' ' || body)) stored,
 check(effective_until is null or effective_until>effective_from),
 check(kind <> 'regulation' or status <> 'approved' or (trust='official' and country is not null and waters is not null and source_url ~ '^https://' and source_id is not null and effective_from is not null and checked_at is not null and review_due_at>checked_at))
);
create index oc_knowledge_search on public.oc_knowledge using gin(search);
create index oc_knowledge_region on public.oc_knowledge(country,subdivision,kind) where status='approved';
create table public.oc_moderation (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 target_type text not null, target_id text not null, reason text not null, detector text not null,
 confidence numeric check(confidence between 0 and 1), severity text not null check(severity in ('low','medium','high','critical')),
 status text not null default 'pending' check(status in ('pending','dismissed','escalated','resolved')),
 decision text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index oc_moderation_queue on public.oc_moderation(status,severity,created_at desc,id);
create table public.oc_appeals (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), moderation_id uuid not null references public.oc_moderation(id), reason text not null check(length(reason) between 5 and 2000), status text not null default 'pending' check(status in ('pending','accepted','rejected')), created_at timestamptz not null default now());
create index oc_appeals_queue on public.oc_appeals(status,created_at desc);
create table public.oc_ai_requests (
 id uuid primary key, user_id uuid references auth.users(id) on delete set null, feature text not null, model text,
 status text not null default 'reserved' check(status in ('reserved','completed','failed')),
 reserved_tokens integer not null check(reserved_tokens>0), input_tokens integer, output_tokens integer, estimated_cost_usd numeric,
 latency_ms integer, error_code text, source_ids jsonb not null default '[]', created_at timestamptz not null default now()
);
create index oc_ai_user_time on public.oc_ai_requests(user_id,created_at desc);
create index oc_ai_time on public.oc_ai_requests(created_at desc,id);
create table public.oc_jobs (id uuid primary key default gen_random_uuid(), source_id text references public.oc_sources(id), kind text not null, status text not null default 'queued' check(status in ('queued','running','completed','failed','not_connected')), attempts integer not null default 0, error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.oc_activity (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null, event text not null, target_type text, target_id text, country text, created_at timestamptz not null default now());
create index oc_activity_user_time on public.oc_activity(user_id,created_at desc,id);
create index oc_activity_time on public.oc_activity(created_at desc,user_id);
create table public.oc_activity_daily (user_id uuid references auth.users(id) on delete cascade,day date,last_seen_at timestamptz not null default now(),primary key(user_id,day));
create index oc_activity_daily_day on public.oc_activity_daily(day,user_id);
-- New operational tables have no browser write path. User preference and appeal writes remain server-validated.
do $$ declare t text; begin
 foreach t in array array['oc_countries','oc_subdivisions','oc_user_preferences','oc_admin_roles','oc_audit','oc_settings','oc_sources','oc_records','oc_knowledge','oc_moderation','oc_appeals','oc_ai_requests','oc_jobs','oc_activity','oc_activity_daily'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
  execute format('grant select,insert,update,delete on table public.%I to service_role',t);
 end loop;
end $$;
revoke update,delete on public.oc_audit from service_role;
grant select on public.oc_user_preferences to authenticated;
create policy oc_own_preferences on public.oc_user_preferences for select to authenticated using (user_id=(select auth.uid()));
grant select on public.oc_knowledge to authenticated;
create policy oc_read_knowledge on public.oc_knowledge for select to authenticated using (
 (visibility='private' and owner_id=(select auth.uid())) or
 (visibility='public' and status='approved' and trust in ('official','verified') and kind<>'regulation')
);
create function public.oc_search_knowledge(p_query text,p_country text,p_subdivision text,p_region text,p_marine text,p_waters text,p_limit integer default 12)
returns setof public.oc_knowledge language sql stable security invoker set search_path='' as $$
 select k.* from public.oc_knowledge k where k.status='approved' and k.visibility='public' and k.trust in ('official','verified')
 and k.search @@ websearch_to_tsquery('english',left(p_query,2000))
 and (k.country is null or k.country=p_country) and (k.subdivision is null or k.subdivision=p_subdivision)
 and (k.region is null or k.region=p_region) and (k.marine_region is null or k.marine_region=p_marine) and (k.waters is null or k.waters=p_waters)
 and (k.effective_from is null or k.effective_from<=now()) and (k.effective_until is null or k.effective_until>now())
 and (k.kind<>'regulation' or (k.trust='official' and p_country is not null and p_waters is not null and (p_waters<>'state' or p_subdivision is not null) and k.review_due_at>now() and k.checked_at<=now()))
 order by ts_rank(k.search,websearch_to_tsquery('english',left(p_query,2000))) desc,k.id limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.oc_search_knowledge(text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.oc_search_knowledge(text,text,text,text,text,text,integer) to service_role;
create function public.oc_reserve_ai_request(p_id uuid,p_user uuid,p_feature text,p_tokens integer,p_limit integer,p_rpm integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare used bigint; requests bigint; begin
 if p_user is null or p_tokens<1 or p_limit<1 or p_rpm<1 then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select coalesce(sum(greatest(reserved_tokens,coalesce(input_tokens,0)+coalesce(output_tokens,0))),0),count(*) filter(where created_at>now()-interval '1 minute') into used,requests
 from public.oc_ai_requests where user_id=p_user and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if used+p_tokens>p_limit or requests>=p_rpm then return false; end if;
 insert into public.oc_ai_requests(id,user_id,feature,reserved_tokens) values(p_id,p_user,p_feature,p_tokens);
 return true;
end $$;
revoke all on function public.oc_reserve_ai_request(uuid,uuid,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.oc_reserve_ai_request(uuid,uuid,text,integer,integer,integer) to service_role;
-- The backend authenticates the actor and checks capability before calling this service-only RPC.
create function public.oc_admin_mutate(p_actor uuid,p_action text,p_target text,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous jsonb; result jsonb; begin
 if p_actor is null or length(trim(p_reason))<5 or length(p_reason)>1000 then raise exception 'Actor and reason required'; end if;
 if p_action='record.save' then
  select to_jsonb(r) into previous from public.oc_records r where id=p_target::uuid for update;
  insert into public.oc_records(id,kind,canonical_key,name,aliases,country,subdivision,region,locality,marine_region,timezone,latitude,longitude,source_id,source_url,attributes,status,merged_into)
  values(p_target::uuid,p_payload->>'kind',p_payload->>'canonical_key',p_payload->>'name',array(select jsonb_array_elements_text(coalesce(p_payload->'aliases','[]'))),p_payload->>'country',p_payload->>'subdivision',p_payload->>'region',p_payload->>'locality',p_payload->>'marine_region',p_payload->>'timezone',(p_payload->>'latitude')::float8,(p_payload->>'longitude')::float8,p_payload->>'source_id',p_payload->>'source_url',coalesce(p_payload->'attributes','{}'),coalesce(p_payload->>'status','draft'),(p_payload->>'merged_into')::uuid)
  on conflict(id) do update set name=excluded.name,aliases=excluded.aliases,country=excluded.country,subdivision=excluded.subdivision,region=excluded.region,locality=excluded.locality,marine_region=excluded.marine_region,timezone=excluded.timezone,latitude=excluded.latitude,longitude=excluded.longitude,source_id=excluded.source_id,source_url=excluded.source_url,attributes=excluded.attributes,status=excluded.status,merged_into=excluded.merged_into,updated_at=now() returning to_jsonb(oc_records.*) into result;
 elsif p_action='knowledge.save' then
  select to_jsonb(k) into previous from public.oc_knowledge k where id=p_target::uuid for update;
  insert into public.oc_knowledge(id,kind,title,body,trust,visibility,source_id,source_url,country,subdivision,region,marine_region,waters,status,confidence,effective_from,effective_until,checked_at,review_due_at)
  values(p_target::uuid,p_payload->>'kind',p_payload->>'title',p_payload->>'body',p_payload->>'trust','public',p_payload->>'source_id',p_payload->>'source_url',p_payload->>'country',p_payload->>'subdivision',p_payload->>'region',p_payload->>'marine_region',p_payload->>'waters',coalesce(p_payload->>'status','draft'),(p_payload->>'confidence')::numeric,(p_payload->>'effective_from')::timestamptz,(p_payload->>'effective_until')::timestamptz,(p_payload->>'checked_at')::timestamptz,(p_payload->>'review_due_at')::timestamptz)
  on conflict(id) do update set title=excluded.title,body=excluded.body,trust=excluded.trust,source_id=excluded.source_id,source_url=excluded.source_url,country=excluded.country,subdivision=excluded.subdivision,region=excluded.region,marine_region=excluded.marine_region,waters=excluded.waters,status=excluded.status,confidence=excluded.confidence,effective_from=excluded.effective_from,effective_until=excluded.effective_until,checked_at=excluded.checked_at,review_due_at=excluded.review_due_at,version=oc_knowledge.version+1,updated_at=now() returning to_jsonb(oc_knowledge.*) into result;
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
revoke all on function public.oc_admin_mutate(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.oc_admin_mutate(uuid,text,text,jsonb,text) to service_role;
create function public.oc_user_timeline(p_user uuid,p_event text default '',p_limit integer default 25,p_offset integer default 0)
returns table(id text,event text,target_type text,target_id text,created_at timestamptz) language sql stable security invoker set search_path='' as $$
 select * from (
  select p.id::text as id,'signup'::text as event,'user'::text as target_type,p.id::text as target_id,p.created_at from public.profiles p where p.id=p_user
  union all select c.id::text,'catch','catch',c.id::text,c.created_at from public.catches c where c.user_id=p_user
  union all select a.id::text,a.action,a.target_type,a.target_id,a.created_at from public.oc_audit a where a.target_id=p_user::text
  union all select a.id::text,a.event,a.target_type,a.target_id,a.created_at from public.oc_activity a where a.user_id=p_user
  union all select r.id::text,'ai.'||r.status,'ai_request',r.id::text,r.created_at from public.oc_ai_requests r where r.user_id=p_user
 ) events where p_event='' or events.event=p_event order by created_at desc,id limit greatest(1,least(p_limit,100)) offset greatest(0,least(p_offset,1000000));
$$;
revoke all on function public.oc_user_timeline(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.oc_user_timeline(uuid,text,integer,integer) to service_role;
create function public.oc_dashboard(p_days integer default 30) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'total_users',(select count(*) from public.profiles),
 'new_users',(select count(*) from public.profiles where created_at>=now()-make_interval(days=>greatest(1,least(p_days,365)))),
 'catches',(select count(*) from public.catches where created_at>=now()-make_interval(days=>greatest(1,least(p_days,365)))),
 'dau',(select count(distinct user_id) from public.oc_activity_daily where day>=(now() at time zone 'UTC')::date),
 'wau',(select count(distinct user_id) from public.oc_activity_daily where day>=(now() at time zone 'UTC')::date-6),
 'mau',(select count(distinct user_id) from public.oc_activity_daily where day>=(now() at time zone 'UTC')::date-29),
 'activity_since',(select min(day) from public.oc_activity_daily),
 'pending_moderation',(select count(*) from public.oc_moderation where status='pending'),
 'ai_requests',(select count(*) from public.oc_ai_requests where created_at>=now()-make_interval(days=>greatest(1,least(p_days,365)))),
 'ai_cost_usd',(select sum(estimated_cost_usd) from public.oc_ai_requests where created_at>=now()-make_interval(days=>greatest(1,least(p_days,365)))),
 'ai_unpriced_requests',(select count(*) from public.oc_ai_requests where status='completed' and estimated_cost_usd is null and created_at>=now()-make_interval(days=>greatest(1,least(p_days,365)))),
 'countries',(select coalesce(jsonb_agg(x),'[]') from (select country,count(*) as users from public.oc_user_preferences group by country) x),
 'growth',(select coalesce(jsonb_agg(x),'[]') from (select date_trunc('day',created_at) as day,count(*) as users from public.profiles where created_at>=now()-make_interval(days=>greatest(1,least(p_days,365))) group by 1 order by 1) x),
 'milestones','[10000,100000,250000,500000,1000000]'::jsonb
 );
$$;
revoke all on function public.oc_dashboard(integer) from public,anon,authenticated;
grant execute on function public.oc_dashboard(integer) to service_role;
create function public.oc_record_activity(p_user uuid,p_event text,p_target text default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.oc_activity_daily(user_id,day) values(p_user,(now() at time zone 'UTC')::date) on conflict(user_id,day) do update set last_seen_at=now();
 if p_event<>'active' then insert into public.oc_activity(user_id,event,target_id) values(p_user,left(p_event,100),left(p_target,100)); end if;
end $$;
revoke all on function public.oc_record_activity(uuid,text,text) from public,anon,authenticated;
grant execute on function public.oc_record_activity(uuid,text,text) to service_role;
-- Reference registry seeds: no regulations, specifications or charts fabricated.
insert into public.oc_subdivisions(country,code,name) values
('AU','ACT','Australian Capital Territory'),
('AU','NSW','New South Wales'),
('AU','NT','Northern Territory'),
('AU','QLD','Queensland'),
('AU','SA','South Australia'),
('AU','TAS','Tasmania'),
('AU','VIC','Victoria'),
('AU','WA','Western Australia'),
('AU','JBT','Jervis Bay Territory'),
('AU','CX','Christmas Island'),
('AU','CC','Cocos (Keeling) Islands'),
('AU','NF','Norfolk Island'),
('AU','HM','Heard Island and McDonald Islands'),
('AU','AAT','Australian Antarctic Territory'),
('AU','CSI','Coral Sea Islands'),
('AU','ACI','Ashmore and Cartier Islands'),
('US','AL','Alabama'),
('US','AK','Alaska'),
('US','AZ','Arizona'),
('US','AR','Arkansas'),
('US','CA','California'),
('US','CO','Colorado'),
('US','CT','Connecticut'),
('US','DE','Delaware'),
('US','FL','Florida'),
('US','GA','Georgia'),
('US','HI','Hawaii'),
('US','ID','Idaho'),
('US','IL','Illinois'),
('US','IN','Indiana'),
('US','IA','Iowa'),
('US','KS','Kansas'),
('US','KY','Kentucky'),
('US','LA','Louisiana'),
('US','ME','Maine'),
('US','MD','Maryland'),
('US','MA','Massachusetts'),
('US','MI','Michigan'),
('US','MN','Minnesota'),
('US','MS','Mississippi'),
('US','MO','Missouri'),
('US','MT','Montana'),
('US','NE','Nebraska'),
('US','NV','Nevada'),
('US','NH','New Hampshire'),
('US','NJ','New Jersey'),
('US','NM','New Mexico'),
('US','NY','New York'),
('US','NC','North Carolina'),
('US','ND','North Dakota'),
('US','OH','Ohio'),
('US','OK','Oklahoma'),
('US','OR','Oregon'),
('US','PA','Pennsylvania'),
('US','RI','Rhode Island'),
('US','SC','South Carolina'),
('US','SD','South Dakota'),
('US','TN','Tennessee'),
('US','TX','Texas'),
('US','UT','Utah'),
('US','VT','Vermont'),
('US','VA','Virginia'),
('US','WA','Washington'),
('US','WV','West Virginia'),
('US','WI','Wisconsin'),
('US','WY','Wyoming'),
('US','DC','District of Columbia'),
('US','AS','American Samoa'),
('US','GU','Guam'),
('US','MP','Northern Mariana Islands'),
('US','PR','Puerto Rico'),
('US','VI','US Virgin Islands'),
('US','UM','US Minor Outlying Islands');
insert into public.oc_sources(id,name,country,source_url,adapter,attribution) values
('au-aho','Australian Hydrographic Office','AU','https://www.hydro.gov.au/charts/ausenc','licensed_chart','Australian Hydrographic Office; licence required for redistribution.'),
('au-amsa','Australian Maritime Safety Authority','AU','https://www.amsa.gov.au/','reviewed_document','AMSA; check each source licence.'),
('au-bom','Bureau of Meteorology','AU','https://www.bom.gov.au/marine/','licensed_forecast','Bureau of Meteorology; terms and feed access must be approved.'),
('us-noaa-charts','NOAA Office of Coast Survey','US','https://www.nauticalcharts.noaa.gov/data/gis-data-and-services.html','noaa_chart','NOAA Office of Coast Survey; verify layer licence and notices.'),
('us-noaa-fisheries','NOAA Fisheries','US','https://www.fisheries.noaa.gov/','reviewed_document','NOAA Fisheries; management area and effective dates required.'),
('us-nws','National Weather Service','US','https://www.weather.gov/documentation/services-web-api','nws','National Weather Service; forecasts are not navigation charts.'),
('us-uscg','US Coast Guard','US','https://www.uscg.mil/','reviewed_document','US Coast Guard; verify applicable district and notice dates.');
commit;
