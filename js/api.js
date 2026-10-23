/* One API for the whole app. In the cloud every call is a Supabase RPC (supabase/migrations/0002_functions.sql);
   with ?offline (or no Supabase settings) the same functions run in this browser from js/backend/local.js,
   accounts live on this device and tabs of one browser see each other's posts and messages live. */
import { CONFIG } from "./config.js";
import { emptyState, call } from "./backend/local.js";

export const cloud = !!(CONFIG.url && CONFIG.key) && !/[?&]offline/.test(location.search);
const listeners = new Set();
const emit = e => listeners.forEach(f => { try { f(e); } catch (err) { console.error(err); } });
/* Live events: {type: "message", conversation_id} | {type: "read", conversation_id} | {type: "notification"} | {type: "change"} */
export const onLive = f => (listeners.add(f), () => listeners.delete(f));

/* ---------- cloud ---------- */
let sbp = null;
function sb() {
  return sbp ||= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
    s.onload = () => res(window.supabase.createClient(CONFIG.url, CONFIG.key));
    s.onerror = () => { sbp = null; rej(new Error("Couldn't reach the server. Check your internet.")); };
    document.head.appendChild(s);
  });
}
let channel = null;
async function cloudLive(uid) {
  const c = await sb();
  if (channel) c.removeChannel(channel);
  channel = c.channel("live:" + uid)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => emit({ type: "message", conversation_id: p.new.conversation_id, sender_id: p.new.sender_id }))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members" }, p => emit({ type: "read", conversation_id: p.new.conversation_id }))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + uid }, () => emit({ type: "notification" }))
    .subscribe();
}

/* ---------- offline ---------- */
const DBK = "sin_db";
const load = () => { try { return JSON.parse(localStorage.getItem(DBK)) || emptyState(); } catch (e) { return emptyState(); } };
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sin") : null;
if (bc && !cloud) bc.onmessage = ({ data }) => emit(data);
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");
let localUid = (() => { try { return sessionStorage.getItem("sin_uid"); } catch (e) { return null; } })();
const setLocalUid = u => { localUid = u; try { u ? sessionStorage.setItem("sin_uid", u) : sessionStorage.removeItem("sin_uid"); } catch (e) { } };
/* functions that change something other tabs might be showing */
const LIVE = { send_message: d => ({ type: "message", conversation_id: d.args.conv, sender_id: localUid }), mark_read: d => ({ type: "read", conversation_id: d.args.conv }) };
const READS = /^(me|get_|list_|my_|search|stories|conversations|companies|notifications|badges|suggestions|watch_history|mod_queue)/;

function localCall(name, args) {
  const s = load();
  const r = call(s, localUid, name, args);               // throws before saving on a bad request
  if (!READS.test(name)) {
    try { localStorage.setItem(DBK, JSON.stringify(s)); } catch (e) { throw new Error("This device is out of space for offline mode."); }
    if (bc) { bc.postMessage(LIVE[name] ? LIVE[name]({ args }) : { type: "change" }); bc.postMessage({ type: "notification" }); }
  }
  return r;
}

/* Blobs for offline mode live in IndexedDB; their URLs look like idb:<key> and resolve to object URLs. */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open("sin_media", 1); r.onupgradeneeded = () => r.result.createObjectStore("blobs"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbDo = async (mode, f) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("blobs", mode), q = f(t.objectStore("blobs")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
const objectUrls = new Map();
export async function mediaUrl(u) {
  if (!u || !u.startsWith("idb:")) return u;
  if (!objectUrls.has(u)) objectUrls.set(u, idbDo("readonly", s => s.get(u.slice(4))).then(b => (b ? URL.createObjectURL(b) : "")));
  return objectUrls.get(u);
}

/* ---------- public API ---------- */
let session = null; // { uid }
export const api = new Proxy({
  get uid() { return session && session.uid; },
  async init() {
    if (cloud) {
      const c = await sb(); const { data } = await c.auth.getSession();
      session = data.session ? { uid: data.session.user.id } : null;
      c.auth.onAuthStateChange((_e, s) => { session = s ? { uid: s.user.id } : null; });
    } else session = localUid ? { uid: localUid } : null;
    if (session && cloud) cloudLive(session.uid);
    return session;
  },
  async signUp(email, password) {
    email = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email.");
    if (String(password).length < 8) throw new Error("Use at least 8 characters for your password.");
    if (cloud) {
      const { data, error } = await (await sb()).auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("Check your email to confirm your account, then log in.");
      session = { uid: data.user.id }; cloudLive(session.uid); return session;
    }
    const s = load(); if (s.users.some(u => u.email === email)) throw new Error("That email already has an account. Log in instead.");
    const id = crypto.randomUUID(); s.users.push({ id, email, hash: await sha(email + ":" + password) }); localStorage.setItem(DBK, JSON.stringify(s));
    setLocalUid(id); session = { uid: id }; return session;
  },
  async signIn(email, password) {
    email = String(email).trim().toLowerCase();
    if (cloud) {
      const { data, error } = await (await sb()).auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      session = { uid: data.user.id }; cloudLive(session.uid); return session;
    }
    const u = load().users.find(u => u.email === email);
    if (!u || u.hash !== await sha(email + ":" + password)) throw new Error("Wrong email or password.");
    setLocalUid(u.id); session = { uid: u.id }; return session;
  },
  async signOut() {
    if (cloud) { const c = await sb(); if (channel) c.removeChannel(channel); channel = null; await c.auth.signOut(); }
    setLocalUid(null); session = null;
  },
  /* Uploads a blob and returns its URL. Cloud: Storage bucket "media" under <uid>/. Offline: IndexedDB. */
  async upload(blob, ext) {
    const name = crypto.randomUUID() + "." + ext;
    if (cloud) {
      const c = await sb(), path = session.uid + "/" + name;
      const { error } = await c.storage.from("media").upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
      if (error) throw new Error("Upload failed: " + error.message);
      return c.storage.from("media").getPublicUrl(path).data.publicUrl;
    }
    await idbDo("readwrite", s => s.put(blob, name));
    return "idb:" + name;
  },
}, {
  /* api.anything(args) calls the database function of that name */
  get(t, name) {
    if (name in t || typeof name !== "string") return t[name];
    return async (args = {}) => {
      if (cloud) {
        const { data, error } = await (await sb()).rpc(name, Object.fromEntries(Object.entries(args).map(([k, v]) => ["p_" + k, v ?? null])));
        if (error) throw new Error(error.message || "Something went wrong.");
        return data;
      }
      return localCall(name, args);
    };
  },
});
