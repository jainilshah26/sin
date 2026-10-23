/* Video (YouTube-style): long-form uploads, channels (= profiles, subscribe = follow), comments, watch history, playlists. */
import { api } from "../api.js";
import { html, icon, avatar, ago, rich, empty, sheet, toast, dur, count, plural, postCard, hydrate } from "../ui.js";
import { on, draw, go, route, ctx } from "../main.js";
import { more, moreBtn } from "./feed.js";

export const routes = { video: home, "watch/:id": watch, library, "playlist/:id": playlist };

const thumb = p => html`<a class="vthumb" href="#/watch/${p.id}"><img data-src="${p.media[0].thumb}" alt=""><span class="dur">${dur(p.media[0].duration)}</span></a>`;
const tile = p => html`<div class="vtile">${thumb(p)}<div class="row top">${avatar(p.author, 36)}<div class="grow"><a class="vtitle" href="#/watch/${p.id}">${p.title}</a>
  <a class="muted small" href="#/u/${p.author.handle}">${p.author.name}</a><div class="muted small">${plural(p.view_count, "view")} · ${ago(p.created_at)}</div></div></div></div>`;
export const list = posts => html`<div class="vgrid">${posts.map(tile)}</div>`;
export const row = p => html`<div class="vrow">${thumb(p)}<div class="grow"><a class="vtitle" href="#/watch/${p.id}">${p.title}</a>
  <div class="muted small">${p.author.name}</div><div class="muted small">${plural(p.view_count, "view")} · ${ago(p.created_at)}</div></div></div>`;

async function home(el, { q }) {
  const scope = q.get("s") === "subs" ? "following" : "all";
  const fetch = before => api.list_posts({ kind: "video", scope, author: null, before: before || null });
  const vids = await fetch();
  draw(el, html`<div class="seg"><a class="${scope === "all" ? "on" : ""}" href="#/video">Home</a><a class="${scope === "following" ? "on" : ""}" href="#/video?s=subs">Subscriptions</a>
    <a href="#/library">Library</a></div>
    ${vids.length ? list(vids) : empty(scope === "all" ? "No videos yet. Upload the first one." : "Subscribe to channels to see their videos here.")}
    ${moreBtn(vids)}
    <button class="fab" data-act="compose" data-kind="video" aria-label="Upload a video">${icon("plus")}</button>`);
  on({ more: more(el, fetch, tile) });
}

/* Saves the watch position every 10s and on leave; the first save counts the view. Resumes where you left off. */
export function track(v, id, start = 0) {
  let last = -1;
  const save = () => { const t = Math.floor(v.currentTime || 0); if (t !== last) { last = t; api.record_view({ id, position: t }).catch(() => { }); } };
  v.addEventListener("loadedmetadata", () => { if (start > 5 && start < v.duration - 5) v.currentTime = start; }, { once: true });
  v.addEventListener("play", save, { once: true }); v.addEventListener("pause", save);
  const t = setInterval(() => { if (!v.paused) save(); }, 10000);
  ctx.cleanups.push(() => { clearInterval(t); if (v.currentTime) save(); });
}

async function watch(el, { id }) {
  const [d, hist] = await Promise.all([api.get_post({ id: +id }), api.watch_history()]);
  const p = d.post, m = p.media[0];
  if (p.kind !== "video") return go("#/p/" + p.id);
  const [channel, next] = await Promise.all([api.get_profile({ handle: p.author.handle }), api.list_posts({ kind: "video", scope: "all", author: null, before: null })]);
  const subbed = channel.rel.following, resume = hist.find(h => h.post.id === p.id);
  draw(el, html`<div class="watch"><div class="player"><video controls playsinline autoplay data-src="${m.url}" data-poster="${m.thumb}"></video></div>
    <div class="pad stack"><h2>${p.title}</h2><div class="muted small">${plural(p.view_count, "view")} · ${ago(p.created_at)}</div>
      <div class="row wrap">${avatar(p.author, 40)}<div class="grow"><a href="#/u/${p.author.handle}?tab=video"><b>${p.author.name}</b></a>
        <div class="muted small">${plural(channel.counts.followers, "subscriber")}</div></div>
        ${channel.rel.me ? "" : html`<button class="btn ${subbed ? "ghost" : ""}" data-act="sub">${subbed ? "Subscribed" : "Subscribe"}</button>`}</div>
      <div class="row wrap"><button class="btn ghost ${p.liked ? "on-like" : ""}" data-act="like" data-id="${p.id}">${icon("heart")} <span>${p.like_count || ""}</span></button>
        <button class="btn ghost" data-act="save">${icon("list")} Save</button>
        <button class="icon-btn" data-act="post-menu" data-id="${p.id}" data-mine="${p.mine ? 1 : ""}" aria-label="More">${icon("more")}</button></div>
      ${p.body ? html`<div class="card">${rich(p.body)}</div>` : ""}
      <h4>${plural(p.reply_count, "comment")}</h4>
      <form class="reply-box" data-form="comment">${avatar(ctx.me, 32)}<textarea name="body" rows="1" placeholder="Add a comment" maxlength="2000" required></textarea><button class="btn">Comment</button></form>
      <div>${d.replies.map(r => postCard(r))}</div></div>
    <aside class="next"><h4 class="pad">Up next</h4>${next.filter(x => x.id !== p.id).slice(0, 10).map(row)}</aside></div>`);
  track(el.querySelector("video"), p.id, resume ? resume.position : 0);
  on({
    sub: async () => { await api[subbed ? "unfollow" : "follow"]({ user: p.author.id }); route(); },
    comment: async (f, v) => { await api.create_post({ kind: "note", body: v.body, title: "", media: [], reply_to: p.id }); route(); },
    save: () => saveTo(p.id),
  });
}

async function saveTo(postId) {
  const lists = await api.my_playlists();
  const s = sheet(html`<div class="stack"><h3>Save to playlist</h3>${lists.map(l => html`<button class="person wide" data-pl="${l.id}">${icon("list")}<b class="grow">${l.title}</b><span class="muted">${l.count}</span></button>`)}
    <form class="row" data-new><input name="t" class="grow" placeholder="New playlist" maxlength="80" aria-label="New playlist name"><button class="btn">Create</button></form></div>`);
  const add = async pl => { await api.playlist_add({ playlist: pl, post: postId }); s.close(); toast("Saved"); };
  s.el.onclick = e => { const b = e.target.closest("[data-pl]"); if (b) add(+b.dataset.pl).catch(err => toast(err.message, true)); };
  s.el.querySelector("[data-new]").onsubmit = async e => { e.preventDefault(); try { const l = await api.create_playlist({ title: e.target.t.value }); await add(l.id); } catch (err) { toast(err.message, true); } };
}

async function library(el) {
  const [hist, lists] = await Promise.all([api.watch_history(), api.my_playlists()]);
  draw(el, html`<div class="seg"><a href="#/video">Home</a><a href="#/video?s=subs">Subscriptions</a><a class="on" href="#/library">Library</a></div>
    <div class="row pad"><h3 class="grow">${icon("list")} Playlists</h3><button class="btn small" data-act="new-pl">${icon("plus")} New</button></div>
    ${lists.length ? lists.map(l => html`<a class="person" href="#/playlist/${l.id}">${icon("list")}<b class="grow">${l.title}</b><span class="muted">${plural(l.count, "video")}</span></a>`) : html`<p class="muted pad">No playlists yet. Tap Save under a video.</p>`}
    <div class="row pad"><h3 class="grow">${icon("clock")} History</h3>${hist.length ? html`<button class="btn small ghost" data-act="clear">Clear</button>` : ""}</div>
    ${hist.length ? hist.map(h => html`<div class="hist">${row(h.post)}<div class="progress"><i style="width:${Math.min(100, (100 * h.position) / Math.max(1, h.post.media[0].duration))}%"></i></div></div>`) : html`<p class="muted pad">Videos you watch show up here.</p>`}`);
  on({
    clear: async () => { await api.clear_history(); route(); },
    "new-pl": async () => { const t = await (await import("../ui.js")).ask("New playlist", "Name"); if (t) { await api.create_playlist({ title: t }); route(); } },
  });
}

async function playlist(el, { id }) {
  const l = await api.get_playlist({ id: +id });
  draw(el, html`<div class="bar"><a class="icon-btn" href="#/library" aria-label="Back">${icon("back")}</a><div class="grow"><b>${l.title}</b>
    <div class="muted small">${l.owner.name} · ${plural(l.items.length, "video")}</div></div></div>
    ${l.items.length ? l.items.map(p => html`<div class="row">${row(p)}${l.mine ? html`<button class="icon-btn" data-act="rm" data-id="${p.id}" aria-label="Remove">${icon("x")}</button>` : ""}</div>`) : empty("This playlist is empty.")}`);
  on({ rm: async b => { await api.playlist_remove({ playlist: l.id, post: +b.dataset.id }); route(); } });
}
