/* The showcase on the log-in and sign-up screens: a phone that cycles through the five modes, built from the app's own
   styles (so it is sharp at any size, follows light/dark mode and costs no image downloads). */
import { html, raw, icon } from "./ui.js";

/* small illustrated "photos" for the mock screens */
const scene = (sky1, sky2, hill1, hill2, sun) => raw(`<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="s${sky1.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
  <rect width="300" height="200" fill="url(#s${sky1.slice(1)})"/><circle cx="210" cy="78" r="26" fill="${sun}"/>
  <path d="M0 150 L70 95 L130 140 L190 90 L300 160 V200 H0z" fill="${hill1}"/><path d="M0 175 Q90 135 170 170 T300 165 V200 H0z" fill="${hill2}"/></svg>`);
const SUNSET = () => scene("#ff9a5a", "#ffd27a", "#b4436c", "#6d2a5c", "#fff3c4");
const LAKE = () => scene("#5ab0ff", "#c7ecff", "#2f7d6d", "#1f5b67", "#ffffff");
const NIGHT = () => scene("#1d2b64", "#5b4b9a", "#2a1f4f", "#120e2b", "#f6e7a8");

const av = (letter, hue, size = 28) => html`<span class="av av-txt" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px;background:hsl(${hue} 60% 50%)">${letter}</span>`;
const bar = title => html`<div class="m-bar"><b>${title}</b><span class="grow"></span>${icon("search")}${icon("bell")}</div>`;
const acts = (r, s, l) => html`<div class="m-acts">${icon("reply")}<i>${r}</i>${icon("repost")}<i>${s}</i><span class="on-like">${icon("heart")}</span><i>${l}</i></div>`;

const SLIDES = [
  { mode: "feed", label: "Feed", line: "Post what's happening, reply and repost", screen: () => html`${bar("Feed")}
    <div class="m-post">${av("A", 210)}<div><b>Aarav Mehta</b> <span class="muted">@aarav · 2m</span><p>Just shipped my first app 🚀 who wants to try it?</p>${acts(12, 4, 87)}</div></div>
    <div class="m-post">${av("S", 330)}<div><b>Sara Khan</b> <span class="muted">@sara · 9m</span><p>Monsoon evenings + chai = perfect ☔️ <span class="m-link">#mumbai</span></p>
      <div class="m-img">${SUNSET()}</div>${acts(5, 2, 143)}</div></div>
    <div class="m-post">${av("D", 160)}<div><b>Dev Patel</b> <span class="muted">@devp · 1h</span><p>Hot take: tabs &gt; spaces. Fight me 😄</p>${acts(48, 9, 312)}</div></div>` },
  { mode: "photos", label: "Photos", line: "Share photos and 24-hour stories", screen: () => html`${bar("Photos")}
    <div class="m-stories">${[["You", 25], ["Riya", 330], ["Dev", 160], ["Maya", 270], ["Kabir", 45]].map(([n, h], i) => html`<span><i class="${i ? "ring" : ""}">${av(n[0], h, 40)}</i>${n}</span>`)}</div>
    <div class="m-head">${av("R", 330, 26)}<b>riya.clicks</b><span class="muted">· Ladakh</span></div>
    <div class="m-photo">${LAKE()}</div>
    <div class="m-acts big"><span class="on-like">${icon("heart")}</span>${icon("reply")}${icon("send")}</div><p class="m-cap"><b>2,481 likes</b> · Where the sky meets the lake 💙</p>` },
  { mode: "chat", label: "Chat", line: "Message friends and groups, see when it's read", screen: () => html`<div class="m-bar">${icon("back")}${av("M", 270)}<div><b>Maya</b><div class="muted tiny">online</div></div></div>
    <div class="m-chat"><div class="day">Today</div>
      <div class="msg">Are we still on for Saturday? 🎉</div>
      <div class="msg me">Yes! I'll bring the cake 🎂</div>
      <div class="msg"><div class="m-img small">${NIGHT()}</div>The venue at night 😍</div>
      <div class="msg me">Wow, see you there!</div><div class="seen">Seen</div></div>
    <div class="m-box"><span>Message</span>${icon("send")}</div>` },
  { mode: "video", label: "Video", line: "Upload videos, subscribe to channels", screen: () => html`${bar("Video")}
    <div class="m-player">${NIGHT()}<i class="play">${icon("play")}</i><span class="dur">12:48</span></div>
    <div class="m-vt"><b>I built an app in a weekend: full walkthrough</b><div class="muted tiny">Dev Patel · 24K views · 2 days ago</div></div>
    <div class="m-vrow"><div class="m-thumb">${SUNSET()}<span class="dur">8:05</span></div><div><b>Street food tour of Ahmedabad</b><div class="muted tiny">Foodie Nation · 91K views</div></div></div>
    <div class="m-vrow"><div class="m-thumb">${LAKE()}<span class="dur">15:30</span></div><div><b>Road trip: Manali to Leh</b><div class="muted tiny">Kabir Travels · 310K views</div></div></div>` },
  { mode: "work", label: "Work", line: "Your work profile, connections and jobs", screen: () => html`${bar("Work")}
    <div class="m-card">${av("K", 160, 40)}<div><b>Kabir Singh</b><div class="muted tiny">Product designer · Bengaluru</div><span class="m-chip">Open to work</span></div></div>
    <div class="m-job"><span class="m-logo" style="background:#0e7490">N</span><div><b>Frontend Engineer</b><div>Nimbus Labs</div><div class="muted tiny">Remote · Full-time</div></div></div>
    <div class="m-job"><span class="m-logo" style="background:#7c3aed">B</span><div><b>Marketing Lead</b><div>Bloom Studio</div><div class="muted tiny">Mumbai · Full-time</div></div><span class="m-chip">Applied</span></div>
    <div class="m-job"><span class="m-logo" style="background:#db2777">P</span><div><b>Data Analyst Intern</b><div>Pixel Pay</div><div class="muted tiny">Pune · Internship</div></div></div>` },
];

export const showcase = () => html`<div class="w-show">
  <div class="phone" aria-hidden="true"><div class="phone-screen">${SLIDES.map((s, i) => html`<div class="m-screen ${i ? "" : "on"}" data-mode="${s.mode}">${s.screen()}</div>`)}</div></div>
  <div class="w-modes" role="tablist" aria-label="What's inside">${SLIDES.map((s, i) => html`<button type="button" role="tab" class="w-mode ${i ? "" : "on"}" data-i="${i}" data-mode="${s.mode}" aria-selected="${!i}">
    ${icon(s.mode)}<span><b>${s.label}</b><small>${s.line}</small></span></button>`)}</div></div>`;

/* cycles the slides every few seconds; tapping a mode jumps to it and pauses the cycle for a while */
export function startShowcase(root) {
  const screens = [...root.querySelectorAll(".m-screen")], tabs = [...root.querySelectorAll(".w-mode")];
  if (!screens.length) return () => { };
  let i = 0, timer, hold = 0;
  const show = n => {
    i = (n + SLIDES.length) % SLIDES.length;
    screens.forEach((s, k) => s.classList.toggle("on", k === i));
    tabs.forEach((t, k) => { t.classList.toggle("on", k === i); t.setAttribute("aria-selected", k === i); });
    root.querySelector(".w-show").dataset.mode = SLIDES[i].mode;
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!still) timer = setInterval(() => {
    if (!root.isConnected) return clearInterval(timer);   // the person logged in and the showcase is gone
    if (Date.now() > hold && document.visibilityState === "visible") show(i + 1);
  }, 3200);
  tabs.forEach((t, k) => (t.onclick = () => { show(k); hold = Date.now() + 9000; }));
  show(0);
  return () => clearInterval(timer);
}
