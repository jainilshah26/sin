/* Rendering helpers shared by every mode: safe HTML templates, icons, avatars, post cards, toasts and sheets. */
import { mediaUrl } from "./api.js";

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = v => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join("") : v == null || v === false ? "" : esc(v));
/* html`<p>${text}</p>` escapes every value unless it is itself html`` or raw() */
export const html = (str, ...vals) => raw(str.reduce((a, s, i) => a + s + (i < vals.length ? fmt(vals[i]) : ""), ""));
export const $ = (sel, root = document) => root.querySelector(sel);

const P = {
  feed: "M4 5h16M4 10h16M4 15h10M4 20h7",
  photos: "M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chat: "M4 5h16v11H9l-5 4z",
  video: "M3 6h13v12H3zM16 10l5-3v10l-5-3",
  work: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l5 5",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  reply: "M4 5h16v11H9l-5 4z",
  repost: "M7 7h11l-3-3M17 17H6l3 3M18 7v5M6 17v-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  send: "M4 12l16-8-6 16-2-7z",
  image: "M4 5h16v14H4zM4 15l5-5 5 5 3-3 3 3",
  play: "M8 5l11 7-11 7z",
  check: "M5 12l4 4 10-10",
  x: "M6 6l12 12M18 6L6 18",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  building: "M5 21V4h10v17M15 9h4v12M8 8h3M8 12h3M8 16h3",
  out: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  auto: "M3 5h18v11H3zM8 20h8M12 16v4",
};
export const icon = (n, cls = "") => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`);

const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
export const avatar = (u, size = 40) => u && u.avatar_url
  ? html`<img class="av" style="width:${size}px;height:${size}px" data-src="${u.avatar_url}" alt="">`
  : html`<span class="av av-txt" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:hsl(${hue(u ? u.handle : "?")} 55% 45%)">${(u ? u.name || u.handle : "?").slice(0, 1).toUpperCase()}</span>`;
export const who = u => html`<a class="who" href="#/u/${u.handle}"><b>${u.name}</b> <span class="muted">@${u.handle}</span></a>`;

export function ago(t) {
  const s = (Date.now() - Date.parse(t)) / 1000;
  if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 604800) return Math.floor(s / 86400) + "d";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: s > 31536000 ? "numeric" : undefined });
}
export const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const dur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
export const count = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n || 0));
export const plural = (n, w) => `${count(n)} ${w}${n === 1 ? "" : "s"}`;

/* plain text with links, @handles and #tags made clickable */
export const rich = t => raw(esc(t).replace(/(https?:\/\/[^\s<]+)|(^|[^\w])@([a-z0-9_]{3,20})|(^|[^\w&])#(\w{2,40})/gi, (m, url, p1, h, p2, tag) =>
  url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` : h ? `${p1}<a href="#/u/${h.toLowerCase()}">@${h}</a>` : `${p2}<a href="#/search?q=%23${tag}">#${tag}</a>`));

export const media = (m, cls = "") => m.type === "video"
  ? html`<video class="${cls}" controls playsinline preload="metadata" data-src="${m.url}" data-poster="${m.thumb || ""}"></video>`
  : html`<img class="${cls}" data-src="${m.url}" alt="" loading="lazy">`;

/* A note (Feed), a photo post or a video in the list style. Reposts show the original with a "reposted" line. */
export function postCard(p, opts = {}) {
  if (p.repost_of !== null && p.repost_of !== undefined || (p.body === "" && p.kind === "note" && !p.media.length && !p.reply_to)) {
    const o = p.repost_of;
    return html`<article class="post"><div class="reposted">${icon("repost")} ${p.mine ? "You" : p.author.name} reposted</div>
      ${o ? postCard(o, opts) : html`<p class="muted pad">This post is no longer available.</p>`}</article>`;
  }
  const m = p.media || [];
  return html`<article class="post ${opts.big ? "big" : ""}" data-post="${p.id}">
    <div class="post-head">${avatar(p.author, 40)}<div class="grow">${who(p.author)} <span class="muted">· <a href="#/p/${p.id}" class="muted">${ago(p.created_at)}</a></span>
      ${p.kind !== "note" ? html` <span class="chip">${p.kind}</span>` : ""}</div>
      <button class="icon-btn" data-act="post-menu" data-id="${p.id}" data-mine="${p.mine ? 1 : ""}" aria-label="More">${icon("more")}</button></div>
    ${p.title ? html`<h3 class="post-title"><a href="${p.kind === "video" ? "#/watch/" + p.id : "#/p/" + p.id}">${p.title}</a></h3>` : ""}
    ${p.body ? html`<div class="post-body" data-act="${opts.big ? "" : "open-post"}" data-id="${p.id}">${rich(p.body)}</div>` : ""}
    ${m.length ? (p.kind === "video" && !opts.big
      ? html`<a class="vthumb" href="#/watch/${p.id}"><img data-src="${m[0].thumb}" alt=""><span class="dur">${dur(m[0].duration)}</span></a>`
      : html`<div class="media-grid n${Math.min(m.length, 4)}">${m.slice(0, opts.big ? 10 : 4).map(x => media(x))}</div>`) : ""}
    ${actions(p)}
  </article>`;
}
export const actions = p => html`<div class="actions">
  <a class="act" href="#/p/${p.id}" aria-label="Reply">${icon("reply")} <span>${p.reply_count || ""}</span></a>
  <button class="act ${p.reposted ? "on-repost" : ""}" data-act="repost" data-id="${p.id}" aria-label="Repost">${icon("repost")} <span>${p.repost_count || ""}</span></button>
  <button class="act ${p.liked ? "on-like" : ""}" data-act="like" data-id="${p.id}" aria-label="Like">${icon("heart")} <span>${p.like_count || ""}</span></button>
  ${p.kind === "video" ? html`<span class="act muted">${plural(p.view_count, "view")}</span>` : ""}
</div>`;

/* "Made in India" with a small drawn flag (the 🇮🇳 emoji shows as the letters "IN" on Windows) */
const FLAG = raw(`<svg class="flag" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#ff9933"/>
  <rect y="13.33" width="30" height="6.67" fill="#138808"/><circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width=".6"/><circle cx="15" cy="10" r=".6" fill="#000080"/></svg>`);
export const madeIn = () => html`<p class="made-in">Made in India ${FLAG}</p>`;

export const empty = (text, extra = "") => html`<div class="empty"><p>${text}</p>${extra}</div>`;
export const loading = () => html`<div class="spin" aria-label="Loading"></div>`;

/* Loads media URLs (offline mode stores them in IndexedDB) for every [data-src] under root. */
export function hydrate(root) {
  for (const el of root.querySelectorAll("[data-src]")) {
    const u = el.dataset.src; el.removeAttribute("data-src");
    mediaUrl(u).then(x => { if (x) el.src = x; });
    if (el.dataset.poster) mediaUrl(el.dataset.poster).then(x => { if (x) el.poster = x; });
  }
}

let toastT;
export function toast(msg, bad = false) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.className = "show" + (bad ? " bad" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 2600);
}

/* A bottom sheet / dialog. content is html``; returns {el, close}. */
export function sheet(content, onClose) {
  const el = document.createElement("div"); el.className = "sheet-wrap";
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${content}</div>`;
  const close = () => { el.remove(); document.removeEventListener("keydown", key); onClose && onClose(); };
  const key = e => { if (e.key === "Escape") close(); };
  el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", key);
  document.body.appendChild(el); hydrate(el);
  const f = el.querySelector("[autofocus]"); if (f) f.focus();
  return { el, close };
}
export const ask = (title, label, value = "") => new Promise(res => {
  const s = sheet(html`<form class="stack" data-ask><h3>${title}</h3><input name="v" value="${value}" aria-label="${label}" placeholder="${label}" autofocus maxlength="500">
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">OK</button></div></form>`, () => res(null));
  s.el.querySelector("form").onsubmit = e => { e.preventDefault(); const v = e.target.v.value.trim(); s.el.remove(); res(v || null); };
});
export const confirmSheet = (title, yes = "Delete") => new Promise(res => {
  let done = false;
  const s = sheet(html`<div class="stack"><h3>${title}</h3><div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-yes>${yes}</button></div></div>`, () => { if (!done) res(false); });
  s.el.querySelector("[data-yes]").onclick = () => { done = true; s.close(); res(true); };
});
