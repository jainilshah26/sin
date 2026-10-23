-- Sin: one account, five modes (Feed, Photos, Chat, Video, Work).
-- Every mode shares one content model: a post is a note, a photo or a video, and a reply/comment is a post with reply_to.
-- Tables are not readable with the public key. The app talks to the database through the functions in 0002,
-- except for the three tables Realtime streams (messages, conversation_members, notifications), which have read policies.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  name text not null check (char_length(name) between 1 and 50),
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'mod')),
  created_at timestamptz not null default now()
);

-- The professional side of the same account. Social profile = who you are, pro profile = what you do.
create table pro_profiles (
  user_id uuid primary key references profiles (id) on delete cascade,
  headline text not null default '' check (char_length(headline) <= 120),
  location text not null default '' check (char_length(location) <= 80),
  about text not null default '' check (char_length(about) <= 2000),
  skills text[] not null default '{}',
  open_to_work boolean not null default false
);

create table companies (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  about text not null default '' check (char_length(about) <= 2000),
  website text not null default '',
  logo_url text,
  owner_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index companies_name_key on companies (lower(name));

create table experiences (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  company_name text not null check (char_length(company_name) between 1 and 80),
  company_id bigint references companies (id) on delete set null,
  start_date date not null,
  end_date date,
  description text not null default '' check (char_length(description) <= 1000)
);
create index on experiences (user_id);
create index on experiences (company_id);

-- Social graph: follow is one-way (Feed, Photos, Video "subscribe"), a connection is mutual (Work).
create table follows (
  follower_id uuid not null references profiles (id) on delete cascade,
  followee_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index on follows (followee_id);

create table connections (
  requester_id uuid not null references profiles (id) on delete cascade,
  addressee_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create index on connections (addressee_id);

create table blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  primary key (blocker_id, blocked_id)
);

create table posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('note', 'photo', 'video')),
  body text not null default '' check (char_length(body) <= 2000),
  title text not null default '' check (char_length(title) <= 150),
  media jsonb not null default '[]',
  reply_to bigint references posts (id) on delete cascade,
  repost_of bigint references posts (id) on delete cascade,
  like_count int not null default 0,
  reply_count int not null default 0,
  repost_count int not null default 0,
  view_count int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index on posts (author_id, id desc);
create index posts_top on posts (kind, id desc) where reply_to is null and not hidden;
create index on posts (reply_to, id) where reply_to is not null;
create unique index posts_one_repost on posts (author_id, repost_of) where repost_of is not null;

create table likes (
  user_id uuid not null references profiles (id) on delete cascade,
  post_id bigint not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table stories (
  id bigint generated always as identity primary key,
  author_id uuid not null references profiles (id) on delete cascade,
  media jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index on stories (author_id, expires_at);

create table watch_history (
  user_id uuid not null references profiles (id) on delete cascade,
  post_id bigint not null references posts (id) on delete cascade,
  position int not null default 0,
  watched_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index on watch_history (user_id, watched_at desc);

create table playlists (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now()
);

create table playlist_items (
  playlist_id bigint not null references playlists (id) on delete cascade,
  post_id bigint not null references posts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, post_id)
);

create table conversations (
  id bigint generated always as identity primary key,
  is_group boolean not null default false,
  title text not null default '' check (char_length(title) <= 80),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_id bigint not null default 0
);

create table conversation_members (
  conversation_id bigint not null references conversations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_read_id bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on conversation_members (user_id);

create table messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references conversations (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  media jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, id desc);

create table jobs (
  id bigint generated always as identity primary key,
  company_id bigint not null references companies (id) on delete cascade,
  posted_by uuid references profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 100),
  location text not null default '' check (char_length(location) <= 80),
  remote boolean not null default false,
  employment_type text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract', 'internship')),
  description text not null default '' check (char_length(description) <= 5000),
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create index on jobs (company_id);

create table applications (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  applicant_id uuid not null references profiles (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 2000),
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'rejected', 'offer')),
  created_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);
create index on applications (applicant_id);

create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  actor_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  post_id bigint references posts (id) on delete cascade,
  data jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, id desc);

create table reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'profile')),
  target_id text not null,
  reason text not null check (char_length(reason) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'dismissed', 'removed')),
  created_at timestamptz not null default now()
);

-- Row level security: on everywhere, read policies only where Realtime needs them.
do $$ declare t text; begin
  foreach t in array array['profiles','pro_profiles','companies','experiences','follows','connections','blocks','posts','likes',
    'stories','watch_history','playlists','playlist_items','conversations','conversation_members','messages','jobs',
    'applications','notifications','reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

create function is_member(p_conv bigint) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from conversation_members where conversation_id = p_conv and user_id = auth.uid()) $$;

grant select on messages, conversation_members, notifications to authenticated;
create policy members_read_messages on messages for select to authenticated using (is_member(conversation_id));
create policy members_read_members on conversation_members for select to authenticated using (is_member(conversation_id));
create policy own_notifications on notifications for select to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table messages, conversation_members, notifications;
