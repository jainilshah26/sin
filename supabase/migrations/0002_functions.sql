-- Everything the app does is one of these functions. js/backend/local.js implements the same functions for ?offline,
-- and tests/contract.mjs runs one scenario against both and checks they answer the same.
-- All run as the signed-in user (auth.uid()), return jsonb, and raise a plain-English message on a bad request.

-- ---------- helpers ----------
create function me_id() returns uuid language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists (select 1 from profiles where id = u) then raise exception 'Sign in first.'; end if;
  return u;
end $$;

create function card(p uuid) returns jsonb language sql stable security definer set search_path = public as
  $$ select jsonb_build_object('id', id, 'handle', handle, 'name', name, 'avatar_url', avatar_url) from profiles where id = p $$;

create function blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;

create function notify(p_user uuid, p_actor uuid, p_type text, p_post bigint, p_data jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, actor_id, type, post_id, data)
  select p_user, p_actor, p_type, p_post, p_data where p_user <> p_actor and not blocked(p_user, p_actor)
$$;

create function like_pattern(q text) returns text language sql immutable set search_path = public as
  $$ select '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' $$;

create function post_json(p posts, v uuid, nested boolean default true) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'body', p.body, 'title', p.title, 'media', p.media, 'created_at', p.created_at,
    'author', card(p.author_id), 'reply_to', p.reply_to,
    'repost_of', case when p.repost_of is not null and nested then
      (select post_json(o, v, false) from posts o where o.id = p.repost_of and not o.hidden and not blocked(o.author_id, v)) end,
    'like_count', p.like_count, 'reply_count', p.reply_count, 'repost_count', p.repost_count, 'view_count', p.view_count,
    'liked', exists (select 1 from likes l where l.user_id = v and l.post_id = p.id),
    'reposted', exists (select 1 from posts r where r.author_id = v and r.repost_of = p.id),
    'mine', p.author_id = v)
$$;

create function visible_post(p_id bigint, v uuid) returns posts language plpgsql stable security definer set search_path = public as $$
declare p posts;
begin
  select * into p from posts where id = p_id;
  if p.id is null or p.hidden or blocked(p.author_id, v) then raise exception 'Post not found.'; end if;
  return p;
end $$;

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

-- ---------- accounts and profiles ----------
create function me() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'handle', handle, 'name', name, 'bio', bio, 'avatar_url', avatar_url, 'role', role, 'created_at', created_at)
  from profiles where id = auth.uid()
$$;

create function create_profile(p_handle text, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h text := lower(trim(p_handle));
begin
  if u is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from profiles where id = u) then raise exception 'You already have a profile.'; end if;
  if h !~ '^[a-z0-9_]{3,20}$' then raise exception 'Handles are 3-20 letters, numbers or _.'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 50 then raise exception 'Enter your name.'; end if;
  if exists (select 1 from profiles where handle = h) then raise exception 'That handle is taken.'; end if;
  -- the first account on a new install moderates it
  insert into profiles (id, handle, name, role) values (u, h, trim(p_name), case when exists (select 1 from profiles) then 'user' else 'mod' end);
  insert into pro_profiles (user_id) values (u);
  return me();
end $$;

create function update_profile(p_name text, p_bio text, p_avatar_url text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 50 then raise exception 'Enter your name.'; end if;
  if char_length(coalesce(p_bio, '')) > 300 then raise exception 'Keep your bio under 300 characters.'; end if;
  if nullif(p_avatar_url, '') is not null and not media_url_ok(p_avatar_url, v) then raise exception 'That photo can''t be used. Please upload it again.'; end if;
  perform hit('profile', 30, '1 hour');
  update profiles set name = trim(p_name), bio = coalesce(p_bio, ''), avatar_url = nullif(p_avatar_url, '') where id = v;
  return me();
end $$;

create function pro_json(u uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('headline', headline, 'location', location, 'about', about, 'skills', to_jsonb(skills), 'open_to_work', open_to_work)
  from pro_profiles where user_id = u
$$;

create function connection_state(v uuid, u uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select case when status = 'accepted' then 'connected' when requester_id = v then 'outgoing' else 'incoming' end
    from connections where (requester_id = v and addressee_id = u) or (requester_id = u and addressee_id = v)), 'none')
$$;

create function get_profile(p_handle text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); p profiles;
begin
  select * into p from profiles where handle = lower(p_handle);
  if p.id is null or exists (select 1 from blocks where blocker_id = p.id and blocked_id = v) then raise exception 'Profile not found.'; end if;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'handle', p.handle, 'name', p.name, 'bio', p.bio, 'avatar_url', p.avatar_url, 'created_at', p.created_at),
    'pro', pro_json(p.id),
    'experiences', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'company_name', e.company_name,
        'company_slug', c.slug, 'start_date', e.start_date, 'end_date', e.end_date, 'description', e.description)
        order by e.end_date desc nulls first, e.start_date desc, e.id desc)
      from experiences e left join companies c on c.id = e.company_id where e.user_id = p.id), '[]'),
    'counts', jsonb_build_object(
      'followers', (select count(*) from follows where followee_id = p.id),
      'following', (select count(*) from follows where follower_id = p.id),
      'posts', (select count(*) from posts where author_id = p.id and reply_to is null and repost_of is null and not hidden),
      'connections', (select count(*) from connections where status = 'accepted' and p.id in (requester_id, addressee_id))),
    'rel', jsonb_build_object('me', p.id = v,
      'following', exists (select 1 from follows where follower_id = v and followee_id = p.id),
      'followed_by', exists (select 1 from follows where follower_id = p.id and followee_id = v),
      'connection', connection_state(v, p.id),
      'blocked', exists (select 1 from blocks where blocker_id = v and blocked_id = p.id)));
end $$;

create function update_pro(p_headline text, p_location text, p_about text, p_skills text[], p_open_to_work boolean) returns jsonb
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

create function add_experience(p_title text, p_company_name text, p_start_date date, p_end_date date, p_description text) returns jsonb
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

create function delete_experience(p_id bigint) returns jsonb language sql security definer set search_path = public as $$
  delete from experiences where id = p_id and user_id = me_id(); select jsonb_build_object('ok', true)
$$;

-- ---------- social graph ----------
create function follow(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if p_user = v then raise exception 'You can''t follow yourself.'; end if;
  if not exists (select 1 from profiles where id = p_user) or blocked(v, p_user) then raise exception 'Profile not found.'; end if;
  perform hit('follow', 60, '1 hour');
  insert into follows (follower_id, followee_id) values (v, p_user) on conflict do nothing;
  if found then perform notify(p_user, v, 'follow', null); end if;
  return jsonb_build_object('following', true);
end $$;

create function unfollow(p_user uuid) returns jsonb language sql security definer set search_path = public as $$
  delete from follows where follower_id = me_id() and followee_id = p_user; select jsonb_build_object('following', false)
$$;

create function connect(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function disconnect(p_user uuid) returns jsonb language sql security definer set search_path = public as $$
  delete from connections where (requester_id = me_id() and addressee_id = p_user) or (requester_id = p_user and addressee_id = me_id());
  select jsonb_build_object('connection', 'none')
$$;

create function my_network() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id), x as (
    select case when c.status = 'accepted' then 'connected' when c.requester_id = v.id then 'outgoing' else 'incoming' end grp,
      case when c.requester_id = v.id then c.addressee_id else c.requester_id end other
    from connections c, v where v.id in (c.requester_id, c.addressee_id))
  select jsonb_build_object(
    'connected', coalesce((select jsonb_agg(card(other) || jsonb_build_object('headline', pp.headline) order by p.handle) from x join profiles p on p.id = other join pro_profiles pp on pp.user_id = other where grp = 'connected'), '[]'),
    'incoming', coalesce((select jsonb_agg(card(other) || jsonb_build_object('headline', pp.headline) order by p.handle) from x join profiles p on p.id = other join pro_profiles pp on pp.user_id = other where grp = 'incoming'), '[]'),
    'outgoing', coalesce((select jsonb_agg(card(other) || jsonb_build_object('headline', pp.headline) order by p.handle) from x join profiles p on p.id = other join pro_profiles pp on pp.user_id = other where grp = 'outgoing'), '[]'))
$$;

create function suggestions() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(card(s.id) order by s.created_at desc, s.handle), '[]') from (
    select p.* from profiles p, v where p.id <> v.id and not blocked(p.id, v.id)
      and not exists (select 1 from follows f where f.follower_id = v.id and f.followee_id = p.id)
    order by p.created_at desc, p.handle limit 8) s
$$;

create function block(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if p_user = v then raise exception 'You can''t block yourself.'; end if;
  insert into blocks values (v, p_user) on conflict do nothing;
  delete from follows where (follower_id = v and followee_id = p_user) or (follower_id = p_user and followee_id = v);
  delete from connections where (requester_id = v and addressee_id = p_user) or (requester_id = p_user and addressee_id = v);
  return jsonb_build_object('blocked', true);
end $$;

create function unblock(p_user uuid) returns jsonb language sql security definer set search_path = public as $$
  delete from blocks where blocker_id = me_id() and blocked_id = p_user; select jsonb_build_object('blocked', false)
$$;

-- ---------- posts (Feed, Photos, Video share these) ----------
create function create_post(p_kind text, p_body text, p_title text, p_media jsonb, p_reply_to bigint) returns jsonb
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

create function delete_post(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); p posts;
begin
  select * into p from posts where id = p_id;
  if p.id is null then raise exception 'Post not found.'; end if;
  if p.author_id <> v and (select role from profiles where id = v) <> 'mod' then raise exception 'You can only delete your own posts.'; end if;
  if p.reply_to is not null then update posts set reply_count = greatest(reply_count - 1, 0) where id = p.reply_to; end if;
  if p.repost_of is not null then update posts set repost_count = greatest(repost_count - 1, 0) where id = p.repost_of; end if;
  delete from posts where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function toggle_like(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function repost(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
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

-- One query serves the Feed timeline, the Photos and Video home pages, profile grids and channels.
-- p_scope: 'following' (people you follow and you), 'all' (explore), 'author' (one profile).
create function list_posts(p_kind text, p_scope text, p_author uuid, p_before bigint) returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(post_json(x, v.id) order by x.id desc), '[]') from v, (
    select p.* from posts p, v where p.kind = p_kind and p.reply_to is null and not p.hidden
      and (p_before is null or p.id < p_before) and not blocked(p.author_id, v.id)
      and (p_kind = 'note' or p.repost_of is null)
      and case p_scope
        when 'following' then p.author_id = v.id or p.author_id in (select followee_id from follows where follower_id = v.id)
        when 'author' then p.author_id = p_author
        else true end
    order by p.id desc limit 20) x
$$;

create function get_post(p_id bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); p posts := visible_post(p_id, v);
begin
  return jsonb_build_object('post', post_json(p, v),
    'parent', (select post_json(o, v) from posts o where o.id = p.reply_to and not o.hidden and not blocked(o.author_id, v)),
    'replies', coalesce((select jsonb_agg(post_json(r, v) order by r.id) from (select * from posts r where r.reply_to = p.id
      and not r.hidden and not blocked(r.author_id, v) order by r.id limit 200) r), '[]'));
end $$;

-- ---------- stories ----------
create function create_story(p_media jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); i bigint;
begin
  if jsonb_typeof(p_media) <> 'object' or coalesce(p_media->>'url', '') = '' then raise exception 'Add a photo or video.'; end if;
  perform hit('story', 50, '1 day');
  insert into stories (author_id, media) values (v, clean_media(jsonb_build_array(p_media), v, 1)->0) returning id into i;
  return jsonb_build_object('id', i);
end $$;

create function stories() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(g order by mine desc, last desc), '[]') from (
    select s.author_id = v.id mine, max(s.id) last, jsonb_build_object('author', card(s.author_id),
      'items', jsonb_agg(jsonb_build_object('id', s.id, 'media', s.media, 'created_at', s.created_at) order by s.id)) g
    from stories s, v where s.expires_at > now() and not blocked(s.author_id, v.id)
      and (s.author_id = v.id or s.author_id in (select followee_id from follows where follower_id = v.id))
    group by s.author_id, v.id) t
$$;

-- ---------- video: history and playlists ----------
create function record_view(p_id bigint, p_position int) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function watch_history() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(jsonb_build_object('post', post_json(p, v.id), 'position', h.position, 'watched_at', h.watched_at) order by h.watched_at desc), '[]')
  from v, (select * from watch_history where user_id = (select id from v) order by watched_at desc limit 50) h
  join posts p on p.id = h.post_id where not p.hidden and not blocked(p.author_id, v.id)
$$;

create function clear_history() returns jsonb language sql security definer set search_path = public as $$
  delete from watch_history where user_id = me_id(); select jsonb_build_object('ok', true)
$$;

create function my_playlists() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title,
    'count', (select count(*) from playlist_items i where i.playlist_id = l.id)) order by l.id desc), '[]')
  from playlists l where l.owner_id = me_id()
$$;

create function create_playlist(p_title text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); i bigint;
begin
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Name the playlist.'; end if;
  perform hit('playlist', 30, '1 day');
  insert into playlists (owner_id, title) values (v, trim(p_title)) returning id into i;
  return jsonb_build_object('id', i, 'title', trim(p_title), 'count', 0);
end $$;

create function playlist_add(p_playlist bigint, p_post bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); p posts := visible_post(p_post, v);
begin
  if not exists (select 1 from playlists where id = p_playlist and owner_id = v) then raise exception 'Playlist not found.'; end if;
  if p.kind <> 'video' then raise exception 'Only videos go in playlists.'; end if;
  insert into playlist_items (playlist_id, post_id) values (p_playlist, p.id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create function playlist_remove(p_playlist bigint, p_post bigint) returns jsonb language sql security definer set search_path = public as $$
  delete from playlist_items i using playlists l where i.playlist_id = p_playlist and i.post_id = p_post and l.id = i.playlist_id and l.owner_id = me_id();
  select jsonb_build_object('ok', true)
$$;

create function get_playlist(p_id bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); l playlists;
begin
  select * into l from playlists where id = p_id;
  if l.id is null or blocked(l.owner_id, v) then raise exception 'Playlist not found.'; end if;
  return jsonb_build_object('id', l.id, 'title', l.title, 'owner', card(l.owner_id), 'mine', l.owner_id = v,
    'items', coalesce((select jsonb_agg(post_json(p, v) order by i.added_at, p.id) from playlist_items i join posts p on p.id = i.post_id
      where i.playlist_id = l.id and not p.hidden and not blocked(p.author_id, v)), '[]'));
end $$;

-- ---------- chat ----------
create function conversations() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(c order by lm desc, id desc), '[]') from (
    select cv.id, cv.last_message_id lm, jsonb_build_object('id', cv.id, 'is_group', cv.is_group, 'title', cv.title,
      'members', coalesce((select jsonb_agg(card(m2.user_id) order by p.handle) from conversation_members m2 join profiles p on p.id = m2.user_id
        where m2.conversation_id = cv.id and m2.user_id <> v.id), '[]'),
      'last', (select jsonb_build_object('id', x.id, 'body', x.body, 'sender_id', x.sender_id, 'created_at', x.created_at,
        'has_media', jsonb_array_length(x.media) > 0) from messages x where x.id = cv.last_message_id),
      'unread', (select count(*) from messages x where x.conversation_id = cv.id and x.id > m.last_read_id and x.sender_id <> v.id)) c
    from v, conversation_members m join conversations cv on cv.id = m.conversation_id where m.user_id = v.id) t
$$;

create function open_dm(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function create_group(p_title text, p_members uuid[]) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function msg_json(m messages) returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'sender_id', m.sender_id, 'body', m.body, 'media', m.media, 'created_at', m.created_at)
$$;

create function get_messages(p_conv bigint, p_before bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); cv conversations;
begin
  select * into cv from conversations where id = p_conv;
  if cv.id is null or not exists (select 1 from conversation_members where conversation_id = p_conv and user_id = v) then raise exception 'Chat not found.'; end if;
  return jsonb_build_object(
    'conversation', jsonb_build_object('id', cv.id, 'is_group', cv.is_group, 'title', cv.title,
      'members', coalesce((select jsonb_agg(card(m.user_id) order by p.handle) from conversation_members m join profiles p on p.id = m.user_id
        where m.conversation_id = cv.id and m.user_id <> v), '[]')),
    'messages', coalesce((select jsonb_agg(msg_json(m) order by m.id) from (select * from messages m where m.conversation_id = cv.id
      and (p_before is null or m.id < p_before) order by m.id desc limit 50) m), '[]'),
    'reads', (select jsonb_object_agg(user_id, last_read_id) from conversation_members where conversation_id = cv.id));
end $$;

create function send_message(p_conv bigint, p_body text, p_media jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function mark_read(p_conv bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); l bigint;
begin
  select last_message_id into l from conversations where id = p_conv;
  update conversation_members set last_read_id = l where conversation_id = p_conv and user_id = v and last_read_id < l;
  return jsonb_build_object('last_read_id', coalesce(l, 0));
end $$;

-- ---------- work: companies, jobs, applications ----------
create function company_json(c companies) returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'about', c.about, 'website', c.website, 'logo_url', c.logo_url)
$$;

create function can_manage_job(j jobs, v uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select j.posted_by = v or exists (select 1 from companies where id = j.company_id and owner_id = v) $$;

create function job_json(j jobs, v uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', j.id, 'title', j.title, 'location', j.location, 'remote', j.remote, 'employment_type', j.employment_type,
    'description', j.description, 'open', j.open, 'created_at', j.created_at,
    'company', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'logo_url', c.logo_url) from companies c where c.id = j.company_id),
    'applied', exists (select 1 from applications a where a.job_id = j.id and a.applicant_id = v),
    'applicants', (select count(*) from applications a where a.job_id = j.id),
    'can_manage', can_manage_job(j, v))
$$;

create function companies() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(company_json(c) order by lower(c.name)), '[]') from companies c where me_id() is not null
$$;

create function my_companies() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(company_json(c) order by lower(c.name)), '[]') from companies c where c.owner_id = me_id()
$$;

create function create_company(p_name text, p_slug text, p_about text, p_website text, p_logo_url text) returns jsonb
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

create function get_company(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); c companies;
begin
  select * into c from companies where slug = lower(p_slug);
  if c.id is null then raise exception 'Company not found.'; end if;
  return jsonb_build_object('company', company_json(c), 'owner', c.owner_id = v,
    'jobs', coalesce((select jsonb_agg(job_json(j, v) order by j.open desc, j.id desc) from jobs j where j.company_id = c.id), '[]'),
    'people', coalesce((select jsonb_agg(x.c || jsonb_build_object('title', x.title, 'current', x.cur) order by x.cur desc, x.handle) from (
      select distinct on (e.user_id) card(e.user_id) c, e.title, e.end_date is null cur, p.handle from experiences e join profiles p on p.id = e.user_id
      where e.company_id = c.id and not blocked(e.user_id, v) order by e.user_id, (e.end_date is null) desc, e.start_date desc) x), '[]'));
end $$;

create function create_job(p_company bigint, p_title text, p_location text, p_remote boolean, p_type text, p_description text) returns jsonb
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

create function list_jobs(p_q text, p_before bigint) returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(job_json(x, v.id) order by x.id desc), '[]') from v, (
    select j.* from jobs j join companies c on c.id = j.company_id where j.open and (p_before is null or j.id < p_before)
      and (coalesce(trim(p_q), '') = '' or j.title ilike like_pattern(trim(p_q)) or c.name ilike like_pattern(trim(p_q)) or j.location ilike like_pattern(trim(p_q)))
    order by j.id desc limit 20) x
$$;

create function get_job(p_id bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id(); j jobs;
begin
  select * into j from jobs where id = p_id;
  if j.id is null then raise exception 'Job not found.'; end if;
  return jsonb_build_object('job', job_json(j, v), 'applications', case when can_manage_job(j, v) then coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'applicant', card(a.applicant_id) || jsonb_build_object('headline', pp.headline),
      'note', a.note, 'status', a.status, 'created_at', a.created_at) order by a.id)
    from applications a join pro_profiles pp on pp.user_id = a.applicant_id where a.job_id = j.id), '[]') end);
end $$;

create function apply_job(p_job bigint, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
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

create function my_applications() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at, 'job', job_json(j, v.id)) order by a.id desc), '[]')
  from v, applications a join jobs j on j.id = a.job_id where a.applicant_id = v.id
$$;

create function set_application_status(p_id bigint, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); a applications; j jobs;
begin
  select * into a from applications where id = p_id;
  select * into j from jobs where id = a.job_id;
  if a.id is null or not can_manage_job(j, v) then raise exception 'Application not found.'; end if;
  if p_status not in ('submitted', 'reviewing', 'rejected', 'offer') then raise exception 'Unknown status.'; end if;
  update applications set status = p_status where id = p_id;
  perform notify(a.applicant_id, v, 'application_status', null, jsonb_build_object('job_id', j.id, 'title', j.title, 'status', p_status));
  return jsonb_build_object('status', p_status);
end $$;

create function close_job(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id(); j jobs;
begin
  select * into j from jobs where id = p_id;
  if j.id is null or not can_manage_job(j, v) then raise exception 'Job not found.'; end if;
  update jobs set open = false where id = p_id;
  return jsonb_build_object('open', false);
end $$;

-- ---------- shared: notifications, search, moderation ----------
create function notifications() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'read', n.read, 'created_at', n.created_at,
    'actor', card(n.actor_id), 'post_id', n.post_id, 'data', n.data,
    'snippet', (select left(coalesce(nullif(p.title, ''), p.body), 80) from posts p where p.id = n.post_id)) order by n.id desc), '[]')
  from v, (select * from notifications where user_id = (select id from v) order by id desc limit 50) n where not blocked(n.actor_id, v.id)
$$;

create function mark_notifications_read() returns jsonb language sql security definer set search_path = public as $$
  update notifications set read = true where user_id = me_id() and not read; select jsonb_build_object('ok', true)
$$;

create function badges() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select me_id() id)
  select jsonb_build_object(
    'notifications', (select count(*) from notifications n where n.user_id = v.id and not n.read and not blocked(n.actor_id, v.id)),
    'messages', (select count(*) from conversation_members m join messages x on x.conversation_id = m.conversation_id
      where m.user_id = v.id and x.id > m.last_read_id and x.sender_id <> v.id))
  from v
$$;

create function search(p_q text) returns jsonb language plpgsql stable security definer set search_path = public as $$
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

create function report(p_type text, p_target text, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if p_type not in ('post', 'profile') then raise exception 'You can report a post or a profile.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'Say what''s wrong.'; end if;
  if char_length(coalesce(p_target, '')) > 64 then raise exception 'Report not found.'; end if;
  perform hit('report', 20, '1 hour');
  insert into reports (reporter_id, target_type, target_id, reason) values (v, p_type, p_target, trim(p_reason));
  return jsonb_build_object('ok', true);
end $$;

create function require_mod() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := me_id();
begin
  if (select role from profiles where id = v) <> 'mod' then raise exception 'Moderators only.'; end if;
  return v;
end $$;

create function mod_queue() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := require_mod();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'target_type', r.target_type, 'target_id', r.target_id, 'reason', r.reason,
    'created_at', r.created_at, 'reporter', card(r.reporter_id),
    'post', case when r.target_type = 'post' then (select post_json(p, v) from posts p where p.id::text = r.target_id) end,
    'profile', case when r.target_type = 'profile' then (select card(p.id) from profiles p where p.id::text = r.target_id) end) order by r.id desc)
  from reports r where r.status = 'open'), '[]');
end $$;

create function mod_resolve(p_id bigint, p_action text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := require_mod(); r reports;
begin
  select * into r from reports where id = p_id;
  if r.id is null then raise exception 'Report not found.'; end if;
  if p_action not in ('dismiss', 'remove') then raise exception 'Dismiss or remove.'; end if;
  if p_action = 'remove' and r.target_type = 'post' then update posts set hidden = true where id::text = r.target_id; end if;
  if p_action = 'remove' and r.target_type = 'profile' then update posts set hidden = true where author_id::text = r.target_id; end if;
  update reports set status = case when p_action = 'remove' then 'removed' else 'dismissed' end
  where status = 'open' and target_type = r.target_type and target_id = r.target_id;
  return jsonb_build_object('ok', true);
end $$;

-- Only signed-in users may call anything, and only the app's actions: the helpers above run inside them
-- (as the function owner) and are not callable on their own, so nobody can e.g. send a notification as someone else.
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('me_id', 'card', 'blocked', 'notify', 'like_pattern', 'post_json', 'visible_post', 'pro_json', 'connection_state',
        'msg_json', 'company_json', 'can_manage_job', 'job_json', 'require_mod', 'hit', 'media_url_ok', 'clean_media') then
      execute format('grant execute on function %s to authenticated', f.sig);   -- is_member stays: the chat read policies call it
    end if;
  end loop;
end $$;
