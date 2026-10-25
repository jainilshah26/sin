/* The database functions of supabase/migrations/0002_functions.sql, in JavaScript, over a plain object.
   Used by ?offline mode (state in localStorage, so tabs of one browser can talk) and by the contract tests,
   which check that every function here answers exactly like its Postgres twin. Keep the two in step. */

const T = ["profiles", "pro_profiles", "companies", "experiences", "follows", "connections", "blocks", "posts", "likes", "stories",
  "watch_history", "playlists", "playlist_items", "conversations", "conversation_members", "messages", "jobs", "applications", "notifications", "reports"];
export const emptyState = () => ({ seq: {}, last: 0, users: [], ...Object.fromEntries(T.map(t => [t, []])) });

const fail = m => { throw new Error(m); };
const like = (s, q) => s.toLowerCase().includes(q.toLowerCase());
const trim = v => (v == null ? "" : String(v)).trim();
const len = s => [...s].length;

export function functions(s, uid) {
  const id = t => (s.seq[t] = (s.seq[t] || 0) + 1);
  const now = () => { const t = Math.max(Date.now(), s.last + 1); s.last = t; return new Date(t).toISOString(); };
  const P = u => s.profiles.find(p => p.id === u);
  const me = () => (uid && P(uid) ? uid : fail("Sign in first."));
  const card = u => { const p = P(u); return p ? { id: p.id, handle: p.handle, name: p.name, avatar_url: p.avatar_url } : null; };
  const blocked = (a, b) => s.blocks.some(x => (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a));
  const following = v => new Set(s.follows.filter(f => f.follower_id === v).map(f => f.followee_id));
  const notify = (user, actor, type, post_id, data = {}) => {
    if (user && user !== actor && !blocked(user, actor)) s.notifications.push({ id: id("notifications"), user_id: user, actor_id: actor, type, post_id, data, read: false, created_at: now() });
  };
  const postById = i => s.posts.find(p => p.id === i);
  const postJson = (p, v, nested = true) => {
    const o = p.repost_of != null && nested ? postById(p.repost_of) : null;
    return {
      id: p.id, kind: p.kind, body: p.body, title: p.title, media: p.media, created_at: p.created_at, author: card(p.author_id), reply_to: p.reply_to,
      repost_of: o && !o.hidden && !blocked(o.author_id, v) ? postJson(o, v, false) : null,
      like_count: p.like_count, reply_count: p.reply_count, repost_count: p.repost_count, view_count: p.view_count,
      liked: s.likes.some(l => l.user_id === v && l.post_id === p.id), reposted: s.posts.some(r => r.author_id === v && r.repost_of === p.id), mine: p.author_id === v,
    };
  };
  const visible = (i, v) => { const p = postById(i); if (!p || p.hidden || blocked(p.author_id, v)) fail("Post not found."); return p; };
  const desc = (a, b) => b.id - a.id, asc = (a, b) => a.id - b.id, byHandle = (a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);
  const meJson = () => { const p = P(uid); return p ? { id: p.id, handle: p.handle, name: p.name, bio: p.bio, avatar_url: p.avatar_url, role: p.role, created_at: p.created_at } : null; };
  const proJson = u => { const p = s.pro_profiles.find(x => x.user_id === u); return p && { headline: p.headline, location: p.location, about: p.about, skills: p.skills, open_to_work: p.open_to_work }; };
  const connState = (v, u) => { const c = s.connections.find(c => (c.requester_id === v && c.addressee_id === u) || (c.requester_id === u && c.addressee_id === v));
    return !c ? "none" : c.status === "accepted" ? "connected" : c.requester_id === v ? "outgoing" : "incoming"; };
  const exists = u => !!P(u);
  const companyJson = c => ({ id: c.id, slug: c.slug, name: c.name, about: c.about, website: c.website, logo_url: c.logo_url });
  const canManage = (j, v) => j.posted_by === v || s.companies.some(c => c.id === j.company_id && c.owner_id === v);
  const jobJson = (j, v) => { const c = s.companies.find(c => c.id === j.company_id);
    return { id: j.id, title: j.title, location: j.location, remote: j.remote, employment_type: j.employment_type, description: j.description, open: j.open, created_at: j.created_at,
      company: { id: c.id, slug: c.slug, name: c.name, logo_url: c.logo_url }, applied: s.applications.some(a => a.job_id === j.id && a.applicant_id === v),
      applicants: s.applications.filter(a => a.job_id === j.id).length, can_manage: canManage(j, v) }; };
  const msgJson = m => ({ id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id, body: m.body, media: m.media, created_at: m.created_at });
  const isMember = (c, v) => s.conversation_members.some(m => m.conversation_id === c && m.user_id === v);
  const others = (c, v) => s.conversation_members.filter(m => m.conversation_id === c && m.user_id !== v).map(m => card(m.user_id)).sort(byHandle);
  const withHeadline = u => ({ ...card(u), headline: proJson(u).headline });
  /* abuse protection, as in SQL: fixed-window rate limits, and media that must be this person's own upload */
  const hit = (action, max, seconds) => {
    const ms = seconds * 1000, key = `${uid}|${action}|${Math.floor(Date.now() / ms) * ms}`;
    s.rate = s.rate || {}; s.rate[key] = (s.rate[key] || 0) + 1;
    if (s.rate[key] > max) fail("You're doing that too fast. Please wait a little and try again.");
    if (Math.random() < 0.01) for (const k in s.rate) if (+k.split("|")[2] < Date.now() - 2 * 864e5) delete s.rate[k];
  };
  const MEDIA_EXT = "(jpg|jpeg|png|webp|gif|mp4|webm|mov|m4v)";
  const mediaOk = (u, v) => typeof u === "string" && (new RegExp(`^https://[a-z0-9]{8,40}\\.supabase\\.co/storage/v1/object/public/media/${v}/[A-Za-z0-9_-]{1,64}\\.${MEDIA_EXT}$`).test(u)
    || new RegExp(`^idb:[A-Za-z0-9_-]{1,64}\\.${MEDIA_EXT}$`).test(u));   // offline mode keeps files in this browser
  const num = (x, hi) => (typeof x === "number" ? Math.round(Math.min(Math.max(x, 0), hi)) : undefined);
  const cleanMedia = (m, v, max) => {
    if (m == null) return [];
    if (!Array.isArray(m) || m.length > max) fail(`Up to ${max} photos or videos.`);
    return m.map(e => {
      if (!e || typeof e !== "object" || Array.isArray(e) || !["image", "video"].includes(e.type) || !mediaOk(e.url, v) || (e.thumb != null && !mediaOk(e.thumb, v)))
        fail("That photo or video can't be used. Please upload it again.");
      const o = { type: e.type, url: e.url, thumb: e.thumb ?? undefined, w: num(e.w, 10000), h: num(e.h, 10000), duration: num(e.duration, 86400) };
      for (const k in o) if (o[k] === undefined) delete o[k];
      return o;
    });
  };
  const requireMod = () => { const v = me(); if (P(v).role !== "mod") fail("Moderators only."); return v; };
  const dateOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  return {
    /* accounts and profiles */
    me: () => meJson(),
    create_profile({ handle, name }) {
      if (!uid) fail("Sign in first.");
      if (P(uid)) fail("You already have a profile.");
      const h = trim(handle).toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(h)) fail("Handles are 3-20 letters, numbers or _.");
      if (len(trim(name)) < 1 || len(trim(name)) > 50) fail("Enter your name.");
      if (s.profiles.some(p => p.handle === h)) fail("That handle is taken.");
      s.profiles.push({ id: uid, handle: h, name: trim(name), bio: "", avatar_url: null, role: s.profiles.length ? "user" : "mod", created_at: now() });
      s.pro_profiles.push({ user_id: uid, headline: "", location: "", about: "", skills: [], open_to_work: false });
      return meJson();
    },
    update_profile({ name, bio, avatar_url }) {
      const p = P(me());
      if (len(trim(name)) < 1 || len(trim(name)) > 50) fail("Enter your name.");
      if (len(bio || "") > 300) fail("Keep your bio under 300 characters.");
      if (avatar_url && !mediaOk(avatar_url, p.id)) fail("That photo can't be used. Please upload it again.");
      hit("profile", 30, 3600);
      Object.assign(p, { name: trim(name), bio: bio || "", avatar_url: avatar_url || null });
      return meJson();
    },
    get_profile({ handle }) {
      const v = me(), p = s.profiles.find(p => p.handle === String(handle).toLowerCase());
      if (!p || s.blocks.some(b => b.blocker_id === p.id && b.blocked_id === v)) fail("Profile not found.");
      const exp = s.experiences.filter(e => e.user_id === p.id).sort((a, b) => (a.end_date == null) !== (b.end_date == null) ? (a.end_date == null ? -1 : 1)
        : dateOrder(b.end_date || "", a.end_date || "") || dateOrder(b.start_date, a.start_date) || b.id - a.id);
      return {
        profile: { id: p.id, handle: p.handle, name: p.name, bio: p.bio, avatar_url: p.avatar_url, created_at: p.created_at },
        pro: proJson(p.id),
        experiences: exp.map(e => ({ id: e.id, title: e.title, company_name: e.company_name, company_slug: s.companies.find(c => c.id === e.company_id)?.slug ?? null,
          start_date: e.start_date, end_date: e.end_date, description: e.description })),
        counts: { followers: s.follows.filter(f => f.followee_id === p.id).length, following: s.follows.filter(f => f.follower_id === p.id).length,
          posts: s.posts.filter(x => x.author_id === p.id && x.reply_to == null && x.repost_of == null && !x.hidden).length,
          connections: s.connections.filter(c => c.status === "accepted" && (c.requester_id === p.id || c.addressee_id === p.id)).length },
        rel: { me: p.id === v, following: s.follows.some(f => f.follower_id === v && f.followee_id === p.id), followed_by: s.follows.some(f => f.follower_id === p.id && f.followee_id === v),
          connection: connState(v, p.id), blocked: s.blocks.some(b => b.blocker_id === v && b.blocked_id === p.id) },
      };
    },
    update_pro({ headline, location, about, skills, open_to_work }) {
      const v = me(), seen = new Set(), sk = [];
      for (const x of skills || []) { const t = trim(x); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); sk.push(t); } }
      if (sk.length > 30) fail("Up to 30 skills.");
      if (sk.some(x => len(x) > 40)) fail("Keep each skill under 40 characters.");
      hit("profile", 30, 3600);
      Object.assign(s.pro_profiles.find(x => x.user_id === v), { headline: trim(headline), location: trim(location), about: about || "", skills: sk, open_to_work: !!open_to_work });
      return proJson(v);
    },
    add_experience({ title, company_name, start_date, end_date, description }) {
      const v = me();
      if (!trim(title) || !trim(company_name) || !start_date) fail("Add a title, a company and a start date.");
      if (end_date && end_date < start_date) fail("The end date is before the start date.");
      hit("profile", 30, 3600);
      const c = s.companies.find(c => c.name.toLowerCase() === trim(company_name).toLowerCase());
      const e = { id: id("experiences"), user_id: v, title: trim(title), company_name: trim(company_name), company_id: c ? c.id : null, start_date, end_date: end_date || null, description: description || "" };
      s.experiences.push(e);
      return { id: e.id };
    },
    delete_experience({ id: i }) { const v = me(); s.experiences = s.experiences.filter(e => !(e.id === i && e.user_id === v)); return { ok: true }; },

    /* social graph */
    follow({ user }) {
      const v = me();
      if (user === v) fail("You can't follow yourself.");
      if (!exists(user) || blocked(v, user)) fail("Profile not found.");
      hit("follow", 60, 3600);
      if (!s.follows.some(f => f.follower_id === v && f.followee_id === user)) { s.follows.push({ follower_id: v, followee_id: user, created_at: now() }); notify(user, v, "follow", null); }
      return { following: true };
    },
    unfollow({ user }) { const v = me(); s.follows = s.follows.filter(f => !(f.follower_id === v && f.followee_id === user)); return { following: false }; },
    connect({ user }) {
      const v = me();
      if (user === v) fail("You can't connect with yourself.");
      if (!exists(user) || blocked(v, user)) fail("Profile not found.");
      const st = connState(v, user);
      if (st === "none") hit("connect", 40, 86400);
      if (st === "incoming") { s.connections.find(c => c.requester_id === user && c.addressee_id === v).status = "accepted"; notify(user, v, "connect_accept", null); }
      else if (st === "none") { s.connections.push({ requester_id: v, addressee_id: user, status: "pending", created_at: now() }); notify(user, v, "connect_request", null); }
      return { connection: connState(v, user) };
    },
    disconnect({ user }) {
      const v = me(); s.connections = s.connections.filter(c => !((c.requester_id === v && c.addressee_id === user) || (c.requester_id === user && c.addressee_id === v)));
      return { connection: "none" };
    },
    my_network() {
      const v = me(), g = { connected: [], incoming: [], outgoing: [] };
      for (const c of s.connections) if (c.requester_id === v || c.addressee_id === v) {
        const o = c.requester_id === v ? c.addressee_id : c.requester_id;
        g[c.status === "accepted" ? "connected" : c.requester_id === v ? "outgoing" : "incoming"].push(withHeadline(o));
      }
      for (const k in g) g[k].sort(byHandle);
      return g;
    },
    suggestions() {
      const v = me(), f = following(v);
      return s.profiles.filter(p => p.id !== v && !blocked(p.id, v) && !f.has(p.id))
        .sort((a, b) => dateOrder(b.created_at, a.created_at) || byHandle(a, b)).slice(0, 8).map(p => card(p.id));
    },
    block({ user }) {
      const v = me();
      if (user === v) fail("You can't block yourself.");
      if (!s.blocks.some(b => b.blocker_id === v && b.blocked_id === user)) s.blocks.push({ blocker_id: v, blocked_id: user });
      const pair = (a, b) => (a === v && b === user) || (a === user && b === v);
      s.follows = s.follows.filter(f => !pair(f.follower_id, f.followee_id));
      s.connections = s.connections.filter(c => !pair(c.requester_id, c.addressee_id));
      return { blocked: true };
    },
    unblock({ user }) { const v = me(); s.blocks = s.blocks.filter(b => !(b.blocker_id === v && b.blocked_id === user)); return { blocked: false }; },

    /* posts */
    create_post({ kind, body, title, media, reply_to }) {
      const v = me(), b = trim(body), t = trim(title);
      let m = media || [];
      if (!Array.isArray(m) || m.length > 10) fail("Up to 10 photos or videos per post.");
      m = cleanMedia(m, v, 10);
      if ((b.match(/https?:\/\//gi) || []).length > 5) fail("Too many links in one post.");
      const recent = new Date(Date.now() - 600e3).toISOString();
      if (b && s.posts.some(x => x.author_id === v && x.body === b && x.repost_of == null && x.created_at > recent)) fail("You just posted that.");
      hit("post", 10, 60); hit("post_day", 400, 86400);
      let parent = null;
      if (reply_to != null) { parent = visible(reply_to, v); if (kind !== "note") fail("Replies are text posts."); }
      if (kind === "note" && !b && !m.length) fail("Write something first.");
      else if (kind === "photo" && (!m.length || m.some(e => e.type !== "image"))) fail("Add at least one photo.");
      else if (kind === "video" && (m.length !== 1 || m[0].type !== "video")) fail("Add one video.");
      else if (kind === "video" && !t) fail("Give your video a title.");
      else if (!["note", "photo", "video"].includes(kind)) fail("Unknown post type.");
      const p = { id: id("posts"), author_id: v, kind, body: b, title: t, media: m, reply_to: reply_to ?? null, repost_of: null,
        like_count: 0, reply_count: 0, repost_count: 0, view_count: 0, hidden: false, created_at: now() };
      s.posts.push(p);
      if (parent) { parent.reply_count++; notify(parent.author_id, v, "reply", parent.id, { reply_id: p.id }); }
      return postJson(p, v);
    },
    delete_post({ id: i }) {
      const v = me(), p = postById(i);
      if (!p) fail("Post not found.");
      if (p.author_id !== v && P(v).role !== "mod") fail("You can only delete your own posts.");
      if (p.reply_to != null) { const q = postById(p.reply_to); if (q) q.reply_count = Math.max(q.reply_count - 1, 0); }
      if (p.repost_of != null) { const q = postById(p.repost_of); if (q) q.repost_count = Math.max(q.repost_count - 1, 0); }
      const gone = new Set([p.id]); // on delete cascade: replies and reposts of a deleted post go too
      for (let grew = true; grew;) { grew = false; for (const x of s.posts) if (!gone.has(x.id) && (gone.has(x.reply_to) || gone.has(x.repost_of))) { gone.add(x.id); grew = true; } }
      const keep = r => !gone.has(r.post_id);
      s.posts = s.posts.filter(x => !gone.has(x.id)); s.likes = s.likes.filter(keep); s.watch_history = s.watch_history.filter(keep);
      s.playlist_items = s.playlist_items.filter(keep); s.notifications = s.notifications.filter(n => !gone.has(n.post_id));
      return { ok: true };
    },
    toggle_like({ id: i }) {
      const v = me(), p = visible(i, v), n = s.likes.length;
      hit("like", 120, 60);
      s.likes = s.likes.filter(l => !(l.user_id === v && l.post_id === p.id));
      if (s.likes.length < n) { p.like_count = Math.max(p.like_count - 1, 0); return { liked: false, like_count: p.like_count }; }
      s.likes.push({ user_id: v, post_id: p.id, created_at: now() }); p.like_count++;
      notify(p.author_id, v, "like", p.id);
      return { liked: true, like_count: p.like_count };
    },
    repost({ id: i }) {
      const v = me(); let p = visible(i, v);
      if (p.repost_of != null) p = visible(p.repost_of, v);
      hit("repost", 60, 3600);
      const mine = s.posts.find(r => r.author_id === v && r.repost_of === p.id);
      if (mine) { this.delete_post({ id: mine.id }); return { reposted: false, repost_count: p.repost_count }; }
      s.posts.push({ id: id("posts"), author_id: v, kind: "note", body: "", title: "", media: [], reply_to: null, repost_of: p.id,
        like_count: 0, reply_count: 0, repost_count: 0, view_count: 0, hidden: false, created_at: now() });
      p.repost_count++; notify(p.author_id, v, "repost", p.id);
      return { reposted: true, repost_count: p.repost_count };
    },
    list_posts({ kind, scope, author, before }) {
      const v = me(), f = following(v);
      return s.posts.filter(p => p.kind === kind && p.reply_to == null && !p.hidden && (before == null || p.id < before) && !blocked(p.author_id, v)
        && (kind === "note" || p.repost_of == null)
        && (scope === "following" ? p.author_id === v || f.has(p.author_id) : scope === "author" ? p.author_id === author : true))
        .sort(desc).slice(0, 20).map(p => postJson(p, v));
    },
    get_post({ id: i }) {
      const v = me(), p = visible(i, v), par = p.reply_to != null ? postById(p.reply_to) : null;
      return { post: postJson(p, v), parent: par && !par.hidden && !blocked(par.author_id, v) ? postJson(par, v) : null,
        replies: s.posts.filter(r => r.reply_to === p.id && !r.hidden && !blocked(r.author_id, v)).sort(asc).slice(0, 200).map(r => postJson(r, v)) };
    },

    /* stories */
    create_story({ media }) {
      const v = me();
      if (!media || typeof media !== "object" || Array.isArray(media) || !media.url) fail("Add a photo or video.");
      hit("story", 50, 86400);
      const t = now(), st = { id: id("stories"), author_id: v, media: cleanMedia([media], v, 1)[0], created_at: t, expires_at: new Date(Date.parse(t) + 864e5).toISOString() };
      s.stories.push(st);
      return { id: st.id };
    },
    stories() {
      const v = me(), f = following(v), nowIso = new Date().toISOString(), g = new Map();
      for (const st of s.stories.filter(x => x.expires_at > nowIso && !blocked(x.author_id, v) && (x.author_id === v || f.has(x.author_id))).sort(asc)) {
        if (!g.has(st.author_id)) g.set(st.author_id, []); g.get(st.author_id).push(st);
      }
      return [...g].sort(([a, x], [b, y]) => (b === v) - (a === v) || y.at(-1).id - x.at(-1).id)
        .map(([a, items]) => ({ author: card(a), items: items.map(x => ({ id: x.id, media: x.media, created_at: x.created_at })) }));
    },

    /* video */
    record_view({ id: i, position }) {
      const v = me(), p = visible(i, v), pos = Math.max(position || 0, 0);
      if (p.kind !== "video") fail("Only videos have a watch history.");
      hit("view", 120, 60);
      const h = s.watch_history.find(h => h.user_id === v && h.post_id === p.id);
      if (h) Object.assign(h, { position: pos, watched_at: now() });
      else { s.watch_history.push({ user_id: v, post_id: p.id, position: pos, watched_at: now() }); p.view_count++; }
      return { ok: true };
    },
    watch_history() {
      const v = me();
      return s.watch_history.filter(h => h.user_id === v).sort((a, b) => dateOrder(b.watched_at, a.watched_at)).slice(0, 50)
        .map(h => [h, postById(h.post_id)]).filter(([, p]) => p && !p.hidden && !blocked(p.author_id, v))
        .map(([h, p]) => ({ post: postJson(p, v), position: h.position, watched_at: h.watched_at }));
    },
    clear_history() { const v = me(); s.watch_history = s.watch_history.filter(h => h.user_id !== v); return { ok: true }; },
    my_playlists() {
      const v = me();
      return s.playlists.filter(l => l.owner_id === v).sort(desc).map(l => ({ id: l.id, title: l.title, count: s.playlist_items.filter(i => i.playlist_id === l.id).length }));
    },
    create_playlist({ title }) {
      const v = me(), t = trim(title);
      if (len(t) < 1 || len(t) > 80) fail("Name the playlist.");
      hit("playlist", 30, 86400);
      const l = { id: id("playlists"), owner_id: v, title: t, created_at: now() }; s.playlists.push(l);
      return { id: l.id, title: t, count: 0 };
    },
    playlist_add({ playlist, post }) {
      const v = me(), p = visible(post, v);
      if (!s.playlists.some(l => l.id === playlist && l.owner_id === v)) fail("Playlist not found.");
      if (p.kind !== "video") fail("Only videos go in playlists.");
      if (!s.playlist_items.some(i => i.playlist_id === playlist && i.post_id === p.id)) s.playlist_items.push({ playlist_id: playlist, post_id: p.id, added_at: now() });
      return { ok: true };
    },
    playlist_remove({ playlist, post }) {
      const v = me();
      if (s.playlists.some(l => l.id === playlist && l.owner_id === v)) s.playlist_items = s.playlist_items.filter(i => !(i.playlist_id === playlist && i.post_id === post));
      return { ok: true };
    },
    get_playlist({ id: i }) {
      const v = me(), l = s.playlists.find(l => l.id === i);
      if (!l || blocked(l.owner_id, v)) fail("Playlist not found.");
      return { id: l.id, title: l.title, owner: card(l.owner_id), mine: l.owner_id === v,
        items: s.playlist_items.filter(x => x.playlist_id === l.id).sort((a, b) => dateOrder(a.added_at, b.added_at) || a.post_id - b.post_id)
          .map(x => postById(x.post_id)).filter(p => p && !p.hidden && !blocked(p.author_id, v)).map(p => postJson(p, v)) };
    },

    /* chat */
    conversations() {
      const v = me();
      return s.conversation_members.filter(m => m.user_id === v).map(m => [m, s.conversations.find(c => c.id === m.conversation_id)])
        .sort(([, a], [, b]) => b.last_message_id - a.last_message_id || b.id - a.id)
        .map(([m, c]) => { const x = s.messages.find(x => x.id === c.last_message_id);
          return { id: c.id, is_group: c.is_group, title: c.title, members: others(c.id, v),
            last: x ? { id: x.id, body: x.body, sender_id: x.sender_id, created_at: x.created_at, has_media: x.media.length > 0 } : null,
            unread: s.messages.filter(x => x.conversation_id === c.id && x.id > m.last_read_id && x.sender_id !== v).length }; });
    },
    open_dm({ user }) {
      const v = me();
      if (user === v) fail("Pick someone else to message.");
      if (!exists(user) || blocked(v, user)) fail("Profile not found.");
      let c = s.conversations.find(c => !c.is_group && isMember(c.id, v) && isMember(c.id, user));
      if (!c) {
        hit("new_chat", 30, 3600);
        c = { id: id("conversations"), is_group: false, title: "", created_by: v, created_at: now(), last_message_id: 0 }; s.conversations.push(c);
        for (const u of [v, user]) s.conversation_members.push({ conversation_id: c.id, user_id: u, last_read_id: 0, joined_at: c.created_at });
      }
      return { id: c.id };
    },
    create_group({ title, members }) {
      const v = me(), t = trim(title);
      if (len(t) < 1 || len(t) > 80) fail("Name the group.");
      const o = [...new Set(members || [])].filter(u => exists(u) && u !== v && !blocked(u, v));
      if (!o.length) fail("Add at least one person.");
      if (o.length > 255) fail("Groups can have up to 256 people.");
      hit("new_chat", 30, 3600);
      const c = { id: id("conversations"), is_group: true, title: t, created_by: v, created_at: now(), last_message_id: 0 }; s.conversations.push(c);
      for (const u of [...o, v]) s.conversation_members.push({ conversation_id: c.id, user_id: u, last_read_id: 0, joined_at: c.created_at });
      return { id: c.id };
    },
    get_messages({ conv, before }) {
      const v = me(), c = s.conversations.find(c => c.id === conv);
      if (!c || !isMember(conv, v)) fail("Chat not found.");
      return { conversation: { id: c.id, is_group: c.is_group, title: c.title, members: others(c.id, v) },
        messages: s.messages.filter(m => m.conversation_id === c.id && (before == null || m.id < before)).sort(desc).slice(0, 50).sort(asc).map(msgJson),
        reads: Object.fromEntries(s.conversation_members.filter(m => m.conversation_id === c.id).map(m => [m.user_id, m.last_read_id])) };
    },
    send_message({ conv, body, media }) {
      const v = me(), b = trim(body);
      let md = media || [];
      if (!isMember(conv, v)) fail("Chat not found.");
      const c = s.conversations.find(c => c.id === conv);
      if (!c.is_group && s.conversation_members.some(m => m.conversation_id === conv && m.user_id !== v && blocked(v, m.user_id))) fail("You can't message this person.");
      if (!Array.isArray(md) || md.length > 10) fail("Up to 10 attachments.");
      md = cleanMedia(md, v, 10);
      if (!b && !md.length) fail("Write a message first.");
      hit("message", 30, 60); hit("message_day", 2000, 86400);
      const m = { id: id("messages"), conversation_id: conv, sender_id: v, body: b, media: md, created_at: now() };
      s.messages.push(m); c.last_message_id = m.id;
      s.conversation_members.find(x => x.conversation_id === conv && x.user_id === v).last_read_id = m.id;
      return msgJson(m);
    },
    mark_read({ conv }) {
      const v = me(), c = s.conversations.find(c => c.id === conv), m = s.conversation_members.find(x => x.conversation_id === conv && x.user_id === v);
      if (c && m && m.last_read_id < c.last_message_id) m.last_read_id = c.last_message_id;
      return { last_read_id: c ? c.last_message_id : 0 };
    },

    /* work */
    companies() { me(); return [...s.companies].sort((a, b) => dateOrder(a.name.toLowerCase(), b.name.toLowerCase())).map(companyJson); },
    my_companies() { const v = me(); return s.companies.filter(c => c.owner_id === v).sort((a, b) => dateOrder(a.name.toLowerCase(), b.name.toLowerCase())).map(companyJson); },
    create_company({ name, slug, about, website, logo_url }) {
      const v = me(), sl = trim(slug).toLowerCase(), n = trim(name);
      if (len(n) < 1 || len(n) > 80) fail("Name the company.");
      if (!/^[a-z0-9-]{2,40}$/.test(sl)) fail("The page address is 2-40 letters, numbers or -.");
      if (s.companies.some(c => c.slug === sl || c.name.toLowerCase() === n.toLowerCase())) fail("That company already has a page.");
      if (logo_url && !mediaOk(logo_url, v)) fail("That logo can't be used. Please upload it again.");
      if (trim(website) && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(trim(website))) fail("Enter a valid website.");
      hit("company", 3, 86400);
      const c = { id: id("companies"), slug: sl, name: n, about: about || "", website: trim(website), logo_url: logo_url || null, owner_id: v, created_at: now() };
      s.companies.push(c);
      for (const e of s.experiences) if (e.company_id == null && e.company_name.toLowerCase() === n.toLowerCase()) e.company_id = c.id;
      return companyJson(c);
    },
    get_company({ slug }) {
      const v = me(), c = s.companies.find(c => c.slug === String(slug).toLowerCase());
      if (!c) fail("Company not found.");
      const best = new Map();
      for (const e of s.experiences.filter(e => e.company_id === c.id && !blocked(e.user_id, v))) {
        const b = best.get(e.user_id), better = !b || ((e.end_date == null) !== (b.end_date == null) ? e.end_date == null : e.start_date > b.start_date);
        if (better) best.set(e.user_id, e);
      }
      return { company: companyJson(c), owner: c.owner_id === v,
        jobs: s.jobs.filter(j => j.company_id === c.id).sort((a, b) => b.open - a.open || b.id - a.id).map(j => jobJson(j, v)),
        people: [...best.values()].map(e => ({ ...card(e.user_id), title: e.title, current: e.end_date == null }))
          .sort((a, b) => b.current - a.current || byHandle(a, b)) };
    },
    create_job({ company, title, location, remote, type, description }) {
      const v = me();
      if (!s.companies.some(c => c.id === company && c.owner_id === v)) fail("Only the company page owner can post jobs.");
      const t = trim(title);
      if (len(t) < 1 || len(t) > 100) fail("Give the job a title.");
      if (!["full_time", "part_time", "contract", "internship"].includes(type)) fail("Pick a job type.");
      hit("job", 20, 86400);
      const j = { id: id("jobs"), company_id: company, posted_by: v, title: t, location: trim(location), remote: !!remote, employment_type: type, description: description || "", open: true, created_at: now() };
      s.jobs.push(j);
      return jobJson(j, v);
    },
    list_jobs({ q, before }) {
      const v = me(), t = trim(q);
      return s.jobs.filter(j => j.open && (before == null || j.id < before)
        && (!t || like(j.title, t) || like(s.companies.find(c => c.id === j.company_id).name, t) || like(j.location, t))).sort(desc).slice(0, 20).map(j => jobJson(j, v));
    },
    get_job({ id: i }) {
      const v = me(), j = s.jobs.find(j => j.id === i);
      if (!j) fail("Job not found.");
      return { job: jobJson(j, v), applications: canManage(j, v)
        ? s.applications.filter(a => a.job_id === j.id).sort(asc).map(a => ({ id: a.id, applicant: withHeadline(a.applicant_id), note: a.note, status: a.status, created_at: a.created_at }))
        : null };
    },
    apply_job({ job, note }) {
      const v = me(), j = s.jobs.find(j => j.id === job);
      if (!j || !j.open) fail("This job is closed.");
      if (canManage(j, v)) fail("You manage this job.");
      if (s.applications.some(a => a.job_id === j.id && a.applicant_id === v)) fail("You already applied.");
      hit("apply", 50, 86400);
      s.applications.push({ id: id("applications"), job_id: j.id, applicant_id: v, note: note || "", status: "submitted", created_at: now() });
      notify(j.posted_by, v, "application", null, { job_id: j.id, title: j.title });
      return { applied: true };
    },
    my_applications() {
      const v = me();
      return s.applications.filter(a => a.applicant_id === v).sort(desc).map(a => ({ id: a.id, status: a.status, created_at: a.created_at, job: jobJson(s.jobs.find(j => j.id === a.job_id), v) }));
    },
    set_application_status({ id: i, status }) {
      const v = me(), a = s.applications.find(a => a.id === i), j = a && s.jobs.find(j => j.id === a.job_id);
      if (!a || !canManage(j, v)) fail("Application not found.");
      if (!["submitted", "reviewing", "rejected", "offer"].includes(status)) fail("Unknown status.");
      a.status = status; notify(a.applicant_id, v, "application_status", null, { job_id: j.id, title: j.title, status });
      return { status };
    },
    close_job({ id: i }) {
      const v = me(), j = s.jobs.find(j => j.id === i);
      if (!j || !canManage(j, v)) fail("Job not found.");
      j.open = false;
      return { open: false };
    },

    /* shared */
    notifications() {
      const v = me();
      return s.notifications.filter(n => n.user_id === v).sort(desc).slice(0, 50).filter(n => !blocked(n.actor_id, v)).map(n => {
        const p = n.post_id != null ? postById(n.post_id) : null;
        return { id: n.id, type: n.type, read: n.read, created_at: n.created_at, actor: card(n.actor_id), post_id: n.post_id, data: n.data,
          snippet: p ? [...(p.title || p.body)].slice(0, 80).join("") : null };
      });
    },
    mark_notifications_read() { const v = me(); for (const n of s.notifications) if (n.user_id === v) n.read = true; return { ok: true }; },
    badges() {
      const v = me();
      return { notifications: s.notifications.filter(n => n.user_id === v && !n.read && !blocked(n.actor_id, v)).length,
        messages: s.conversation_members.filter(m => m.user_id === v).reduce((t, m) => t + s.messages.filter(x => x.conversation_id === m.conversation_id && x.id > m.last_read_id && x.sender_id !== v).length, 0) };
    },
    search({ q }) {
      const v = me(), t = [...trim(q)].slice(0, 100).join("");
      if (!t) return { people: [], posts: [], videos: [], jobs: [], companies: [] };
      const ok = p => !p.hidden && !blocked(p.author_id, v);
      return {
        people: s.profiles.filter(p => (like(p.handle, t) || like(p.name, t)) && !blocked(p.id, v)).sort(byHandle).slice(0, 10).map(p => card(p.id)),
        posts: s.posts.filter(p => ["note", "photo"].includes(p.kind) && p.reply_to == null && p.repost_of == null && ok(p) && like(p.body, t)).sort(desc).slice(0, 10).map(p => postJson(p, v)),
        videos: s.posts.filter(p => p.kind === "video" && ok(p) && (like(p.title, t) || like(p.body, t))).sort(desc).slice(0, 10).map(p => postJson(p, v)),
        jobs: s.jobs.filter(j => j.open && (like(j.title, t) || like(s.companies.find(c => c.id === j.company_id).name, t))).sort(desc).slice(0, 10).map(j => jobJson(j, v)),
        companies: s.companies.filter(c => like(c.name, t)).sort((a, b) => dateOrder(a.name.toLowerCase(), b.name.toLowerCase())).slice(0, 10).map(companyJson),
      };
    },
    report({ type, target, reason }) {
      const v = me();
      if (!["post", "profile"].includes(type)) fail("You can report a post or a profile.");
      const r = trim(reason); if (len(r) < 1 || len(r) > 500) fail("Say what's wrong.");
      if (len(String(target ?? "")) > 64) fail("Report not found.");
      hit("report", 20, 3600);
      s.reports.push({ id: id("reports"), reporter_id: v, target_type: type, target_id: String(target), reason: r, status: "open", created_at: now() });
      return { ok: true };
    },
    mod_queue() {
      const v = requireMod();
      return s.reports.filter(r => r.status === "open").sort(desc).map(r => {
        const p = r.target_type === "post" ? s.posts.find(p => String(p.id) === r.target_id) : null;
        return { id: r.id, target_type: r.target_type, target_id: r.target_id, reason: r.reason, created_at: r.created_at, reporter: card(r.reporter_id),
          post: p ? postJson(p, v) : null, profile: r.target_type === "profile" ? card(r.target_id) : null };
      });
    },
    mod_resolve({ id: i, action }) {
      requireMod();
      const r = s.reports.find(r => r.id === i);
      if (!r) fail("Report not found.");
      if (!["dismiss", "remove"].includes(action)) fail("Dismiss or remove.");
      if (action === "remove") for (const p of s.posts) if ((r.target_type === "post" ? String(p.id) : p.author_id) === r.target_id) p.hidden = true;
      for (const x of s.reports) if (x.status === "open" && x.target_type === r.target_type && x.target_id === r.target_id) x.status = action === "remove" ? "removed" : "dismissed";
      return { ok: true };
    },
  };
}

/* Runs one function as one user against a state object. Results are deep-copied so callers never hold live rows. */
export function call(state, uid, name, args = {}) {
  const f = functions(state, uid);
  if (!f[name]) throw new Error("Unknown function " + name);
  return JSON.parse(JSON.stringify(f[name](args) ?? null));
}
