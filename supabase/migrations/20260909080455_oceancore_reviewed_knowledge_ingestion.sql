begin;
set local lock_timeout='5s';
alter table public.oc_sources add column allowed_hosts text[] not null default '{}', add column review_interval_hours integer not null default 168 check(review_interval_hours between 1 and 8760);
alter table public.oc_knowledge add column content_hash text;
alter table public.oc_knowledge add column source_version text,add column source_updated_at timestamptz;
alter table public.oc_knowledge add constraint oc_knowledge_approved_provenance check(status<>'approved' or (source_id is not null and source_url ~ '^https://' and checked_at is not null and review_due_at>checked_at)) not valid;
create table public.oc_knowledge_imports(id uuid primary key default gen_random_uuid(),source_id text not null references public.oc_sources(id),content_hash text not null,knowledge_id uuid not null references public.oc_knowledge(id),actor_id uuid not null,created_at timestamptz not null default now(),unique(source_id,content_hash));
alter table public.oc_knowledge_imports enable row level security;
revoke all on public.oc_knowledge_imports from public,anon,authenticated;
grant select,insert on public.oc_knowledge_imports to service_role;
create trigger oc_import_immutable before update or delete or truncate on public.oc_knowledge_imports for each statement execute function public.oc_immutable_audit();

create function public.oc_import_knowledge(p_actor uuid,p_source text,p_items jsonb,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; result jsonb='[]'; found_id uuid; src public.oc_sources; begin
 if p_actor is null or length(trim(p_reason)) not between 5 and 1000 or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 25 then raise exception 'Invalid import';end if;
 select * into src from public.oc_sources where id=p_source for update;
 if not found or not src.licence_approved or src.status='disabled' then raise exception 'Source reuse is not approved';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select knowledge_id into found_id from public.oc_knowledge_imports where source_id=p_source and content_hash=item->>'content_hash';
  if found_id is null then
   insert into public.oc_knowledge(kind,title,body,trust,visibility,status,source_id,source_url,country,subdivision,region,locality,timezone,marine_region,waters,checked_at,review_due_at,effective_from,effective_until,content_hash,canonical_id,source_version,source_updated_at)
   values(item->>'kind',item->>'title',item->>'body','official','public','draft',p_source,item->>'source_url',item->>'country',item->>'subdivision',item->>'region',item->>'locality',item->>'timezone',item->>'marine_region',item->>'waters',(item->>'checked_at')::timestamptz,(item->>'review_due_at')::timestamptz,(item->>'effective_from')::timestamptz,(item->>'effective_until')::timestamptz,item->>'content_hash',(item->>'canonical_id')::uuid,item->>'version_label',(item->>'source_updated_at')::timestamptz) returning id into found_id;
   insert into public.oc_knowledge_imports(source_id,content_hash,knowledge_id,actor_id) values(p_source,item->>'content_hash',found_id,p_actor);
  end if;
  result=result||jsonb_build_array(found_id);
 end loop;
 insert into public.oc_audit(actor_id,action,target_type,target_id,new_state,reason)values(p_actor,'knowledge.import','source',p_source,jsonb_build_object('knowledge_ids',result),p_reason);
 return jsonb_build_object('knowledge_ids',result,'status','draft');
end $$;
revoke all on function public.oc_import_knowledge(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.oc_import_knowledge(uuid,text,jsonb,text) to service_role;

create function public.oc_source_policy(p_actor uuid,p_id text,p_approved boolean,p_licence_url text,p_interval integer,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare oldrow jsonb;newrow jsonb;begin
 if p_actor is null or length(trim(p_reason)) not between 5 and 1000 or p_interval not between 1 and 8760 or (p_approved and coalesce(p_licence_url,'')!~'^https://')then raise exception 'Invalid source policy';end if;
 select to_jsonb(s) into oldrow from public.oc_sources s where id=p_id for update;
 if oldrow is null then raise exception 'Source not found';end if;
 update public.oc_sources set licence_approved=p_approved,licence_url=p_licence_url,review_interval_hours=p_interval,status=case when p_approved then 'review_required' else 'not_connected' end where id=p_id returning to_jsonb(oc_sources.*) into newrow;
 insert into public.oc_audit(actor_id,action,target_type,target_id,previous_state,new_state,reason)values(p_actor,'source.policy','source',p_id,oldrow,newrow,p_reason);
 return newrow;
end $$;
revoke all on function public.oc_source_policy(uuid,text,boolean,text,integer,text) from public,anon,authenticated;
grant execute on function public.oc_source_policy(uuid,text,boolean,text,integer,text) to service_role;

-- All trusted retrieval requires current provenance; aliases are scoped to the same country.
create or replace function public.oc_search_knowledge(p_query text,p_country text,p_subdivision text,p_region text,p_marine text,p_waters text,p_limit integer default 12)
returns setof public.oc_knowledge language sql stable security invoker set search_path='' as $$
 select k.* from public.oc_knowledge k join public.oc_sources s on s.id=k.source_id
 where k.status='approved' and k.visibility='public' and k.trust in ('official','verified') and s.status<>'disabled'
 and k.source_url ~ '^https://' and k.checked_at<=now() and k.review_due_at>now()
 and (k.country is null or k.country=p_country) and (k.subdivision is null or k.subdivision=p_subdivision)
 and (k.region is null or k.region=p_region) and (k.marine_region is null or k.marine_region=p_marine) and (k.waters is null or k.waters=p_waters)
 and (k.effective_from is null or k.effective_from<=now()) and (k.effective_until is null or k.effective_until>now())
 and (k.kind<>'regulation' or (k.trust='official' and k.country is not null and k.waters is not null and k.effective_from is not null and p_country is not null and p_waters is not null and (p_waters not in ('state','inland') or p_subdivision is not null)))
 and (k.search @@ websearch_to_tsquery('english',left(p_query,2000)) or exists(
  select 1 from public.oc_records r,unnest(r.aliases||array[r.name,r.canonical_key]) a
  where r.id=k.canonical_id and r.status='approved' and (r.country is null or r.country=p_country)
  and position(' '||regexp_replace(lower(a),'[^a-z0-9]+',' ','g')||' ' in ' '||regexp_replace(lower(left(p_query,2000)),'[^a-z0-9]+',' ','g')||' ')>0
 ))
 order by ts_rank(k.search,websearch_to_tsquery('english',left(p_query,2000))) desc,k.checked_at desc,k.id limit greatest(1,least(p_limit,20));
$$;

-- Reviewed source registry seeds: links, not live feeds or blanket licensing approval.
insert into public.oc_sources(id,name,country,subdivision,source_url,adapter,attribution,allowed_hosts,review_interval_hours) values
('au-qld-fisheries','Queensland recreational fishing rules','AU','QLD','https://www.qld.gov.au/recreation/activities/boating-fishing/rec-fishing/rules','reviewed_document','Queensland recreational fishing rules; review source-specific reuse terms. No images or chart layers included.',array['www.qld.gov.au'],24),
('au-nsw-fisheries','NSW recreational fishing rules','AU','NSW','https://www.dpi.nsw.gov.au/fishing/recreational/fishing-rules-and-regs','reviewed_document','NSW recreational fishing rules; review source-specific reuse terms. No images or chart layers included.',array['www.dpi.nsw.gov.au'],24),
('au-vic-fisheries','Victorian Fisheries Authority','AU','VIC','https://vfa.vic.gov.au/recreational-fishing/recreational-fishing-guide','reviewed_document','Victorian Fisheries Authority; review source-specific reuse terms. No images or chart layers included.',array['vfa.vic.gov.au'],24),
('au-wa-fisheries','Western Australian recreational fishing rules','AU','WA','https://rules.fish.wa.gov.au/','reviewed_document','Western Australian recreational fishing rules; review source-specific reuse terms. No images or chart layers included.',array['rules.fish.wa.gov.au'],24),
('au-sa-fisheries','PIRSA recreational fishing rules','AU','SA','https://pir.sa.gov.au/fishing-and-aquaculture/recreational-fishing/rules','reviewed_document','PIRSA recreational fishing rules; review source-specific reuse terms. No images or chart layers included.',array['pir.sa.gov.au'],24),
('au-tas-fisheries','Fishing Tasmania marine recreational rules','AU','TAS','https://fishing.tas.gov.au/recreational-fishing/rules/size-and-bag-limits','reviewed_document','Fishing Tasmania marine recreational rules; review source-specific reuse terms. No images or chart layers included.',array['fishing.tas.gov.au'],24),
('au-nt-fisheries','Northern Territory area fishing rules','AU','NT','https://nt.gov.au/marine/recreational-fishing/when-and-where-to-fish/rules-for-fishing-in-specific-areas','reviewed_document','Northern Territory area fishing rules; review source-specific reuse terms. No images or chart layers included.',array['nt.gov.au'],24),
('au-act-fisheries','ACT recreational fishing','AU','ACT','https://www.act.gov.au/environment/animals-and-plants/animals/wildlife-management/fish/recreational-fishing-in-the-act','reviewed_document','ACT recreational fishing; review source-specific reuse terms. No images or chart layers included.',array['www.act.gov.au'],24),
('au-gbrmpa','Great Barrier Reef Marine Park Authority zoning','AU','QLD','https://www.gbrmpa.gov.au/access/zoning/zoning-maps','reviewed_document','Great Barrier Reef Marine Park Authority zoning; review source-specific reuse terms. No images or chart layers included.',array['www.gbrmpa.gov.au'],24),
('au-australian-museum','Australian Museum fish knowledge','AU',null,'https://australian.museum/learn/animals/fishes/','reviewed_document','Australian Museum fish knowledge; review source-specific reuse terms. No images or chart layers included.',array['australian.museum'],24)
on conflict(id) do nothing;
update public.oc_sources set allowed_hosts=array[split_part(split_part(source_url,'://',2),'/',1)] where cardinality(allowed_hosts)=0;
insert into public.oc_records(kind,canonical_key,name,aliases,country,source_id,source_url,attributes,status) values('species','species:chrysophrys-auratus','Australasian snapper',array['Snapper','Pink snapper','Pagrus auratus','Chrysophrys auratus'],'AU','au-australian-museum','https://australian.museum/learn/animals/fishes/snapper-pagrus-auratus-bloch-schneider-1801/','{"scientific_name":"Chrysophrys auratus","family":"Sparidae","habitats":["juvenile bays and estuaries","adult offshore reefs"]}'::jsonb,'approved') on conflict(kind,canonical_key) do nothing;
insert into public.oc_knowledge(canonical_id,kind,title,body,trust,visibility,status,source_id,source_url,country,checked_at,review_due_at) select id,'species','Australasian snapper biology','Australasian snapper: the Australian Museum identifies this species as Chrysophrys auratus, family Sparidae. Pagrus auratus is an older name retained as an alias. Juveniles use bays and estuaries; adults occur on deeper offshore reefs. Pinkish upper sides, a silvery underside and blue spotting are identification clues. This biology record contains no legal size, bag limit or seasonal rule.','official','public','approved','au-australian-museum','https://australian.museum/learn/animals/fishes/snapper-pagrus-auratus-bloch-schneider-1801/','AU','2026-09-09T00:00:00Z','2026-12-08T00:00:00Z' from public.oc_records where kind='species' and canonical_key='species:chrysophrys-auratus';
insert into public.oc_records(kind,canonical_key,name,aliases,country,source_id,source_url,attributes,status) values('species','species:coryphaena-hippurus:atlantic','Atlantic mahi mahi',array['Mahi mahi','Mahimahi','Dolphinfish','Dorado','Coryphaena hippurus'],'US','us-noaa-fisheries','https://www.fisheries.noaa.gov/species/atlantic-mahi-mahi','{"scientific_name":"Coryphaena hippurus","family":"Coryphaenidae","habitats":["pelagic surface waters","floating vegetation"]}'::jsonb,'approved') on conflict(kind,canonical_key) do nothing;
insert into public.oc_knowledge(canonical_id,kind,title,body,trust,visibility,status,source_id,source_url,country,checked_at,review_due_at) select id,'species','Atlantic mahi mahi biology','Atlantic mahi mahi (Coryphaena hippurus) is also called dolphinfish or dorado. NOAA describes a pelagic fish living near the surface in tropical and subtropical waters. Smaller fish often associate with floating objects and Sargassum; larger males favor open-ocean habitat. They feed on small fish and invertebrates. This biological summary does not establish any fishing season or possession limit.','official','public','approved','us-noaa-fisheries','https://www.fisheries.noaa.gov/species/atlantic-mahi-mahi','US','2026-09-09T00:00:00Z','2026-12-08T00:00:00Z' from public.oc_records where kind='species' and canonical_key='species:coryphaena-hippurus:atlantic';
commit;
