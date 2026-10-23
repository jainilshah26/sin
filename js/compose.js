/* One composer for every mode: a note (Feed), a photo post, a video, a story. */
import { api } from "./api.js";
import { html, sheet, toast, icon, hydrate } from "./ui.js";
import * as M from "./media.js";
import { route, go } from "./main.js";

const TITLES = { note: "New post", photo: "New photo post", video: "Upload a video", story: "Add to your story" };

export async function open(kind) {
  if (kind === "story") return story();
  let media = [];
  const s = sheet(html`<form class="stack compose" data-kind="${kind}"><div class="row"><h3 class="grow">${TITLES[kind]}</h3><button type="button" class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div>
    ${kind === "video" ? html`<input name="title" placeholder="Title" maxlength="150" required>` : ""}
    <textarea name="body" rows="${kind === "note" ? 4 : 3}" maxlength="2000" placeholder="${kind === "note" ? "What's happening?" : kind === "video" ? "Description" : "Write a caption"}" ${kind === "note" ? "autofocus" : ""}></textarea>
    <div class="previews"></div>
    <div class="row"><button type="button" class="btn ghost" data-pick>${icon(kind === "video" ? "video" : "image")} ${kind === "video" ? "Choose video" : "Add photos"}</button>
      <span class="muted small grow status"></span><button class="btn">Post</button></div></form>`);
  const form = s.el.querySelector("form"), prev = form.querySelector(".previews"), status = form.querySelector(".status"), post = form.querySelector("button:not([type])");
  const busy = (t) => { status.textContent = t || ""; post.disabled = !!t; };
  const show = () => { prev.innerHTML = media.map(m => html`<img data-src="${m.thumb}" alt="">`.s).join(""); hydrate(prev); };
  form.querySelector("[data-pick]").onclick = async () => {
    const files = await M.pick(kind === "video" ? "video/*" : "image/*", kind !== "video");
    if (!files.length) return;
    try {
      busy(kind === "video" ? "Uploading video…" : "Processing photos…");
      const out = [];
      for (const f of files.slice(0, 10 - media.length)) out.push(await (kind === "video" ? M.video(f) : M.photo(f)));
      media = kind === "video" ? out : media.concat(out); show();
    } catch (e) { toast(e.message, true); } finally { busy(); }
  };
  if (kind !== "note") form.querySelector("[data-pick]").click();
  form.onsubmit = async e => {
    e.preventDefault(); busy("Posting…");
    try {
      const p = await api.create_post({ kind, body: form.body.value, title: form.title ? form.title.value : "", media, reply_to: null });
      s.close(); toast("Posted");
      if (kind === "video") go("#/watch/" + p.id); else route();
    } catch (err) { toast(err.message, true); busy(); }
  };
}

async function story() {
  const [file] = await M.pick("image/*,video/*");
  if (!file) return;
  try { toast("Uploading…"); await api.create_story({ media: await M.any(file) }); toast("Added to your story"); route(); }
  catch (e) { toast(e.message, true); }
}
