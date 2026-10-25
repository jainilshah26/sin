/* Light, dark, or follow the device ("system"). The choice is remembered on this device; index.html applies it before
   the first paint so the page never flashes the wrong colours. */
import { html, icon } from "./ui.js";

const KEY = "sin_theme", COLORS = { light: "#ffffff", dark: "#0f1115" };
const dark = matchMedia("(prefers-color-scheme: dark)");

export function getTheme() { try { return localStorage.getItem(KEY) || "system"; } catch (e) { return "system"; } }

export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
  // the phone's status bar / browser bar colour follows the app
  for (const m of document.querySelectorAll('meta[name="theme-color"]'))
    m.content = t === "system" ? (m.media.includes("dark") ? COLORS.dark : COLORS.light) : COLORS[t];
  for (const b of document.querySelectorAll("[data-act=theme]")) b.setAttribute("aria-pressed", b.dataset.t === t);
}

export function setTheme(t) {
  try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { }
  applyTheme(t);
}

const OPTIONS = [["system", "System", "auto"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];
/* three-way switch; any copy of it on screen stays in step */
export const themePicker = () => { const t = getTheme();
  return html`<div class="theme-pick" role="group" aria-label="Appearance">${OPTIONS.map(([k, label, ic]) =>
    html`<button type="button" data-act="theme" data-t="${k}" aria-pressed="${t === k}">${icon(ic)}<span>${label}</span></button>`)}</div>`; };

dark.addEventListener("change", () => applyTheme());
applyTheme();
