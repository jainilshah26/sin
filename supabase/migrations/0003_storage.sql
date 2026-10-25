-- Media bucket: anyone can view, each user uploads only into their own folder (<user id>/<file>).
-- Photos are resized on the phone before upload (1080px + a 360px thumbnail), which keeps storage cost down.
-- Only photo/video types are accepted (no SVG or HTML, which could carry scripts), files are named <id>.<ext>
-- with no sub-folders, and each person can upload at most 200 files a day so one account can't fill the storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 200 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- counts only the caller's own uploads (the upload policy can't read storage.objects itself)
create or replace function public.uploads_today() returns int language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects
  where bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text and created_at > now() - interval '1 day'
$$;
revoke all on function public.uploads_today() from public, anon;
grant execute on function public.uploads_today() to authenticated;

drop policy if exists media_upload_own on storage.objects;
create policy media_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'media'
    and name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|m4v)$')
    and public.uploads_today() < 200);
drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
