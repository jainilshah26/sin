/* App shell: sign-in, the five-mode tab bar, the router, and the screens every mode shares
   (profiles, post threads, notifications, search, settings, moderation). */
import { api, cloud, onLive } from "./api.js";
import { CONFIG } from "./config.js";
import { html, raw, $, icon, avatar, who, postCard, empty, loading, hydrate, toast, sheet, ask, confirmSheet, ago, rich, count, plural } from "./ui.js";
import * as compose from "./compose.js";
import * as feed from "./modes/feed.js";
import * as photos from "./modes/photos.js";
import * as chat from "./modes/chat.js";
import * as video from "./modes/video.js";
import * as work from "./modes/work.js";

const app = $("#app");
export const ctx = { me: null, mode: "feed", handlers: {}, cleanups: [] };
const MODES = [["feed", "Feed"], ["photos", "Photos"], ["chat", "Chat"], ["video", "Video"], ["work", "Work"]];

/* ---------- routing ---------- */
const shared = {
  "u/:handle": profile, "p/:id": thread, notifications, search, settings, mod,
};
const ROUTES = [];
const add = (mode, table) => { for (const [pat, f] of Object.entries(table)) ROUTES.push([new RegExp("^" + pat.replace(/:(\w+)/g, "(?<$1>[^/?]+)") + "$"), f, mode]); };
add("feed", feed.routes); add("photos", photos.routes); add("chat", chat.routes); add("video", video.routes); add("work", work.routes); add(null, shared);

export const go = h => { if (location.hash === h) route(); else location.hash = h; };
export function on(handlers) { Object.assign(ctx.handlers, handlers); }
export function live(f) { ctx.cleanups.push(onLive(f)); }

export async function route() {
  if (!ctx.me) return;
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  let hit = null;
  for (const [re, f, mode] of ROUTES) { const m = (path || "feed").match(re); if (m) { hit = [f, mode, m.groups || {}]; break; } }
  if (!hit) return go("#/feed");
  const [f, mode, params] = hit;
  ctx.cleanups.splice(0).forEach(c => c()); ctx.handlers = {};
  if (mode) ctx.mode = mode;
  document.body.dataset.mode = ctx.mode;
  for (const a of document.querySelectorAll(".tabs a")) a.classList.toggle("on", a.dataset.mode === ctx.mode);
  const view = $("#view"); view.innerHTML = loading().s; window.scrollTo(0, 0);
  const token = (route.n = (route.n || 0) + 1);
  params.q = new URLSearchParams(qs || "");
  try {
    await f(view, params, () => token === route.n);
    hydrate(view);
  } catch (e) { if (token === route.n) view.innerHTML = empty(e.message, html`<a class="btn" href="#/feed">Go to Feed</a>`).s; }
  badges();
}
/* re-render helper for views: draw(view, html``) then hydrate media */
export const draw = (el, h) => { el.innerHTML = h.s; hydrate(el); };

let badgeT;
export async function badges() {
  clearTimeout(badgeT);
  badgeT = setTimeout(async () => {
    try { const b = await api.badges(); setBadge("#nb", b.notifications); setBadge("#mb", b.messages); } catch (e) { }
  }, 150);
}
const setBadge = (sel, n) => { const el = $(sel); if (el) { el.textContent = n > 99 ? "99+" : n; el.hidden = !n; } };

/* ---------- shell ---------- */
function shell() {
  app.innerHTML = html`
    <header class="top">
      <a class="logo" href="#/feed">${CONFIG.name}</a>${cloud ? "" : html`<span class="chip warn" title="Accounts and posts live in this browser">offline</span>`}
      <span class="grow"></span>
      <a class="icon-btn" href="#/search" aria-label="Search">${icon("search")}</a>
      <a class="icon-btn" href="#/notifications" aria-label="Notifications">${icon("bell")}<i class="badge" id="nb" hidden></i></a>
      <a href="#/u/${ctx.me.handle}" aria-label="Your profile" id="me-av">${avatar(ctx.me, 32)}</a>
    </header>
    <main id="view"></main>
    <nav class="tabs">${MODES.map(([m, label]) => html`<a href="#/${m}" data-mode="${m}">${icon(m)}<span>${label}</span>${m === "chat" ? html`<i class="badge" id="mb" hidden></i>` : ""}</a>`)}</nav>`.s;
  hydrate(app);
}

/* one click handler for the whole app: [data-act] buttons call ctx.handlers (view) or global handlers */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el || !el.dataset.act) return;
  const f = ctx.handlers[el.dataset.act] || global[el.dataset.act]; if (!f) return;
  e.preventDefault();
  if (el.disabled) return;
  try { el.disabled = true; await f(el, e); } catch (err) { toast(err.message, true); } finally { el.disabled = false; }
});
document.addEventListener("submit", async e => {
  const form = e.target, f = ctx.handlers[form.dataset.form]; if (!f) return;
  e.preventDefault();
  const btn = form.querySelector("button:not([type=button])");
  try { if (btn) btn.disabled = true; await f(form, Object.fromEntries(new FormData(form))); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
});

const setCount = (btn, n, on, cls) => { btn.classList.toggle(cls, on); btn.querySelector("span").textContent = n || ""; };
const global = {
  async like(b) { const r = await api.toggle_like({ id: +b.dataset.id }); setCount(b, r.like_count, r.liked, "on-like"); },
  async repost(b) { const r = await api.repost({ id: +b.dataset.id }); setCount(b, r.repost_count, r.reposted, "on-repost"); toast(r.reposted ? "Reposted" : "Repost removed"); },
  "open-post"(el, e) { if (!e.target.closest("a")) go("#/p/" + el.dataset.id); },
  async "post-menu"(b) {
    const id = +b.dataset.id, mine = !!b.dataset.mine, mod = ctx.me.role === "mod";
    const s = sheet(html`<div class="menu"><a href="#/p/${id}" data-close>Open post</a>
      <button data-x="copy" data-close>Copy link</button>
      ${mine || mod ? html`<button class="danger" data-x="del">Delete${mine ? "" : " (moderator)"}</button>` : ""}
      ${mine ? "" : html`<button data-x="report">Report</button>`}<button data-close>Cancel</button></div>`);
    s.el.addEventListener("click", async e => {
      const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return;
      s.close();
      try {
        if (x === "copy") { await navigator.clipboard.writeText(location.origin + location.pathname + location.search + "#/p/" + id); toast("Link copied"); }
        if (x === "del" && await confirmSheet("Delete this post?")) { await api.delete_post({ id }); toast("Deleted"); route(); }
        if (x === "report") { const r = await ask("Report post", "What's wrong with it?"); if (r) { await api.report({ type: "post", target: String(id), reason: r }); toast("Thanks, a moderator will look at it."); } }
      } catch (err) { toast(err.message, true); }
    });
  },
  compose: b => compose.open(b.dataset.kind || "note"),
};

/* ---------- shared screens ---------- */
async function profile(el, { handle, q }) {
  const d = await api.get_profile({ handle }), p = d.profile, r = d.rel;
  const proView = q.get("as") ? q.get("as") === "work" : ctx.mode === "work";
  const tab = q.get("tab") || (proView ? "work" : "note");
  const conn = { none: "Connect", outgoing: "Requested", incoming: "Accept", connected: "Connected" }[r.connection];
  const head = html`<section class="profile">
    <div class="row">${avatar(p, 76)}<div class="grow"><h2>${p.name}</h2><div class="muted">@${p.handle}${r.followed_by ? html` <span class="chip">Follows you</span>` : ""}</div>
      ${d.pro.headline ? html`<div class="headline">${d.pro.headline}</div>` : ""}</div></div>
    ${p.bio ? html`<p>${rich(p.bio)}</p>` : ""}
    <div class="stats"><a href="#/u/${p.handle}?tab=note"><b>${count(d.counts.posts)}</b> posts</a><span><b>${count(d.counts.followers)}</b> followers</span>
      <span><b>${count(d.counts.following)}</b> following</span><a href="#/u/${p.handle}?tab=work"><b>${count(d.counts.connections)}</b> connections</a></div>
    <div class="row wrap">${r.me ? html`<a class="btn ghost" href="#/settings">Edit profile</a>` : html`
      ${r.blocked ? html`<button class="btn" data-act="unblock">Unblock</button>` : html`
      <button class="btn ${r.following ? "ghost" : ""}" data-act="follow">${r.following ? "Following" : ctx.mode === "video" ? "Subscribe" : "Follow"}</button>
      <button class="btn ghost" data-act="message">Message</button>
      <button class="btn ghost" data-act="connect" ${r.connection === "outgoing" ? "disabled" : ""}>${conn}</button>
      <button class="icon-btn" data-act="pmenu" aria-label="More">${icon("more")}</button>`}`}</div>
    <div class="seg">${[["note", "Posts"], ["photo", "Photos"], ["video", "Videos"], ["work", "Professional"]].map(([k, l]) => html`<a class="${tab === k ? "on" : ""}" href="#/u/${p.handle}?tab=${k}">${l}</a>`)}</div>
  </section>`;
  let body;
  if (tab === "work") body = proSection(d);
  else {
    const posts = await api.list_posts({ kind: tab, scope: "author", author: p.id, before: null });
    body = !posts.length ? empty(r.me ? "Nothing here yet. Tap + to post." : "Nothing here yet.")
      : tab === "photo" ? photos.grid(posts) : tab === "video" ? video.list(posts) : posts.map(x => postCard(x));
  }
  draw(el, html`${head}<div>${body}</div>`);
  const refresh = () => route();
  on({
    follow: async () => { await api[r.following ? "unfollow" : "follow"]({ user: p.id }); refresh(); },
    connect: async () => { if (r.connection === "connected" && !await confirmSheet(`Remove ${p.name} from your connections?`, "Remove")) return;
      await api[r.connection === "connected" ? "disconnect" : "connect"]({ user: p.id }); refresh(); },
    message: async () => { const c = await api.open_dm({ user: p.id }); go("#/chat/" + c.id); },
    unblock: async () => { await api.unblock({ user: p.id }); refresh(); },
    pmenu: () => {
      const s = sheet(html`<div class="menu"><button data-x="block" class="danger">Block @${p.handle}</button><button data-x="report">Report profile</button><button data-close>Cancel</button></div>`);
      s.el.addEventListener("click", async e => {
        const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return; s.close();
        try {
          if (x === "block" && await confirmSheet(`Block @${p.handle}? They won't see your posts or message you.`, "Block")) { await api.block({ user: p.id }); refresh(); }
          if (x === "report") { const why = await ask("Report profile", "What's wrong?"); if (why) { await api.report({ type: "profile", target: p.id, reason: why }); toast("Thanks, a moderator will look at it."); } }
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}

export function proSection(d) {
  const pro = d.pro, me = d.rel.me;
  const range = e => `${fmtMonth(e.start_date)} – ${e.end_date ? fmtMonth(e.end_date) : "Present"}`;
  return html`<section class="card stack">
    ${pro.open_to_work ? html`<div class="chip ok">Open to work</div>` : ""}
    ${pro.headline || pro.location ? html`<div><b>${pro.headline}</b>${pro.location ? html` <span class="muted">· ${pro.location}</span>` : ""}</div>` : ""}
    ${pro.about ? html`<div><h4>About</h4><p>${rich(pro.about)}</p></div>` : ""}
    <div><h4>Experience</h4>${d.experiences.length ? d.experiences.map(e => html`<div class="exp">${icon("building")}<div class="grow"><b>${e.title}</b>
      <div>${e.company_slug ? html`<a href="#/company/${e.company_slug}">${e.company_name}</a>` : e.company_name}</div><div class="muted small">${range(e)}</div>
      ${e.description ? html`<p class="small">${e.description}</p>` : ""}</div>
      ${me ? html`<button class="icon-btn" data-act="del-exp" data-id="${e.id}" aria-label="Remove">${icon("x")}</button>` : ""}</div>`) : html`<p class="muted">No experience added yet.</p>`}</div>
    ${pro.skills.length ? html`<div><h4>Skills</h4><div class="row wrap">${pro.skills.map(s => html`<span class="chip">${s}</span>`)}</div></div>` : ""}
    ${me ? html`<a class="btn ghost" href="#/settings?pro=1">Edit professional profile</a>` : ""}
  </section>`;
}
const fmtMonth = d => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
global["del-exp"] = async b => { if (await confirmSheet("Remove this experience?", "Remove")) { await api.delete_experience({ id: +b.dataset.id }); route(); } };

async function thread(el, { id }) {
  const d = await api.get_post({ id: +id });
  draw(el, html`<div class="bar"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><b>Post</b></div>
    ${d.parent ? html`<div class="parent">${postCard(d.parent)}</div>` : ""}
    ${postCard(d.post, { big: true })}
    <form class="reply-box" data-form="reply">${avatar(ctx.me, 32)}<textarea name="body" rows="1" placeholder="Post your reply" maxlength="2000" required></textarea><button class="btn">Reply</button></form>
    <div>${d.replies.map(r => postCard(r))}</div>`);
  if (d.post.kind === "video") { const v = el.querySelector("video"); if (v) video.track(v, d.post.id); }
  on({ reply: async (f, v) => { await api.create_post({ kind: "note", body: v.body, title: "", media: [], reply_to: d.post.id }); route(); } });
}
global.back = () => (history.length > 1 ? history.back() : go("#/feed"));

const NOTE = {
  follow: n => "followed you", like: n => "liked your post", reply: n => "replied to your post", repost: n => "reposted your post",
  connect_request: n => "wants to connect", connect_accept: n => "accepted your connection request",
  application: n => html`applied to <b>${n.data.title}</b>`, application_status: n => html`updated your application for <b>${n.data.title}</b>: ${n.data.status}`,
};
const noteLink = n => n.post_id ? (n.data.reply_id ? "#/p/" + n.data.reply_id : "#/p/" + n.post_id)
  : n.type.startsWith("application") ? "#/job/" + n.data.job_id : n.type.startsWith("connect") ? "#/network" : "#/u/" + n.actor.handle;
async function notifications(el) {
  const list = await api.notifications();
  draw(el, html`<h2 class="pad">Notifications</h2>${list.length ? list.map(n => html`<a class="note ${n.read ? "" : "unread"}" href="${noteLink(n)}">
    ${avatar(n.actor, 40)}<div class="grow"><b>${n.actor.name}</b> ${(NOTE[n.type] || (() => n.type))(n)}
    ${n.snippet ? html`<div class="muted small clip">${n.snippet}</div>` : ""}</div><span class="muted small">${ago(n.created_at)}</span></a>`) : empty("No notifications yet.")}`);
  if (list.some(n => !n.read)) { await api.mark_notifications_read(); badges(); }
  live(e => { if (e.type === "notification") route(); });
}

async function search(el, { q }) {
  const term = q.get("q") || "";
  const r = term ? await api.search({ q: term }) : null;
  const sec = (title, items, f) => items && items.length ? html`<h4 class="pad">${title}</h4>${items.map(f)}` : "";
  draw(el, html`<form class="pad" data-form="search"><input name="q" type="search" value="${term}" placeholder="Search people, posts, videos, jobs" aria-label="Search" autofocus></form>
    ${r ? (Object.values(r).every(x => !x.length) ? empty(`Nothing found for "${term}".`) : html`
      ${sec("People", r.people, u => html`<a class="person" href="#/u/${u.handle}">${avatar(u, 40)}<div><b>${u.name}</b><div class="muted">@${u.handle}</div></div></a>`)}
      ${sec("Companies", r.companies, c => html`<a class="person" href="#/company/${c.slug}">${icon("building")}<b>${c.name}</b></a>`)}
      ${sec("Jobs", r.jobs, j => work.jobRow(j))}
      ${sec("Videos", r.videos, p => video.row(p))}
      ${sec("Posts", r.posts, p => postCard(p))}`) : empty("Search across every mode.")}`);
  on({ search: (f, v) => go("#/search?q=" + encodeURIComponent(v.q.trim())) });
}

async function settings(el, { q }) {
  const me = ctx.me, d = await api.get_profile({ handle: me.handle }), pro = d.pro;
  draw(el, html`<h2 class="pad">Settings</h2>
    <form class="card stack" data-form="profile"><h3>Profile</h3><p class="muted small">Shown everywhere: Feed, Photos, Chat and Video.</p>
      <div class="row">${avatar(me, 64)}<button type="button" class="btn ghost" data-act="avatar">Change photo</button>
        ${me.avatar_url ? html`<button type="button" class="btn ghost" data-act="no-avatar">Remove</button>` : ""}</div>
      <label>Name<input name="name" value="${me.name}" maxlength="50" required></label>
      <label>Bio<textarea name="bio" maxlength="300" rows="3">${me.bio}</textarea></label>
      <button class="btn">Save profile</button></form>
    <form class="card stack" id="pro" data-form="pro"><h3>Professional profile</h3><p class="muted small">Shown in Work and on the Professional tab of your profile.</p>
      <label>Headline<input name="headline" value="${pro.headline}" maxlength="120" placeholder="e.g. Backend engineer at Acme"></label>
      <label>Location<input name="location" value="${pro.location}" maxlength="80"></label>
      <label>About<textarea name="about" maxlength="2000" rows="4">${pro.about}</textarea></label>
      <label>Skills (comma separated)<input name="skills" value="${pro.skills.join(", ")}"></label>
      <label class="check"><input type="checkbox" name="open_to_work" ${pro.open_to_work ? "checked" : ""}> Open to work</label>
      <button class="btn">Save professional profile</button></form>
    <form class="card stack" data-form="exp"><h3>Add experience</h3>
      <label>Title<input name="title" required maxlength="100"></label><label>Company<input name="company_name" required maxlength="80"></label>
      <div class="row"><label class="grow">Start<input type="date" name="start_date" required></label><label class="grow">End (empty if current)<input type="date" name="end_date"></label></div>
      <label>Description<textarea name="description" rows="2" maxlength="1000"></textarea></label><button class="btn">Add</button></form>
    <div class="card stack">${me.role === "mod" ? html`<a class="btn ghost" href="#/mod">${icon("shield")} Moderation queue</a>` : ""}
      <button class="btn ghost" data-act="signout">${icon("out")} Sign out</button></div>`);
  if (q.get("pro")) $("#pro").scrollIntoView();
  const saveMe = async (patch) => { ctx.me = await api.update_profile({ name: me.name, bio: me.bio, avatar_url: me.avatar_url, ...patch }); shell(); route(); };
  on({
    profile: (f, v) => saveMe({ name: v.name, bio: v.bio }).then(() => toast("Saved")),
    pro: async (f, v) => { await api.update_pro({ headline: v.headline, location: v.location, about: v.about, skills: v.skills.split(","), open_to_work: !!v.open_to_work }); toast("Saved"); },
    exp: async (f, v) => { await api.add_experience({ ...v, end_date: v.end_date || null }); toast("Added"); f.reset(); },
    avatar: async () => { const [file] = await (await import("./media.js")).pick("image/*"); if (!file) return; toast("Uploading…");
      const m = await (await import("./media.js")).photo(file); await saveMe({ avatar_url: m.thumb }); toast("Photo updated"); },
    "no-avatar": () => saveMe({ avatar_url: null }),
    signout: async () => { await api.signOut(); ctx.me = null; location.hash = ""; start(); },
  });
}

async function mod(el) {
  const list = await api.mod_queue();
  draw(el, html`<h2 class="pad">${icon("shield")} Moderation</h2>${list.length ? list.map(r => html`<div class="card stack">
    <div class="muted small">${r.target_type} reported by @${r.reporter.handle} · ${ago(r.created_at)}</div><div><b>Reason:</b> ${r.reason}</div>
    ${r.post ? postCard(r.post) : r.profile ? html`<a class="person" href="#/u/${r.profile.handle}">${avatar(r.profile, 40)}<b>${r.profile.name}</b></a>` : html`<p class="muted">Already gone.</p>`}
    <div class="row end"><button class="btn ghost" data-act="resolve" data-id="${r.id}" data-a="dismiss">Dismiss</button>
      <button class="btn danger" data-act="resolve" data-id="${r.id}" data-a="remove">${r.target_type === "post" ? "Remove post" : "Hide all their posts"}</button></div></div>`)
    : empty("Nothing to review.")}`);
  on({ resolve: async b => { await api.mod_resolve({ id: +b.dataset.id, action: b.dataset.a }); toast("Done"); route(); } });
}

/* ---------- sign in and onboarding ---------- */
function authScreen(mode = "in") {
  app.innerHTML = html`<div class="auth"><h1 class="logo big">${CONFIG.name}</h1>
    <p class="muted">Posts, photos, chat, videos and work. One account.</p>
    ${cloud ? "" : html`<p class="chip warn">Offline test mode: accounts live in this browser. Open a second tab to chat with yourself.</p>`}
    <form class="card stack" id="auth"><h3>${mode === "in" ? "Log in" : "Create your account"}</h3>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="${mode === "in" ? "current-password" : "new-password"}" minlength="8" required></label>
      <button class="btn">${mode === "in" ? "Log in" : "Sign up"}</button>
      <p class="err" role="alert"></p></form>
    <button class="link" id="swap">${mode === "in" ? "New here? Create an account" : "Have an account? Log in"}</button></div>`.s;
  $("#swap").onclick = () => authScreen(mode === "in" ? "up" : "in");
  $("#auth").onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector("button"); b.disabled = true;
    try { await api[mode === "in" ? "signIn" : "signUp"](f.email.value, f.password.value); await start(); }
    catch (err) { f.querySelector(".err").textContent = err.message; } finally { b.disabled = false; }
  };
}
function onboard() {
  app.innerHTML = html`<div class="auth"><h1 class="logo big">${CONFIG.name}</h1><form class="card stack" id="ob"><h3>Pick your handle</h3>
    <p class="muted small">One profile for every mode. You can add your work history later.</p>
    <label>Name<input name="name" required maxlength="50" autofocus></label>
    <label>Handle<input name="handle" required pattern="[A-Za-z0-9_]{3,20}" maxlength="20" placeholder="letters, numbers, _"></label>
    <button class="btn">Continue</button><p class="err" role="alert"></p></form>
    <button class="link" id="out">Use a different account</button></div>`.s;
  $("#out").onclick = async () => { await api.signOut(); authScreen(); };
  $("#ob").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { ctx.me = await api.create_profile({ handle: f.handle.value, name: f.name.value }); start(); } catch (err) { f.querySelector(".err").textContent = err.message; }
  };
}

async function start() {
  try {
    const s = await api.init();
    if (!s) return authScreen();
    ctx.me = ctx.me || await api.me();
    if (!ctx.me) return onboard();
  } catch (e) { app.innerHTML = empty(e.message, html`<button class="btn" onclick="location.reload()">Try again</button>`).s; return; }
  shell(); route();
}
window.addEventListener("hashchange", route);
onLive(e => { if (ctx.me && (e.type === "notification" || e.type === "message")) badges(); });
start();
