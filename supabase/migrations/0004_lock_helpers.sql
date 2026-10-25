-- Applied to the live project after 0002 first went out; a fresh install already gets this from 0002's last block.
-- Internal helpers run inside the app's functions and must not be callable on their own.
alter function like_pattern(text) set search_path = public;
alter function msg_json(messages) set search_path = public;
alter function company_json(companies) set search_path = public;
revoke execute on function me_id(), card(uuid), blocked(uuid, uuid), notify(uuid, uuid, text, bigint, jsonb), like_pattern(text),
  post_json(posts, uuid, boolean), visible_post(bigint, uuid), pro_json(uuid), connection_state(uuid, uuid), msg_json(messages),
  company_json(companies), can_manage_job(jobs, uuid), job_json(jobs, uuid), require_mod() from public, anon, authenticated;
