/* Feed (Twitter-style): short posts, replies, likes, reposts, follows and the timeline. */
import { api } from "../api.js";
import { html, icon, avatar, postCard, empty, hydrate } from "../ui.js";
import { on, draw, ctx } from "../main.js";

export const routes = { feed: home };

/* "Load more" for any list of posts: fetch(before) returns the next page, card(post) renders one */
export function more(el, fetch, card) {
  return async b => {
    const list = await fetch(+b.dataset.before);
    const box = document.createElement("div"); box.innerHTML = list.map(card).map(h => h.s).join("");
    hydrate(box); b.before(...box.children);
    if (list.length < 20) b.remove(); else b.dataset.before = list.at(-1).id;
  };
}
export const moreBtn = list => (list.length === 20 ? html`<button class="btn ghost wide" data-act="more" data-before="${list.at(-1).id}">Load more</button>` : "");

async function home(el, { q }) {
  const scope = q.get("s") === "all" ? "all" : "following";
  const fetch = before => api.list_posts({ kind: "note", scope, author: null, before: before || null });
  const [list, who] = await Promise.all([fetch(), api.suggestions()]);
  draw(el, html`<div class="seg"><a class="${scope === "following" ? "on" : ""}" href="#/feed">Following</a><a class="${scope === "all" ? "on" : ""}" href="#/feed?s=all">Explore</a></div>
    <button class="composer" data-act="compose" data-kind="note">${avatar(ctx.me, 40)}<span class="muted">What's happening?</span></button>
    ${who.length ? html`<section class="card"><h4>Who to follow</h4><div class="hscroll">${who.map(u => html`<div class="mini-person">
      <a href="#/u/${u.handle}">${avatar(u, 56)}<b class="clip">${u.name}</b><span class="muted small clip">@${u.handle}</span></a>
      <button class="btn small" data-act="follow-s" data-id="${u.id}">Follow</button></div>`)}</div></section>` : ""}
    ${list.length ? list.map(p => postCard(p)) : empty(scope === "following" ? "Your timeline is empty. Follow people or check Explore." : "No posts yet. Be the first!")}
    ${moreBtn(list)}
    <button class="fab" data-act="compose" data-kind="note" aria-label="New post">${icon("plus")}</button>`);
  on({
    more: more(el, fetch, p => postCard(p)),
    "follow-s": async b => { await api.follow({ user: b.dataset.id }); b.textContent = "Following"; b.classList.add("ghost"); },
  });
}
