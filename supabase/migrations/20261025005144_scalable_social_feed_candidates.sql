-- Server-only, keyset-paged candidate retrieval. Ranking remains in the API.
create or replace function public.oc_social_feed_candidates(
  p_viewer uuid,
  p_feed text,
  p_category text,
  p_species text,
  p_location text,
  p_before_at timestamptz,
  p_before_id uuid,
  p_ids uuid[],
  p_page_size integer
)
returns setof public.community_posts
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.community_posts p
  where p.status = 'active'
    and p.privacy <> 'private'
    and (p_ids is null or p.id = any(p_ids))
    and (p_ids is not null or p_before_at is null or (p.created_at, p.id) < (p_before_at, p_before_id))
    and (nullif(p_category, '') is null or lower(p.category) = lower(p_category))
    and (nullif(p_species, '') is null or position(lower(p_species) in lower(coalesce(p.species, ''))) > 0)
    and (nullif(p_location, '') is null or position(lower(p_location) in lower(coalesce(p.general_area, ''))) > 0)
    and (
      p_feed not in ('following', 'videos', 'boats', 'local', 'catches')
      or (p_feed = 'following' and exists (
        select 1 from public.community_follows f
        where f.follower_id = p_viewer and f.following_id = p.user_id
      ))
      or (p_feed = 'videos' and (p.post_type = 'video' or p.media_type = 'video'))
      or (p_feed = 'boats' and p.category = 'boats')
      or (p_feed = 'local' and p.post_type in ('fishing_report', 'catch', 'trip_report'))
      or (p_feed = 'catches' and p.post_type = 'catch')
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_page_size, 1), 1), 49);
$$;

revoke all on function public.oc_social_feed_candidates(uuid,text,text,text,text,timestamptz,uuid,uuid[],integer) from public, anon, authenticated;
grant execute on function public.oc_social_feed_candidates(uuid,text,text,text,text,timestamptz,uuid,uuid[],integer) to service_role;
