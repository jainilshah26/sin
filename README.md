# Sin

Five apps in one, on one account: **Feed** (Twitter-style), **Photos** (Instagram-style), **Chat** (WhatsApp-style), **Video** (YouTube-style) and **Work** (LinkedIn-style).

| Mode | What works |
|---|---|
| Feed | Short posts with photos, replies (threads), likes, reposts, follow, Following/Explore timelines, who-to-follow, @mentions and #tags |
| Photos | Multi-photo posts (swipe carousel), 24-hour stories with a viewer, profile photo grid, comments |
| Chat | 1:1 and group chats, live delivery, read receipts ("Seen", "Seen by …"), unread badges, photo and video sharing |
| Video | Uploads with title and description, channels (a channel is your profile), subscribe, comments, view counts, watch history with resume, playlists |
| Work | Professional profile (headline, about, experience, skills, open to work), connections (request/accept), company pages, job posts, apply, applicant review with status updates |
| Shared | Email sign-up with forgot/change password, one profile, notifications from every mode, one search across everything, report/block, moderation queue |

How the five modes stay one app: one tab bar and header, one profile page with Posts / Photos / Videos / Professional tabs, one content model (a reply, a photo comment and a video comment are all posts), one follow graph (following someone on Feed is subscribing to them on Video), one inbox of notifications and one search. Each mode only changes the accent colour.

## Stack

- **Front end:** plain HTML/CSS/ES modules, no framework (`index.html`, `css/`, `js/`). Installable on phones (web app manifest). `npm run build` bundles it into `dist/` with hashed file names.
- **Back end:** Supabase. Postgres functions in `supabase/migrations/` do everything (one function per action, run as the signed-in user). Tables are not readable with the public key, except the three that Realtime streams (messages, chat members, notifications), which have row level security. Media goes to a public Storage bucket where each user can only write into their own folder.
- **Offline test mode:** with no Supabase settings, or with `/?offline`, the same functions run in the browser (`js/backend/local.js`). Accounts live in that browser and tabs talk to each other, so you can chat with yourself in two tabs.

## Run and test

```
npx http-server -c-1 .          # or any static server, then open http://localhost:8080/?offline (the online version needs `npm run build`, then serve dist/)
npm test                         # contract tests: 195 steps, run on local.js and on Postgres, every answer must match
npm run e2e                      # two people in two tabs go through every mode in Chromium; screenshots in tests/shots/
npm run e2e:dist                 # the same against the production build, with the real security headers
```

`npm test` compares against Postgres when one is reachable (`DATABASE_URL`, default `postgres://sin:sin@localhost/sin_test`). Without one it tests only the offline backend.

## Going live

1. Create a Supabase project. Run the three files in `supabase/migrations/` in order in the SQL editor (or `supabase db push`). `supabase/finish_setup.sql` does 0002 and 0003 in one paste and is safe to re-run.
2. In Authentication → Providers, keep Email on. Turn off "Confirm email" while testing, or users must confirm before logging in.
3. Put the project URL and publishable key in `js/config.js`.
4. Import the repo in Vercel (it uses `vercel.json`: `npm run build`, output `dist/`).

The first account created becomes the moderator (Settings → Moderation queue). Make others moderators with `update profiles set role = 'mod' where handle = '…'`.

## Security

What the code does (details in [ARCHITECTURE.md](ARCHITECTURE.md#security-model)):

- **Database:** every action is a function that checks who is asking; tables can't be read or written directly; internal helpers can't be called.
- **Flood and spam limits:** per person, e.g. 10 posts a minute, 30 messages a minute, 60 follows an hour, 20 reports an hour, 3 company pages a day. Duplicate posts within 10 minutes and posts with more than 5 links are refused.
- **Media:** only files the person uploaded to this project's storage can be attached (no outside links, tracking pixels or other people's files). Uploads: photos/videos only (no SVG/HTML), own folder only, 200 files a day.
- **Browser:** strict Content-Security-Policy (scripts only from this site), no framing (clickjacking), HSTS, no-sniff, camera/mic/location off. The Supabase library is bundled, not loaded from a CDN. `npm audit` is clean.
- **Bots:** optional Cloudflare Turnstile check on sign-up, log-in and password reset; `robots.txt` turns away AI crawlers (everything is behind log-in anyway).

`npm run e2e:dist` runs the end-to-end test against the production build with the real security headers.

### Settings only the owner can change (dashboards)

1. **Supabase → Authentication → Sign In / Providers → Email:** turn **Confirm email** on before inviting the public, and set the minimum password length to 8+ with letters and numbers.
2. **Bot protection (free):** Cloudflare dashboard → Turnstile → Add widget for `sinners.in` → copy the *site key* into `captchaSiteKey` in `js/config.js` (and deploy), then Supabase → Authentication → Attack Protection → enable CAPTCHA → Turnstile → paste the *secret key*. Do it in that order, or log-ins fail until the app is updated.
3. **Email sender:** Supabase → Authentication → Emails → SMTP Settings (e.g. Resend), so reset emails reach everyone and can't be used to burn your email quota.
4. **Your own accounts:** turn on two-factor login for GitHub, Vercel, Supabase, Hostinger and Cloudflare. Taking over one of those is the easiest way into the app.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how each hard part is handled now and what changes at scale.
