alter table public.community_post_views
  add column if not exists viewer_key text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'community_post_views_pkey'
      and conrelid = 'public.community_post_views'::regclass
  ) then
    alter table public.community_post_views
      drop constraint community_post_views_pkey;
  end if;
end $$;

alter table public.community_post_views
  alter column user_id drop not null;

alter table public.community_post_views
  drop constraint if exists community_post_views_identity_check;

alter table public.community_post_views
  add constraint community_post_views_identity_check
  check (user_id is not null or nullif(viewer_key, '') is not null);

create unique index if not exists community_post_views_user_unique_idx
  on public.community_post_views(post_id, user_id)
  where user_id is not null;

create unique index if not exists community_post_views_viewer_key_unique_idx
  on public.community_post_views(post_id, viewer_key)
  where viewer_key is not null;

create index if not exists community_post_views_viewer_key_idx
  on public.community_post_views(viewer_key);
