/* Chat (WhatsApp-style): 1:1 and group chats, read receipts, photo/video sharing, live delivery. */
import { api } from "../api.js";
import { html, icon, avatar, ago, clock, rich, empty, sheet, hydrate, toast, media } from "../ui.js";
import { on, draw, go, route, live, ctx, badges } from "../main.js";
import * as M from "../media.js";

export const routes = { chat: list, "chat/:id": room };

const title = c => c.is_group ? c.title : c.members[0] ? c.members[0].name : "Just you";
const face = (c, size) => c.is_group ? html`<span class="av av-txt group" style="width:${size}px;height:${size}px">${c.title.slice(0, 1).toUpperCase()}</span>` : avatar(c.members[0], size);

/* The list of chats. On laptops it stays on the left while a chat is open (two panes); on phones it is its own screen. */
const convList = (convs, active) => html`<div class="row pad"><h2 class="grow">Chats</h2><button class="btn small" data-act="new-chat">${icon("plus")} New</button></div>
  ${convs.length ? convs.map(c => html`<a class="conv ${c.unread ? "unread" : ""} ${c.id === active ? "on" : ""}" href="#/chat/${c.id}">${face(c, 48)}
    <div class="grow clip"><b>${title(c)}</b><div class="muted small clip">${c.last ? (c.last.sender_id === ctx.me.id ? "You: " : "") + (c.last.body || (c.last.has_media ? "📷 Photo" : "")) : c.is_group ? `${c.members.length + 1} members` : "Say hi"}</div></div>
    <div class="end-col"><span class="muted small">${c.last ? ago(c.last.created_at) : ""}</span>${c.unread && c.id !== active ? html`<i class="badge on">${c.unread}</i>` : ""}</div></a>`)
  : empty("No chats yet.", html`<button class="btn" data-act="new-chat">Start a chat</button>`)}`;

async function list(el) {
  const convs = await api.conversations();
  draw(el, html`<div class="chat-split list-only"><div class="conv-col">${convList(convs)}</div>
    <div class="chat-empty">${icon("chat")}<p>Pick a chat on the left, or start a new one.</p></div></div>`);
  on({ "new-chat": newChat });
  live(e => { if (e.type === "message" || e.type === "read") route(); });
}

/* pick one person for a DM, or several plus a name for a group */
async function newChat() {
  const picked = new Map();
  let shown = [];
  const s = sheet(html`<div class="stack"><div class="row"><h3 class="grow">New chat</h3><button class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div>
    <input type="search" placeholder="Search people" aria-label="Search people" autofocus><div class="results"></div>
    <button class="btn wide" data-dm hidden></button>
    <div class="row" data-group hidden><input name="title" class="grow" placeholder="Group name" maxlength="80" aria-label="Group name"><button class="btn" data-go>Create group</button></div></div>`);
  const $ = q => s.el.querySelector(q), res = $(".results");
  const paint = () => {
    const rows = [...picked.values(), ...shown.filter(u => u.id !== ctx.me.id && !picked.has(u.id))];
    res.innerHTML = rows.map(u => html`<button class="person wide ${picked.has(u.id) ? "picked" : ""}" data-u="${u.id}">${avatar(u, 40)}<div class="grow"><b>${u.name}</b><div class="muted">@${u.handle}</div></div>
      ${picked.has(u.id) ? icon("check") : ""}</button>`.s).join("") || `<p class="muted pad">Type a name to find people.</p>`;
    hydrate(res);
    const one = picked.size === 1 && [...picked.values()][0];
    $("[data-dm]").hidden = !one; if (one) $("[data-dm]").textContent = "Message " + one.name;
    $("[data-group]").hidden = picked.size < 2;
  };
  let t; $("input").oninput = e => { clearTimeout(t); t = setTimeout(async () => { shown = (await api.search({ q: e.target.value })).people; paint(); }, 200); };
  const net = await api.my_network();
  shown = net.connected.concat(await api.suggestions()).filter((u, i, a) => a.findIndex(x => x.id === u.id) === i); paint();
  res.onclick = e => {
    const b = e.target.closest("[data-u]"); if (!b) return;
    const u = picked.get(b.dataset.u) || shown.find(x => x.id === b.dataset.u);
    if (picked.has(u.id)) picked.delete(u.id); else picked.set(u.id, u);
    paint();
  };
  $("[data-dm]").onclick = async () => { try { const c = await api.open_dm({ user: [...picked.keys()][0] }); s.close(); go("#/chat/" + c.id); } catch (e) { toast(e.message, true); } };
  $("[data-go]").onclick = async () => {
    try { const c = await api.create_group({ title: $("[name=title]").value, members: [...picked.keys()] }); s.close(); go("#/chat/" + c.id); } catch (e) { toast(e.message, true); }
  };
}

async function room(el, { id }) {
  const conv = +id;
  let [d, convs] = await Promise.all([api.get_messages({ conv, before: null }), api.conversations()]);
  const c = d.conversation, people = Object.fromEntries(c.members.map(u => [u.id, u]));
  draw(el, html`<div class="chat-split"><div class="conv-col">${convList(convs, conv)}</div><div class="chat">
    <div class="bar"><a class="icon-btn back" href="#/chat" aria-label="Back">${icon("back")}</a>${face(c, 36)}
      <div class="grow clip">${c.is_group ? html`<b>${c.title}</b><div class="muted small clip">${c.members.map(u => u.name).join(", ")}, you</div>`
        : c.members[0] ? html`<a href="#/u/${c.members[0].handle}"><b>${c.members[0].name}</b></a><div class="muted small">@${c.members[0].handle}</div>` : ""}</div></div>
    <div class="msgs" role="log" aria-live="polite"></div>
    <form class="msg-box" data-form="send"><button type="button" class="icon-btn" data-act="attach" aria-label="Send a photo or video">${icon("image")}</button>
      <textarea name="body" rows="1" placeholder="Message" maxlength="4000" aria-label="Message"></textarea><button class="icon-btn send" aria-label="Send">${icon("send")}</button></form></div></div>`);
  const col = el.querySelector(".conv-col");
  const relist = async () => { if (getComputedStyle(col).display !== "none") { col.innerHTML = convList(await api.conversations(), conv).s; hydrate(col); } };
  const box = el.querySelector(".msgs"), input = el.querySelector("textarea");
  const paint = () => {
    const mine = d.messages.filter(m => m.sender_id === ctx.me.id), lastMine = mine.at(-1);
    const seenBy = lastMine ? c.members.filter(u => d.reads[u.id] >= lastMine.id) : [];
    let prevDay = "";
    box.innerHTML = d.messages.map(m => {
      const day = new Date(m.created_at).toDateString(), sep = day !== prevDay ? html`<div class="day">${new Date(m.created_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>` : "";
      prevDay = day; const me = m.sender_id === ctx.me.id, from = people[m.sender_id];
      return html`${sep}<div class="msg ${me ? "me" : ""}">${c.is_group && !me && from ? html`<div class="from">${from.name}</div>` : ""}
        ${m.media.map(x => media(x))}${m.body ? html`<div>${rich(m.body)}</div>` : ""}<span class="t">${clock(m.created_at)}</span></div>`.s;
    }).join("") + (lastMine && lastMine.id === d.messages.at(-1).id
      ? html`<div class="seen">${seenBy.length ? (c.is_group ? `Seen by ${seenBy.map(u => u.name).join(", ")}` : "Seen") : "Sent"}</div>`.s : "");
    if (!d.messages.length) box.innerHTML = html`<p class="muted center pad">No messages yet. Say hi 👋</p>`.s;
    hydrate(box); box.scrollTop = box.scrollHeight;
  };
  const reload = async () => { d = await api.get_messages({ conv, before: null }); paint(); };
  const read = async () => { if (document.visibilityState === "visible" && d.messages.length && d.reads[ctx.me.id] < d.messages.at(-1).id) { await api.mark_read({ conv }); badges(); } };
  paint(); read();
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); input.form.requestSubmit(); } });
  const send = async (body, mediaList) => { const m = await api.send_message({ conv, body, media: mediaList }); d.messages.push(m); d.reads[ctx.me.id] = m.id; paint(); };
  on({
    send: async (f, v) => { if (!v.body.trim()) return; input.value = ""; try { await send(v.body, []); } catch (e) { input.value = v.body; throw e; } input.focus(); },
    attach: async () => { const files = await M.pick("image/*,video/*", true); if (!files.length) return; toast("Sending…"); const ms = []; for (const f of files.slice(0, 10)) ms.push(await M.any(f)); await send("", ms); },
  });
  on({ "new-chat": newChat });
  live(async e => { if (e.conversation_id === conv) { await reload(); if (e.type === "message") read(); } if (e.type === "message") relist(); });
  const vis = () => read(); document.addEventListener("visibilitychange", vis);
  ctx.cleanups.push(() => document.removeEventListener("visibilitychange", vis));
}
