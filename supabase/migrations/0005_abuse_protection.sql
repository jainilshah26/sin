-- Applied to the live project on top of 0001-0004: flood limits, media checks, spam checks and storage rules.

-- A fresh install already gets all of this from 0002 and 0003; this file only upgrades older databases.

-- ---------- abuse protection ----------
-- Rate limits: fixed windows counted per person and action. Going over raises a polite error; the count rolls back
-- with it, so a blocked attempt doesn't extend the wait.
create table if not exists rate_limits (
  user_id uuid not null, action text not null, window_start timestamptz not null, hits int not null default 1,
  primary key (user_id, action, window_start)
);
alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

create or replace function hit(p_action text, p_max int, p_window interval) returns void language plpgsql security definer set search_path = public as $$
declare n int; w timestamptz := date_bin(p_window, now(), timestamptz '1970-01-01 00:00:00+00');
begin
  insert into rate_limits (user_id, action, window_start) values (auth.uid(), p_action, w)
  on conflict (user_id, action, window_start) do update set hits = rate_limits.hits + 1 returning hits into n;
  if n > p_max then raise exception 'You''re doing that too fast. Please wait a little and try again.'; end if;
  if random() < 0.01 then delete from rate_limits where window_start < now() - interval '2 days'; end if;
end $$;

-- Media must be a file this person uploaded to this project's storage (<project>.supabase.co/.../media/<their id>/<file>).
-- Anything else (outside links, tracking pixels, other people's files, scripts) is refused, and only known fields are kept.
create or replace function media_url_ok(u text, v uuid) returns boolean language sql immutable set search_path = public as $$
  select coalesce(u ~ ('^https://[a-z0-9]{8,40}\.supabase\.co/storage/v1/object/public/media/' || v::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|m4v)$'), false)
$$;

create or replace function clean_media(m jsonb, v uuid, max int) returns jsonb language plpgsql immutable set search_path = public as $$
declare e jsonb; out jsonb := '[]';
begin
  if m is null then return out; end if;
  if jsonb_typeof(m) <> 'array' or jsonb_array_length(m) > max then raise exception 'Up to % photos or videos.', max; end if;
  for e in select x from jsonb_array_elements(m) x loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'type', '') not in ('image', 'video') or not media_url_ok(e->>'url', v)
      or (e->>'thumb' is not null and not media_url_ok(e->>'thumb', v)) then
      raise exception 'That photo or video can''t be used. Please upload it again.';
    end if;
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('type', e->>'type', 'url', e->>'url', 'thumb', e->>'thumb',
      'w', case when jsonb_typeof(e->'w') = 'number' then least(greatest((e->>'w')::numeric, 0), 10000)::int end,
      'h', case when jsonb_typeof(e->'h') = 'number' then least(greatest((e->>'h')::numeric, 0), 10000)::int end,
      'duration', case when jsonb_typeof(e->'duration') = 'number' then least(greatest((e->>'duration')::numeric, 0), 86400)::int end)));
  end loop;
  return out;
end $$;

create or replace function update_profile(p_name text, p_bio text, p_avatar_url text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 50 then raise exception 'Enter your name.'; end if;
  if char_length(coalesce(p_bio, '')) > 300 then raise exception 'Keep your bio under 300 characters.'; end if;
  if nullif(p_avatar_url, '') is not null and not media_url_ok(p_avatar_url, v) then raise exception 'That photo can''t be used. Please upload it again.'; end if;
  perform hit('profile', 30, '1 hour');
  update profiles set name = trim(p_name), bio = coalesce(p_bio, ''), avatar_url = nullif(p_avatar_url, '') where id = v;
  return me();
end $$;


create or replace function update_pro(p_headline text, p_location text, p_about text, p_skills text[], p_open_to_work boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); s text[];
begin
  select coalesce(array_agg(x order by i), '{}') into s from (
    select distinct on (lower(trim(x))) trim(x) x, i from unnest(coalesce(p_skills, '{}')) with ordinality t(x, i)
    where trim(x) <> '' order by lower(trim(x)), i) d;
  if cardinality(s) > 30 then raise exception 'Up to 30 skills.'; end if;
  if exists (select 1 from unnest(s) x where char_length(x) > 40) then raise exception 'Keep each skill under 40 characters.'; end if;
  perform hit('profile', 30, '1 hour');
  update pro_profiles set headline = coalesce(trim(p_headline), ''), location = coalesce(trim(p_location), ''), about = coalesce(p_about, ''),
    skills = s, open_to_work = coalesce(p_open_to_work, false) where user_id = v;
  return pro_json(v);
end $$;


create or replace function add_experience(p_title text, p_company_name text, p_start_date date, p_end_date date, p_description text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); i bigint;
begin
  if trim(coalesce(p_title, '')) = '' or trim(coalesce(p_company_name, '')) = '' or p_start_date is null then
    raise exception 'Add a title, a company and a start date.'; end if;
  if p_end_date is not null and p_end_date < p_start_date then raise exception 'The end date is before the start date.'; end if;
  perform hit('profile', 30, '1 hour');
  insert into experiences (user_id, title, company_name, company_id, start_date, end_date, description)
  values (v, trim(p_title), trim(p_company_name), (select id from companies where lower(name) = lower(trim(p_company_name))),
    p_start_date, p_end_date, coalesce(p_description, '')) returning id into i;
  return jsonb_build_object('id', i);
end $$;


create or replace function follow(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if p_user = v then raise exception 'You can''t follow yourself.'; end if;
  if not exists (select 1 from profiles where id = p_user) or blocked(v, p_user) then raise exception 'Profile not found.'; end if;
  perform hit('follow', 60, '1 hour');
  insert into follows (follower_id, followee_id) values (v, p_user) on conflict do nothing;
  if found then perform notify(p_user, v, 'follow', null); end if;
  return jsonb_build_object('following', true);
end $$;


create or replace function connect(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); st text;
begin
  if p_user = v then raise exception 'You can''t connect with yourself.'; end if;
  if not exists (select 1 from profiles where id = p_user) or blocked(v, p_user) then raise exception 'Profile not found.'; end if;
  st := connection_state(v, p_user);
  if st = 'none' then perform hit('connect', 40, '1 day'); end if;
  if st = 'incoming' then
    update connections set status = 'accepted' where requester_id = p_user and addressee_id = v;
    perform notify(p_user, v, 'connect_accept', null);
  elsif st = 'none' then
    insert into connections (requester_id, addressee_id) values (v, p_user);
    perform notify(p_user, v, 'connect_request', null);
  end if;
  return jsonb_build_object('connection', connection_state(v, p_user));
end $$;


create or replace function create_post(p_kind text, p_body text, p_title text, p_media jsonb, p_reply_to bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); b text := trim(coalesce(p_body, '')); t text := trim(coalesce(p_title, '')); m jsonb := coalesce(p_media, '[]');
  parent posts; p posts;
begin
  if jsonb_typeof(m) <> 'array' or jsonb_array_length(m) > 10 then raise exception 'Up to 10 photos or videos per post.'; end if;
  m := clean_media(m, v, 10);
  if (select count(*) from regexp_matches(b, 'https?://', 'gi')) > 5 then raise exception 'Too many links in one post.'; end if;
  if b <> '' and exists (select 1 from posts where author_id = v and body = b and repost_of is null and created_at > now() - interval '10 minutes') then
    raise exception 'You just posted that.'; end if;
  perform hit('post', 10, '1 minute');
  perform hit('post_day', 400, '1 day');
  if p_reply_to is not null then
    parent := visible_post(p_reply_to, v);
    if p_kind <> 'note' then raise exception 'Replies are text posts.'; end if;
  end if;
  if p_kind = 'note' and b = '' and jsonb_array_length(m) = 0 then raise exception 'Write something first.';
  elsif p_kind = 'photo' and (jsonb_array_length(m) = 0 or exists (select 1 from jsonb_array_elements(m) e where e->>'type' <> 'image')) then
    raise exception 'Add at least one photo.';
  elsif p_kind = 'video' and (jsonb_array_length(m) <> 1 or m->0->>'type' <> 'video') then raise exception 'Add one video.';
  elsif p_kind = 'video' and t = '' then raise exception 'Give your video a title.';
  elsif p_kind not in ('note', 'photo', 'video') then raise exception 'Unknown post type.';
  end if;
  insert into posts (author_id, kind, body, title, media, reply_to) values (v, p_kind, b, t, m, p_reply_to) returning * into p;
  if p_reply_to is not null then
    update posts set reply_count = reply_count + 1 where id = p_reply_to;
    perform notify(parent.author_id, v, 'reply', parent.id, jsonb_build_object('reply_id', p.id));
  end if;
  return post_json(p, v);
end $$;


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


create or replace function create_story(p_media jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); i bigint;
begin
  if jsonb_typeof(p_media) <> 'object' or coalesce(p_media->>'url', '') = '' then raise exception 'Add a photo or video.'; end if;
  perform hit('story', 50, '1 day');
  insert into stories (author_id, media) values (v, clean_media(jsonb_build_array(p_media), v, 1)->0) returning id into i;
  return jsonb_build_object('id', i);
end $$;


create or replace function record_view(p_id bigint, p_position int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); p posts := visible_post(p_id, v);
begin
  if p.kind <> 'video' then raise exception 'Only videos have a watch history.'; end if;
  perform hit('view', 120, '1 minute');
  update watch_history set position = greatest(coalesce(p_position, 0), 0), watched_at = now() where user_id = v and post_id = p.id;
  if not found then
    insert into watch_history (user_id, post_id, position) values (v, p.id, greatest(coalesce(p_position, 0), 0));
    update posts set view_count = view_count + 1 where id = p.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;


create or replace function create_playlist(p_title text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); i bigint;
begin
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Name the playlist.'; end if;
  perform hit('playlist', 30, '1 day');
  insert into playlists (owner_id, title) values (v, trim(p_title)) returning id into i;
  return jsonb_build_object('id', i, 'title', trim(p_title), 'count', 0);
end $$;


create or replace function open_dm(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); c bigint;
begin
  if p_user = v then raise exception 'Pick someone else to message.'; end if;
  if not exists (select 1 from profiles where id = p_user) or blocked(v, p_user) then raise exception 'Profile not found.'; end if;
  select cv.id into c from conversations cv where not cv.is_group
    and exists (select 1 from conversation_members where conversation_id = cv.id and user_id = v)
    and exists (select 1 from conversation_members where conversation_id = cv.id and user_id = p_user);
  if c is null then
    perform hit('new_chat', 30, '1 hour');
    insert into conversations (is_group, created_by) values (false, v) returning id into c;
    insert into conversation_members (conversation_id, user_id) values (c, v), (c, p_user);
  end if;
  return jsonb_build_object('id', c);
end $$;


create or replace function create_group(p_title text, p_members uuid[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); c bigint; others uuid[];
begin
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Name the group.'; end if;
  select coalesce(array_agg(distinct p.id), '{}') into others from profiles p where p.id = any (p_members) and p.id <> v and not blocked(p.id, v);
  if cardinality(others) = 0 then raise exception 'Add at least one person.'; end if;
  if cardinality(others) > 255 then raise exception 'Groups can have up to 256 people.'; end if;
  perform hit('new_chat', 30, '1 hour');
  insert into conversations (is_group, title, created_by) values (true, trim(p_title), v) returning id into c;
  insert into conversation_members (conversation_id, user_id) select c, u from unnest(others || v) u;
  return jsonb_build_object('id', c);
end $$;


create or replace function send_message(p_conv bigint, p_body text, p_media jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); b text := trim(coalesce(p_body, '')); md jsonb := coalesce(p_media, '[]'); m messages;
begin
  if not exists (select 1 from conversation_members where conversation_id = p_conv and user_id = v) then raise exception 'Chat not found.'; end if;
  if exists (select 1 from conversations c join conversation_members o on o.conversation_id = c.id and o.user_id <> v
    where c.id = p_conv and not c.is_group and blocked(v, o.user_id)) then raise exception 'You can''t message this person.'; end if;
  if jsonb_typeof(md) <> 'array' or jsonb_array_length(md) > 10 then raise exception 'Up to 10 attachments.'; end if;
  md := clean_media(md, v, 10);
  if b = '' and jsonb_array_length(md) = 0 then raise exception 'Write a message first.'; end if;
  perform hit('message', 30, '1 minute');
  perform hit('message_day', 2000, '1 day');
  insert into messages (conversation_id, sender_id, body, media) values (p_conv, v, b, md) returning * into m;
  update conversations set last_message_id = m.id where id = p_conv;
  update conversation_members set last_read_id = m.id where conversation_id = p_conv and user_id = v;
  return msg_json(m);
end $$;


create or replace function create_company(p_name text, p_slug text, p_about text, p_website text, p_logo_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); s text := lower(trim(p_slug)); c companies;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Name the company.'; end if;
  if s !~ '^[a-z0-9-]{2,40}$' then raise exception 'The page address is 2-40 letters, numbers or -.'; end if;
  if exists (select 1 from companies where slug = s or lower(name) = lower(trim(p_name))) then raise exception 'That company already has a page.'; end if;
  if nullif(p_logo_url, '') is not null and not media_url_ok(p_logo_url, v) then raise exception 'That logo can''t be used. Please upload it again.'; end if;
  if coalesce(trim(p_website), '') <> '' and trim(p_website) !~* '^(https?://)?[a-z0-9.-]+\.[a-z]{2,}(/[^\s]*)?$' then raise exception 'Enter a valid website.'; end if;
  perform hit('company', 3, '1 day');
  insert into companies (slug, name, about, website, logo_url, owner_id)
  values (s, trim(p_name), coalesce(p_about, ''), coalesce(trim(p_website), ''), nullif(p_logo_url, ''), v) returning * into c;
  update experiences set company_id = c.id where company_id is null and lower(company_name) = lower(c.name);
  return company_json(c);
end $$;


create or replace function create_job(p_company bigint, p_title text, p_location text, p_remote boolean, p_type text, p_description text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); j jobs;
begin
  if not exists (select 1 from companies where id = p_company and owner_id = v) then raise exception 'Only the company page owner can post jobs.'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 100 then raise exception 'Give the job a title.'; end if;
  if p_type not in ('full_time', 'part_time', 'contract', 'internship') then raise exception 'Pick a job type.'; end if;
  perform hit('job', 20, '1 day');
  insert into jobs (company_id, posted_by, title, location, remote, employment_type, description)
  values (p_company, v, trim(p_title), coalesce(trim(p_location), ''), coalesce(p_remote, false), p_type, coalesce(p_description, '')) returning * into j;
  return job_json(j, v);
end $$;


create or replace function apply_job(p_job bigint, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); j jobs;
begin
  select * into j from jobs where id = p_job;
  if j.id is null or not j.open then raise exception 'This job is closed.'; end if;
  if can_manage_job(j, v) then raise exception 'You manage this job.'; end if;
  if exists (select 1 from applications where job_id = j.id and applicant_id = v) then raise exception 'You already applied.'; end if;
  perform hit('apply', 50, '1 day');
  insert into applications (job_id, applicant_id, note) values (j.id, v, coalesce(p_note, ''));
  perform notify(j.posted_by, v, 'application', null, jsonb_build_object('job_id', j.id, 'title', j.title));
  return jsonb_build_object('applied', true);
end $$;


create or replace function search(p_q text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); q text := left(trim(coalesce(p_q, '')), 100); pat text;
begin
  if q = '' then return jsonb_build_object('people', '[]'::jsonb, 'posts', '[]'::jsonb, 'videos', '[]'::jsonb, 'jobs', '[]'::jsonb, 'companies', '[]'::jsonb); end if;
  pat := like_pattern(q);
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(card(p.id) order by p.handle) from (select * from profiles p where (p.handle ilike pat or p.name ilike pat)
      and not blocked(p.id, v) order by p.handle limit 10) p), '[]'),
    'posts', coalesce((select jsonb_agg(post_json(p, v) order by p.id desc) from (select * from posts p where p.kind in ('note', 'photo')
      and p.reply_to is null and p.repost_of is null and not p.hidden and p.body ilike pat and not blocked(p.author_id, v) order by p.id desc limit 10) p), '[]'),
    'videos', coalesce((select jsonb_agg(post_json(p, v) order by p.id desc) from (select * from posts p where p.kind = 'video'
      and not p.hidden and (p.title ilike pat or p.body ilike pat) and not blocked(p.author_id, v) order by p.id desc limit 10) p), '[]'),
    'jobs', coalesce((select jsonb_agg(job_json(j, v) order by j.id desc) from (select j.* from jobs j join companies c on c.id = j.company_id
      where j.open and (j.title ilike pat or c.name ilike pat) order by j.id desc limit 10) j), '[]'),
    'companies', coalesce((select jsonb_agg(company_json(c) order by lower(c.name)) from (select * from companies c where c.name ilike pat
      order by lower(c.name) limit 10) c), '[]'));
end $$;


create or replace function report(p_type text, p_target text, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if p_type not in ('post', 'profile') then raise exception 'You can report a post or a profile.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'Say what''s wrong.'; end if;
  if char_length(coalesce(p_target, '')) > 64 then raise exception 'Report not found.'; end if;
  perform hit('report', 20, '1 hour');
  insert into reports (reporter_id, target_type, target_id, reason) values (v, p_type, p_target, trim(p_reason));
  return jsonb_build_object('ok', true);
end $$;


revoke all on function hit(text, int, interval), media_url_ok(text, uuid), clean_media(jsonb, uuid, int) from public, anon, authenticated;

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
