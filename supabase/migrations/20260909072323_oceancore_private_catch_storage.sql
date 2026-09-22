-- New uploads are server-only. Existing public files require a separate verified copy/reference migration.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('oceancore-private-catches','oceancore-private-catches',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policies prevent unrelated permissive legacy storage policies from exposing this bucket.
create policy oc_catch_media_browser_deny on storage.objects as restrictive for all to anon,authenticated
using (bucket_id <> 'oceancore-private-catches') with check (bucket_id <> 'oceancore-private-catches');
commit;
