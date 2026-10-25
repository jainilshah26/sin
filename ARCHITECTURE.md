# Architecture

## Data model

```
auth.users ─ profiles (social: handle, name, bio, avatar)      follows (one-way: Feed, Photos, Video subscribe)
             └ pro_profiles (headline, about, skills)           connections (mutual, request → accept: Work)
             └ experiences ─ companies ─ jobs ─ applications    blocks
posts (kind: note | photo | video, reply_to, repost_of, media jsonb)  ─ likes, watch_history, playlist_items
stories (expire after 24h)    conversations ─ conversation_members (last_read_id) ─ messages
notifications (from every mode)    reports (moderation)
```

One `posts` table carries all three content modes, so likes, replies/comments, reposts, reports, search and notifications are written once. One account has two faces: `profiles` is who you are (shown in Feed, Photos, Chat, Video), `pro_profiles` + `experiences` is what you do (shown in Work and on the Professional tab). That is the answer to "two profile types on one account": not two accounts, one account with two sets of fields and two kinds of relationship (follow vs connect).

## The hard parts, now and at scale

### Fast timelines (Feed)
**Now:** fan-out on read. `list_posts` reads the latest 20 posts by the people you follow, using the `(author_id, id desc)` index, with cursor paging by id. Fine into the low millions of posts and for people following a few hundred accounts.
**At scale:** fan-out on write. On post, push the post id into a per-follower timeline list (Redis sorted set or a `timeline_items` table) from a queue worker. Skip the push for accounts with huge follower counts and merge their posts in at read time (the hybrid Twitter uses). Counters (`like_count` etc.) are already stored on the post, so cards never count rows.

### Image processing and storage cost (Photos)
**Now:** done on the phone before upload (`js/media.js`): re-encoded to JPEG at most 1080px, plus a 360px thumbnail for grids and lists. This strips EXIF/GPS data and typically cuts a 4–8 MB phone photo to 150–400 KB. Grids load only thumbnails.
**At scale:** serve through an image CDN with on-the-fly resizing (Supabase Image Transformations, Cloudflare Images or imgproxy), store AVIF/WebP variants, move old originals to cold storage, and run uploads through a moderation/NSFW classifier before they become visible.

### Real-time delivery and encryption (Chat)
**Now:** messages are rows; Supabase Realtime streams new rows to members (row level security decides who receives what), and read receipts are a `last_read_id` per member, so "Seen" costs one row update rather than one per message. Traffic is TLS-encrypted and only members can read a chat.
**At scale / next:** end-to-end encryption needs keys on devices: each device publishes an identity key, 1:1 chats use X3DH + Double Ratchet (the Signal protocol, e.g. libsignal), groups use sender keys or MLS. The server then stores only ciphertext, which means server-side search and moderation of chat content stop working. Decide that trade-off before launch. Add push notifications (Web Push / APNs / FCM) for closed apps.

### Video transcoding and streaming (Video), the most expensive module
**Now:** the original file is uploaded to Storage (up to 200 MB), a poster frame and duration are taken on the phone, and the browser plays the file directly. Fine for a beta. The bill grows with every view because the full original is downloaded each time.
**At scale:** don't build this yourself first. Upload straight to Mux, Cloudflare Stream or AWS MediaConvert. They transcode to an HLS/DASH ladder (240p–1080p+) and you pay per minute stored and delivered. Store their playback id in `media`. Self-hosting means an ffmpeg worker queue writing HLS segments to object storage behind a CDN. Cost control: cap length and resolution per account tier, transcode lazily (only the top rungs for videos that get views), and keep egress on a CDN with cheap bandwidth.

### Five modes that feel like one app
One shell (header with search, notifications and you; a five-tab bar that becomes a side rail on desktop), one profile page with a tab per mode, one composer, one notification inbox, one search and one follow graph. Each mode changes only the accent colour. New modes should reuse `posts` and `postCard` rather than adding new tables.

## Security model

Nothing online is unhackable; the aim is that every realistic route is closed or too slow to be worth it.

- **Identity:** Supabase Auth (email + password, optional Turnstile CAPTCHA). Every database function reads the caller from `auth.uid()` and checks permissions itself; mistakes raise plain-English errors.
- **Data access:** RLS is on for every table with no grants, apart from `select` on messages, conversation_members (members only) and notifications (own rows only), which Realtime needs. Only `authenticated` may call functions, and internal helpers (`notify`, `blocked`, `hit`, `clean_media`, …) can't be called directly, so nobody can fake a notification or read who blocked whom.
- **Abuse limits:** `hit(action, max, window)` counts actions per person in fixed windows (table `rate_limits`, private). Limits: posts 10/min and 400/day; messages 30/min and 2000/day; likes 120/min; reposts 60/h; follows 60/h; new connection requests 40/day; new chats 30/h; stories 50/day; video views 120/min; playlists 30/day; profile edits 30/h; companies 3/day; jobs 20/day; applications 50/day; reports 20/h. Also: no identical post within 10 minutes, at most 5 links per post, search terms capped at 100 characters.
- **Media:** `clean_media` only accepts files under `<project>.supabase.co/storage/v1/object/public/media/<caller id>/` with a photo/video extension, and keeps only known fields with capped numbers. Storage accepts only JPEG/PNG/WebP/GIF/MP4/WebM/MOV up to 200 MB, named `<caller id>/<id>.<ext>`, at most 200 a day per person.
- **Browser:** all user text is escaped by the `html` template helper (no `innerHTML` with raw input). `vercel.json` sends a Content-Security-Policy (scripts only from this site and Cloudflare's CAPTCHA, connections only to this Supabase project, no plugins, no `<base>`, no framing), HSTS, `nosniff`, `DENY` framing, a strict referrer policy and a Permissions-Policy turning off camera, mic and location. There are no inline scripts (the build fails if one appears). The Supabase library is an npm dependency pinned to an exact version and bundled, so no CDN can change the running code.
- **Tests:** `tests/contract.mjs` checks the rules above against a real Postgres (including RLS, storage policies and the limits) and that `js/backend/local.js` gives the same answers; `npm run e2e:dist` runs the app under the production headers and fails on any blocked resource.

**Not covered yet:** end-to-end encrypted chat (see above), automatic image/text moderation, IP-level rate limits for anonymous traffic (Vercel Firewall / Cloudflare can add these), and two-factor login for users (Supabase supports TOTP; the UI isn't built).

## Next steps, roughly in order

1. Push notifications and email digests.
2. Ranking for Explore (recency × engagement, decay), with Following kept chronological.
3. Full-text search (Postgres `tsvector` or Typesense/Meilisearch) instead of `ilike`.
4. Video via Mux or Cloudflare Stream; image CDN.
5. Rate limits on writes (per user per minute), plus an automated spam and image-safety check on new posts.
6. Native apps (Capacitor wraps this one) once the web app proves out.
