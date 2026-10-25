/* Optional bot check (Cloudflare Turnstile) on sign-up, log-in and password reset. Off until a site key is set in
   js/config.js; Supabase checks the token server-side once "CAPTCHA protection" is switched on in its dashboard.
   For tests, offline mode accepts ?captcha=<key>. */
import { CONFIG } from "./config.js";

const offline = /[?&]offline/.test(location.search);
export const captchaKey = CONFIG.captchaSiteKey || (offline && new URLSearchParams(location.search).get("captcha")) || "";

let loading = null;
const load = () => loading ||= new Promise((res, rej) => {
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
  s.onload = () => res(window.turnstile);
  s.onerror = () => { loading = null; rej(new Error("Couldn't load the bot check. Check your internet and try again.")); };
  document.head.appendChild(s);
});

/* Puts the check inside el. token() waits for the person to pass it; reset() asks again (each token works once). */
export function captcha(el) {
  if (!captchaKey || !el) return { token: async () => undefined, reset() { } };
  let id = null, value = null;
  const waiting = [];
  el.hidden = false;
  load().then(t => {
    id = t.render(el, { sitekey: captchaKey, theme: "auto", size: "flexible",
      callback: v => { value = v; waiting.splice(0).forEach(f => f(v)); },
      "expired-callback": () => (value = null), "error-callback": () => (value = null) });
  }).catch(e => (el.textContent = e.message));
  return {
    token: () => value ? Promise.resolve(value) : new Promise((res, rej) => {
      waiting.push(res); setTimeout(() => rej(new Error("Please complete the check above, then try again.")), 20000);
    }),
    reset() { value = null; if (id !== null && window.turnstile) window.turnstile.reset(id); },
  };
}
