/* Photos (Instagram-style): photo posts, stories, profile grid, comments. */
import { api } from "../api.js";
import { html, icon, avatar, who, ago, rich, empty, sheet, hydrate, actions, media } from "../ui.js";
import { on, draw, ctx } from "../main.js";
import { more, moreBtn } from "./feed.js";

export const routes = { photos: home };

/* square grid for profiles; tapping opens the post */
export const grid = posts => html`<div class="grid">${posts.map(p => html`<a href="#/p/${p.id}"><img data-src="${p.media[0].thumb || p.media[0].url}" alt="">${p.media.length > 1 ? html`<i class="multi">${icon("image")}</i>` : ""}</a>`)}</div>`;

/* full-width photo post with a swipeable carousel */
const photoCard = p => html`<article class="photo-post" data-post="${p.id}">
  <div class="post-head pad">${avatar(p.author, 36)}<div class="grow">${who(p.author)}</div><span class="muted small">${ago(p.created_at)}</span>
    <button class="icon-btn" data-act="post-menu" data-id="${p.id}" data-mine="${p.mine ? 1 : ""}" aria-label="More">${icon("more")}</button></div>
  <div class="carousel">${p.media.map(m => media(m))}</div>
  ${p.media.length > 1 ? html`<div class="dots">${p.media.map((_, i) => html`<i class="${i ? "" : "on"}"></i>`)}</div>` : ""}
  ${actions(p)}
  ${p.body ? html`<p class="pad"><a href="#/u/${p.author.handle}"><b>${p.author.handle}</b></a> ${rich(p.body)}</p>` : ""}
  ${p.reply_count ? html`<a class="pad muted small" href="#/p/${p.id}">View all ${p.reply_count} comments</a>` : ""}
</article>`;

async function home(el, { q }) {
  const scope = q.get("s") === "all" ? "all" : "following";
  const fetch = before => api.list_posts({ kind: "photo", scope, author: null, before: before || null });
  const [list, stories] = await Promise.all([fetch(), api.stories()]);
  const mine = stories.find(s => s.author.id === ctx.me.id);
  draw(el, html`<div class="stories">
      <button class="story" data-act="${mine ? "view-story" : "compose"}" data-kind="story" data-i="0">${avatar(ctx.me, 60)}<span class="small">Your story</span>${mine ? "" : html`<i class="add">+</i>`}</button>
      ${stories.map((s, i) => s.author.id === ctx.me.id ? "" : html`<button class="story ring" data-act="view-story" data-i="${i}">${avatar(s.author, 60)}<span class="small clip">${s.author.handle}</span></button>`)}
    </div>
    <div class="seg"><a class="${scope === "following" ? "on" : ""}" href="#/photos">Following</a><a class="${scope === "all" ? "on" : ""}" href="#/photos?s=all">Explore</a></div>
    ${list.length ? list.map(photoCard) : empty("No photos yet. Share one, or follow people on Explore.")}${moreBtn(list)}
    <button class="fab" data-act="compose" data-kind="photo" aria-label="New photo post">${icon("plus")}</button>`);
  for (const c of el.querySelectorAll(".carousel")) c.onscroll = () => {
    const i = Math.round(c.scrollLeft / c.clientWidth); c.nextElementSibling?.querySelectorAll("i").forEach((d, k) => d.classList.toggle("on", k === i));
  };
  on({ more: more(el, fetch, photoCard), "view-story": b => viewStories(stories, +b.dataset.i) });
}

/* stories play one after another: 5s per photo, a video plays to its end; tap left/right to move */
function viewStories(groups, gi) {
  let g = gi, i = 0, timer;
  const s = sheet(html`<div class="story-view"><div class="bars"></div><div class="story-head"></div><div class="story-media"></div>
    <button class="tap left" aria-label="Previous"></button><button class="tap right" aria-label="Next"></button>
    <button class="icon-btn close" data-close aria-label="Close">${icon("x")}</button></div>`, () => clearTimeout(timer));
  s.el.classList.add("full");
  const v = s.el.querySelector(".story-view");
  const show = () => {
    clearTimeout(timer);
    const grp = groups[g]; if (!grp) return s.close();
    const it = grp.items[i];
    v.querySelector(".bars").innerHTML = grp.items.map((_, k) => `<i class="${k < i ? "done" : k === i ? "run" : ""}"></i>`).join("");
    v.querySelector(".story-head").innerHTML = html`${avatar(grp.author, 32)} <b>${grp.author.handle}</b> <span class="muted">${ago(it.created_at)}</span>`.s;
    const box = v.querySelector(".story-media"); box.innerHTML = media(it.media).s; hydrate(v);
    const vid = box.querySelector("video");
    if (vid) { vid.controls = false; vid.autoplay = true; vid.onended = next; } else timer = setTimeout(next, 5000);
  };
  const next = () => { if (++i >= groups[g].items.length) { g++; i = 0; } show(); };
  const prev = () => { if (--i < 0) { g = Math.max(g - 1, 0); i = 0; } show(); };
  v.querySelector(".right").onclick = next; v.querySelector(".left").onclick = prev;
  show();
}
