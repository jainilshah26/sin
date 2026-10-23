# Sin

Five apps in one, on one account: **Feed** (Twitter-style), **Photos** (Instagram-style), **Chat** (WhatsApp-style), **Video** (YouTube-style) and **Work** (LinkedIn-style).

| Mode | What works |
|---|---|
| Feed | Short posts with photos, replies (threads), likes, reposts, follow, Following/Explore timelines, who-to-follow, @mentions and #tags |
| Photos | Multi-photo posts (swipe carousel), 24-hour stories with a viewer, profile photo grid, comments |
| Chat | 1:1 and group chats, live delivery, read receipts ("Seen", "Seen by …"), unread badges, photo and video sharing |
| Video | Uploads with title and description, channels (a channel is your profile), subscribe, comments, view counts, watch history with resume, playlists |
| Work | Professional profile (headline, about, experience, skills, open to work), connections (request/accept), company pages, job posts, apply, applicant review with status updates |
| Shared | Email sign-up, one profile, notifications from every mode, one search across everything, report/block, moderation queue |

How the five modes stay one app: one tab bar and header, one profile page with Posts / Photos / Videos / Professional tabs, one content model (a reply, a photo comment and a video comment are all posts), one follow graph (following someone on Feed is subscribing to them on Video), one inbox of notifications and one search. Each mode only changes the accent colour.

## Stack

- **Front end:** plain HTML/CSS/ES modules, no framework (`index.html`, `css/`, `js/`). Installable on phones (web app manifest). `npm run build` bundles it into `dist/` with hashed file names.
- **Back end:** Supabase. Postgres functions in `supabase/migrations/` do everything (one function per action, run as the signed-in user). Tables are not readable with the public key, except the three that Realtime streams (messages, chat members, notifications), which have row level security. Media goes to a public Storage bucket where each user can only write into their own folder.
- **Offline test mode:** with no Supabase settings, or with `/?offline`, the same functions run in the browser (`js/backend/local.js`). Accounts live in that browser and tabs talk to each other, so you can chat with yourself in two tabs.

## Run and test

```
npx http-server -c-1 .          # or any static server, then open http://localhost:8080/?offline
npm test                         # contract tests: 195 steps, run on local.js and on Postgres, every answer must match
npm run e2e                      # two people in two tabs go through every mode in Chromium; screenshots in tests/shots/
```

`npm test` compares against Postgres when one is reachable (`DATABASE_URL`, default `postgres://sin:sin@localhost/sin_test`). Without one it tests only the offline backend.

## Going live

1. Create a Supabase project. Run the three files in `supabase/migrations/` in order in the SQL editor (or `supabase db push`).
2. In Authentication → Providers, keep Email on. Turn off "Confirm email" while testing, or users must confirm before logging in.
3. Put the project URL and publishable key in `js/config.js`.
4. Import the repo in Vercel (it uses `vercel.json`: `npm run build`, output `dist/`).

The first account created becomes the moderator (Settings → Moderation queue). Make others moderators with `update profiles set role = 'mod' where handle = '…'`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how each hard part is handled now and what changes at scale.
