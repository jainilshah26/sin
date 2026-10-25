-- Last step of the abuse protection for the sin project. Paste all of this into Supabase -> SQL Editor -> Run.

-- Safe to run more than once. Adds flood limits to likes and reposts, and the storage upload rules.

create or replace function toggle_like(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); p posts := visible_post(p_id, v); n int;
begin
  perform hit('like', 120, '1 minute');
  delete from likes where user_id = v and post_id = p.id;
  if found then
    update posts set like_count = greatest(like_count - 1, 0) where id = p.id returning like_count into n;
    return jsonb_build_object('liked', false, 'like_count', n);
  end if;
  insert into likes (user_id, post_id) values (v, p.id);
  update posts set like_count = like_count + 1 where id = p.id returning like_count into n;
  perform notify(p.author_id, v, 'like', p.id);
  return jsonb_build_object('liked', true, 'like_count', n);
end $$;


create or replace function repost(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); p posts := visible_post(p_id, v); n int;
begin
  if p.repost_of is not null then p := visible_post(p.repost_of, v); end if;
  perform hit('repost', 60, '1 hour');
  delete from posts where author_id = v and repost_of = p.id;
  if found then
    update posts set repost_count = greatest(repost_count - 1, 0) where id = p.id returning repost_count into n;
    return jsonb_build_object('reposted', false, 'repost_count', n);
  end if;
  insert into posts (author_id, kind, repost_of) values (v, 'note', p.id);
  update posts set repost_count = repost_count + 1 where id = p.id returning repost_count into n;
  perform notify(p.author_id, v, 'repost', p.id);
  return jsonb_build_object('reposted', true, 'repost_count', n);
end $$;


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
