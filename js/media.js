/* Media handling on the phone, before anything is uploaded:
   photos are re-encoded to at most 1080px (plus a 360px thumbnail for grids), which strips location metadata and
   keeps storage small; videos get a poster frame, size and duration. See ARCHITECTURE.md for server-side transcoding. */
import { api, cloud } from "./api.js";

export const MAX_VIDEO_MB = cloud ? 200 : 60;

const loadImage = file => new Promise((res, rej) => {
  const u = URL.createObjectURL(file), i = new Image();
  i.onload = () => res(i); i.onerror = () => rej(new Error("That photo couldn't be opened."));
  i.src = u;
});
const toBlob = (c, q = 0.85) => new Promise(res => c.toBlob(res, "image/jpeg", q));
function draw(src, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h)), c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function photo(file) {
  if (!file.type.startsWith("image/")) throw new Error("Pick a photo.");
  const img = await loadImage(file), full = draw(img, img.naturalWidth, img.naturalHeight, 1080);
  const [a, b] = await Promise.all([toBlob(full), toBlob(draw(img, img.naturalWidth, img.naturalHeight, 360), 0.75)]);
  const [url, thumb] = await Promise.all([api.upload(a, "jpg"), api.upload(b, "jpg")]);
  return { type: "image", url, thumb, w: full.width, h: full.height };
}

export async function video(file) {
  if (!file.type.startsWith("video/")) throw new Error("Pick a video.");
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`Videos can be up to ${MAX_VIDEO_MB} MB here.`);
  const v = document.createElement("video"), u = URL.createObjectURL(file);
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = u;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("That video format isn't supported by this browser.")); });
  const duration = Math.round(v.duration || 0);
  await new Promise(res => { v.onseeked = res; v.currentTime = Math.min(1, (v.duration || 0) / 2); setTimeout(res, 1500); });
  const poster = await toBlob(draw(v, v.videoWidth, v.videoHeight, 720), 0.8);
  URL.revokeObjectURL(u);
  const ext = { "video/webm": "webm", "video/quicktime": "mov" }[file.type] || "mp4";   // names the server accepts
  const [url, thumb] = await Promise.all([api.upload(file, ext), poster ? api.upload(poster, "jpg") : null]);
  return { type: "video", url, thumb, w: v.videoWidth, h: v.videoHeight, duration };
}

export const any = file => (file.type.startsWith("video/") ? video(file) : photo(file));

/* opens the file picker and resolves with the chosen files (or [] if cancelled) */
export function pick(accept, multiple = false) {
  return new Promise(res => {
    const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...i.files]); i.click();
  });
}
