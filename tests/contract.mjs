/* Contract tests: one scenario that touches every database function, run against
   - js/backend/local.js (the ?offline backend), always, and
   - the real Postgres functions in supabase/migrations, when a database is reachable (DATABASE_URL, default postgres://sin:sin@localhost/sin_test).
   Each step must give the same answer (or the same error) on both. Run with: npm test */
import fs from "node:fs";
import { emptyState, call } from "../js/backend/local.js";

let failed = 0, steps = 0, compared = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log("  FAIL:", msg); } return cond; };

/* ---------- Postgres side ---------- */
let pg = null;
const url = process.env.DATABASE_URL || "postgres://sin:sin@localhost/sin_test";
try {
  const { default: PG } = await import("pg");
  const admin = new PG.Client({ connectionString: url }); await admin.connect();
  const db = "sin_contract_" + process.pid;
  await admin.query(`drop database if exists ${db}`); await admin.query(`create database ${db}`);
  pg = new PG.Client({ connectionString: url.replace(/\/[^/]*$/, "/" + db) }); await pg.connect();
  await pg.query("set client_min_messages = error");
  for (const f of ["tests/pg_stubs.sql", ...fs.readdirSync("supabase/migrations").sort().map(f => "supabase/migrations/" + f)])
    await pg.query(fs.readFileSync(f, "utf8"));
  pg.cleanup = async () => { await pg.end(); await admin.query(`drop database ${db}`); await admin.end(); };
  console.log("Postgres: comparing every step against " + url.replace(/:[^:@/]*@/, ":***@"));
} catch (e) {
  pg = null;
  console.log("Postgres not reachable (" + e.message.split("\n")[0] + "): testing the local backend only.");
}

/* Postgres argument types the driver can't guess */
const CAST = { media: "jsonb", skills: "text[]", members: "uuid[]", user: "uuid", start_date: "date", end_date: "date" };
async function pgCall(uid, name, args) {
  const keys = Object.keys(args), vals = keys.map(k => (CAST[k] === "jsonb" ? JSON.stringify(args[k]) : args[k]));
  const params = keys.map((k, i) => `p_${k} => $${i + 1}` + (CAST[k] ? "::" + CAST[k] : "")).join(", ");
  try {
    await pg.query("begin");
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || ""]);
    const r = await pg.query(`select public.${name}(${params}) as r`, vals);
    await pg.query("commit");
    return r.rows[0].r;
  } catch (e) { await pg.query("rollback"); return { error: e.message }; }
}

/* timestamps differ between the two by nature and jsonb sorts keys its own way; everything else must match exactly */
const norm = v => Array.isArray(v) ? v.map(norm) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, /(_at)$/.test(k) && typeof x === "string" ? "<time>" : norm(x)])) : v;

const state = emptyState();
async function run(uid, name, args = {}) {
  steps++;
  let local;
  try { const snapshot = JSON.stringify(state); try { local = call(state, uid, name, args); } catch (e) { Object.assign(state, JSON.parse(snapshot)); throw e; } }
  catch (e) { local = { error: e.message }; }
  if (pg) {
    const remote = await pgCall(uid, name, args); compared++;
    const a = JSON.stringify(norm(local)), b = JSON.stringify(norm(remote));
    if (!ok(a === b, `${name}(${JSON.stringify(args)}) differs\n    local:    ${a}\n    postgres: ${b}`)) process.exitCode = 1;
  }
  return local;
}
const expectError = async (msg, ...a) => { const r = await run(...a); ok(r && r.error === msg, `${a[1]} should fail with "${msg}", got ${JSON.stringify(r)}`); return r; };

/* ---------- the scenario ---------- */
const U = { alice: "00000000-0000-4000-8000-00000000000a", bob: "00000000-0000-4000-8000-00000000000b", cara: "00000000-0000-4000-8000-00000000000c", dan: "00000000-0000-4000-8000-00000000000d" };
const { alice: A, bob: B, cara: C, dan: D } = U;
if (pg) for (const [n, id] of Object.entries(U)) await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, n + "@example.com"]);
const img = { url: "https://x/p.jpg", thumb: "https://x/t.jpg", type: "image", w: 1080, h: 1080 };
const vid = { url: "https://x/v.mp4", thumb: "https://x/v.jpg", type: "video", w: 1920, h: 1080, duration: 90 };

console.log("\nAccounts and profiles");
await expectError("Sign in first.", null, "badges");
ok(await run(A, "me") === null, "no profile yet");
const a = await run(A, "create_profile", { handle: "Alice", name: "Alice Ng" });
ok(a.handle === "alice" && a.role === "mod", "first account is a moderator, handle lower-cased");
await expectError("That handle is taken.", B, "create_profile", { handle: "alice", name: "Bob" });
await expectError("Handles are 3-20 letters, numbers or _.", B, "create_profile", { handle: "b!", name: "Bob" });
ok((await run(B, "create_profile", { handle: "bob", name: "Bob Ray" })).role === "user", "later accounts are users");
await run(C, "create_profile", { handle: "cara", name: "Cara Diaz" });
await run(D, "create_profile", { handle: "dan_k", name: "Dan K" });
await expectError("You already have a profile.", D, "create_profile", { handle: "dan2", name: "Dan" });
await run(A, "update_profile", { name: "Alice N.", bio: "Builder", avatar_url: "https://x/a.jpg" });
await expectError("Enter your name.", A, "update_profile", { name: "  ", bio: "", avatar_url: null });
const pro = await run(B, "update_pro", { headline: "Engineer", location: "Pune", about: "Hi", skills: ["Go", " SQL ", "go", ""], open_to_work: true });
ok(JSON.stringify(pro.skills) === '["Go","SQL"]', "skills trimmed and de-duplicated");
await expectError("The end date is before the start date.", B, "add_experience", { title: "Dev", company_name: "Acme", start_date: "2024-05-01", end_date: "2023-01-01", description: "" });
await run(B, "add_experience", { title: "Intern", company_name: "Acme", start_date: "2020-01-01", end_date: "2021-01-01", description: "" });
const exp2 = await run(B, "add_experience", { title: "Engineer", company_name: "acme", start_date: "2021-02-01", end_date: null, description: "Backend" });
await run(B, "add_experience", { title: "Temp", company_name: "Other", start_date: "2019-01-01", end_date: "2019-06-01", description: "" });
await run(B, "delete_experience", { id: exp2.id + 1 });
await run(C, "delete_experience", { id: exp2.id }); // not hers: no effect

console.log("Follows, connections, blocks");
await run(A, "follow", { user: B }); await run(C, "follow", { user: B }); await run(B, "follow", { user: A });
await run(A, "follow", { user: B }); // twice is fine, one notification
await expectError("You can't follow yourself.", A, "follow", { user: A });
await run(D, "follow", { user: A }); await run(D, "unfollow", { user: A });
ok((await run(A, "connect", { user: B })).connection === "outgoing", "connection request");
ok((await run(B, "connect", { user: A })).connection === "connected", "accepting by connecting back");
await run(C, "connect", { user: B });
await run(D, "connect", { user: B }); await run(D, "disconnect", { user: B });
const net = await run(B, "my_network");
ok(net.connected.length === 1 && net.incoming.length === 1 && net.incoming[0].headline === "", "network groups");
await run(B, "suggestions"); await run(D, "suggestions");
const pb = await run(A, "get_profile", { handle: "BOB" });
ok(pb.counts.followers === 2 && pb.rel.following && pb.rel.followed_by && pb.rel.connection === "connected", "profile relation");
ok(pb.experiences.length === 2 && pb.experiences[0].title === "Engineer", "current job first");

console.log("Posts, replies, likes, reposts");
const n1 = await run(B, "create_post", { kind: "note", body: "  hello world  ", title: "", media: [], reply_to: null });
ok(n1.body === "hello world" && n1.mine, "note posted");
await expectError("Write something first.", B, "create_post", { kind: "note", body: " ", title: "", media: [], reply_to: null });
await expectError("Add at least one photo.", B, "create_post", { kind: "photo", body: "", title: "", media: [vid], reply_to: null });
await expectError("Give your video a title.", B, "create_post", { kind: "video", body: "", title: "", media: [vid], reply_to: null });
await expectError("Unknown post type.", B, "create_post", { kind: "poll", body: "x", title: "", media: [], reply_to: null });
const ph = await run(A, "create_post", { kind: "photo", body: "sunset #nofilter", title: "", media: [img, img], reply_to: null });
const v1 = await run(B, "create_post", { kind: "video", body: "how we built it", title: "Building Sin", media: [vid], reply_to: null });
const v2 = await run(C, "create_post", { kind: "video", body: "", title: "Cara vlog 1", media: [vid], reply_to: null });
const r1 = await run(A, "create_post", { kind: "note", body: "nice!", title: "", media: [], reply_to: n1.id });
await run(C, "create_post", { kind: "note", body: "great video", title: "", media: [], reply_to: v1.id });
await expectError("Replies are text posts.", C, "create_post", { kind: "photo", body: "", title: "", media: [img], reply_to: n1.id });
ok((await run(A, "toggle_like", { id: n1.id })).like_count === 1, "like");
await run(C, "toggle_like", { id: n1.id });
ok((await run(C, "toggle_like", { id: n1.id })).liked === false, "unlike");
await run(B, "toggle_like", { id: n1.id }); // own like: no notification
ok((await run(A, "repost", { id: n1.id })).repost_count === 1, "repost");
const tlA = await run(A, "list_posts", { kind: "note", scope: "following", author: null, before: null });
ok(tlA[0].repost_of && tlA[0].repost_of.id === n1.id && !tlA.some(p => p.id === r1.id), "timeline shows repost, hides replies");
await run(C, "repost", { id: tlA[0].id }); // reposting a repost reposts the original
ok((await run(C, "repost", { id: n1.id })).reposted === false, "un-repost");
await run(C, "list_posts", { kind: "note", scope: "following", author: null, before: null });
await run(D, "list_posts", { kind: "note", scope: "following", author: null, before: null });
await run(D, "list_posts", { kind: "note", scope: "all", author: null, before: null });
await run(D, "list_posts", { kind: "note", scope: "all", author: null, before: n1.id + 1 });
await run(A, "list_posts", { kind: "photo", scope: "author", author: A, before: null });
await run(A, "list_posts", { kind: "video", scope: "all", author: null, before: null });
const gp = await run(C, "get_post", { id: n1.id });
ok(gp.replies.length === 1 && gp.post.reply_count === 1, "thread");
await run(C, "get_post", { id: r1.id });
for (let i = 0; i < 22; i++) await run(D, "create_post", { kind: "note", body: "spam " + i, title: "", media: [], reply_to: null });
const page1 = await run(D, "list_posts", { kind: "note", scope: "author", author: D, before: null });
const page2 = await run(D, "list_posts", { kind: "note", scope: "author", author: D, before: page1.at(-1).id });
ok(page1.length === 20 && page2.length === 2, "pagination");
await expectError("You can only delete your own posts.", C, "delete_post", { id: page1[0].id });
await run(D, "delete_post", { id: page1[0].id });
const tmp = await run(C, "create_post", { kind: "note", body: "oops", title: "", media: [], reply_to: n1.id });
await run(C, "delete_post", { id: tmp.id });
ok((await run(B, "get_post", { id: n1.id })).post.reply_count === 1, "deleting a reply updates the count");

console.log("Stories");
await expectError("Add a photo or video.", A, "create_story", { media: [] });
await run(B, "create_story", { media: img }); await run(A, "create_story", { media: img }); await run(B, "create_story", { media: vid });
const st = await run(A, "stories");
ok(st.length === 2 && st[0].author.id === A && st[1].items.length === 2, "own stories first, grouped by author");
await run(D, "stories");

console.log("Video: views, history, playlists");
await run(A, "record_view", { id: v1.id, position: 10 }); await run(A, "record_view", { id: v2.id, position: 0 }); await run(A, "record_view", { id: v1.id, position: 42 });
await expectError("Only videos have a watch history.", A, "record_view", { id: n1.id, position: 0 });
const hist = await run(A, "watch_history");
ok(hist.length === 2 && hist[0].post.id === v1.id && hist[0].position === 42 && hist[0].post.view_count === 1, "history: latest first, one view per person");
const pl = await run(A, "create_playlist", { title: "Later" });
await run(A, "playlist_add", { playlist: pl.id, post: v2.id }); await run(A, "playlist_add", { playlist: pl.id, post: v1.id }); await run(A, "playlist_add", { playlist: pl.id, post: v1.id });
await expectError("Only videos go in playlists.", A, "playlist_add", { playlist: pl.id, post: n1.id });
await expectError("Playlist not found.", B, "playlist_add", { playlist: pl.id, post: v1.id });
await run(A, "my_playlists"); await run(B, "get_playlist", { id: pl.id });
await run(A, "playlist_remove", { playlist: pl.id, post: v2.id });
ok((await run(A, "get_playlist", { id: pl.id })).items.length === 1, "playlist remove");
await run(A, "clear_history");
ok((await run(A, "watch_history")).length === 0, "history cleared");

console.log("Chat");
const dm = await run(A, "open_dm", { user: B });
ok((await run(B, "open_dm", { user: A })).id === dm.id, "one DM per pair");
await expectError("Write a message first.", A, "send_message", { conv: dm.id, body: " ", media: [] });
await run(A, "send_message", { conv: dm.id, body: "hey bob", media: [] });
await run(A, "send_message", { conv: dm.id, body: "", media: [img] });
await expectError("Chat not found.", C, "send_message", { conv: dm.id, body: "let me in", media: [] });
await expectError("Chat not found.", C, "get_messages", { conv: dm.id, before: null });
ok((await run(B, "badges")).messages === 2, "two unread");
const convB = await run(B, "conversations");
ok(convB[0].unread === 2 && convB[0].last.has_media, "conversation list");
const msgs = await run(B, "get_messages", { conv: dm.id, before: null });
ok(msgs.messages.length === 2 && msgs.reads[A] === msgs.messages[1].id && msgs.reads[B] === 0, "read receipts before reading");
await run(B, "mark_read", { conv: dm.id });
ok((await run(A, "get_messages", { conv: dm.id, before: null })).reads[B] === msgs.messages[1].id, "seen");
await run(B, "send_message", { conv: dm.id, body: "hi alice", media: [] });
await expectError("Add at least one person.", A, "create_group", { title: "Team", members: [A] });
const grp = await run(A, "create_group", { title: "Team", members: [B, C, C] });
await run(C, "send_message", { conv: grp.id, body: "hello team", media: [] });
await run(A, "conversations"); await run(C, "conversations"); await run(D, "conversations");
await run(A, "get_messages", { conv: grp.id, before: null });
await run(A, "badges");

console.log("Work: companies, jobs, applications");
await expectError("The page address is 2-40 letters, numbers or -.", C, "create_company", { name: "Acme", slug: "Acme Inc", about: "", website: "", logo_url: null });
const co = await run(C, "create_company", { name: "ACME", slug: "acme", about: "We make things", website: "https://acme.test", logo_url: null });
await expectError("That company already has a page.", D, "create_company", { name: "acme", slug: "acme-2", about: "", website: "", logo_url: null });
await run(D, "create_company", { name: "Dan Labs", slug: "dan-labs", about: "", website: "", logo_url: null });
const coPage = await run(A, "get_company", { slug: "acme" });
ok(coPage.people.length === 1 && coPage.people[0].title === "Engineer" && coPage.people[0].current, "existing experiences link to the new page");
await expectError("Only the company page owner can post jobs.", A, "create_job", { company: co.id, title: "Hacker", location: "", remote: true, type: "full_time", description: "" });
const job = await run(C, "create_job", { company: co.id, title: "Backend Engineer", location: "Pune", remote: true, type: "full_time", description: "Go + Postgres" });
await expectError("Pick a job type.", C, "create_job", { company: co.id, title: "X", location: "", remote: false, type: "gig", description: "" });
const job2 = await run(C, "create_job", { company: co.id, title: "Designer", location: "Remote", remote: true, type: "contract", description: "" });
await run(A, "list_jobs", { q: "", before: null }); await run(A, "list_jobs", { q: "acme", before: null }); await run(A, "list_jobs", { q: "pune", before: null });
await expectError("You manage this job.", C, "apply_job", { job: job.id, note: "" });
await run(B, "apply_job", { job: job.id, note: "I'm in" });
await expectError("You already applied.", B, "apply_job", { job: job.id, note: "again" });
await run(A, "apply_job", { job: job.id, note: "" });
const jb = await run(C, "get_job", { id: job.id });
ok(jb.applications.length === 2 && jb.applications[0].applicant.headline === "Engineer", "poster sees applicants");
ok((await run(B, "get_job", { id: job.id })).applications === null && (await run(B, "get_job", { id: job.id })).job.applied, "applicant sees only their own state");
await expectError("Application not found.", B, "set_application_status", { id: jb.applications[0].id, status: "offer" });
await run(C, "set_application_status", { id: jb.applications[0].id, status: "reviewing" });
await run(B, "my_applications");
await run(C, "close_job", { id: job2.id });
await expectError("This job is closed.", A, "apply_job", { job: job2.id, note: "" });
await run(A, "companies"); await run(B, "get_company", { slug: "acme" });
ok((await run(C, "my_companies")).length === 1 && (await run(A, "my_companies")).length === 0, "my companies");

console.log("Notifications, search, moderation, blocks");
const nb = await run(B, "notifications");
ok(nb.some(n => n.type === "like" && n.snippet === "hello world") && nb.some(n => n.type === "connect_accept" || n.type === "connect_request"), "notifications");
ok(!nb.some(n => n.actor.id === B), "no notifications for your own actions");
await run(C, "notifications"); await run(A, "notifications");
ok((await run(B, "badges")).notifications > 0, "unread badge");
await run(B, "mark_notifications_read");
ok((await run(B, "badges")).notifications === 0, "read");
const sr = await run(A, "search", { q: "building" });
ok(sr.videos.length === 1, "search finds the video by title");
await run(A, "search", { q: "a" }); await run(A, "search", { q: "100%" }); await run(A, "search", { q: "  " });
await expectError("Moderators only.", B, "mod_queue");
await run(B, "report", { type: "post", target: String(page1[1].id), reason: "spam" });
await run(C, "report", { type: "post", target: String(page1[1].id), reason: "spam again" });
await run(B, "report", { type: "profile", target: D, reason: "spammer" });
await expectError("You can report a post or a profile.", B, "report", { type: "chat", target: "1", reason: "x" });
const q = await run(A, "mod_queue");
ok(q.length === 3, "three open reports");
await run(A, "mod_resolve", { id: q[2].id, action: "remove" });
ok((await run(A, "mod_queue")).length === 1, "removing a post closes every report about it");
await expectError("Post not found.", B, "get_post", { id: page1[1].id });
await run(A, "mod_resolve", { id: q[0].id, action: "dismiss" });
await run(C, "block", { user: A });
await expectError("Profile not found.", A, "get_profile", { handle: "cara" });
ok((await run(C, "get_profile", { handle: "alice" })).rel.blocked, "blocker can still see who they blocked");
await expectError("Profile not found.", A, "follow", { user: C });
await expectError("Profile not found.", A, "open_dm", { user: C });
await run(A, "get_messages", { conv: grp.id, before: null }); // groups keep working
await run(A, "list_posts", { kind: "video", scope: "all", author: null, before: null });
await run(A, "search", { q: "cara" });
await run(C, "unblock", { user: A });
await run(A, "get_profile", { handle: "cara" });
await run(B, "delete_post", { id: n1.id });
await run(A, "list_posts", { kind: "note", scope: "following", author: null, before: null });
await run(A, "notifications");

/* ---------- Postgres-only: what the public key can and can't do ---------- */
if (pg) {
  console.log("Row level security");
  const asUser = async (uid, sql) => { try { await pg.query("begin"); await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]); const r = await pg.query(sql); await pg.query("commit"); return r.rows; }
    catch (e) { await pg.query("rollback"); return { error: e.message }; } };
  ok((await asUser(B, "select * from posts")).error?.includes("permission denied"), "posts are not readable directly");
  ok((await asUser(B, "select * from profiles")).error?.includes("permission denied"), "profiles are not readable directly");
  ok((await asUser(C, `select * from messages where conversation_id = ${dm.id}`)).length === 0, "outsiders can't read a DM");
  ok((await asUser(B, `select * from messages where conversation_id = ${dm.id}`)).length === 3, "members can (for Realtime)");
  ok((await asUser(B, "select distinct user_id from notifications")).every(r => r.user_id === B), "only your own notifications");
  ok((await asUser(B, "insert into messages (conversation_id, sender_id, body) values (1, '" + B + "', 'x')")).error?.includes("permission denied"), "no direct writes");
  await pg.query("begin"); await pg.query("set local role anon");
  ok(await pg.query("select public.badges()").then(() => false, () => true), "anon can't call functions"); await pg.query("rollback");
  ok((await asUser(B, `select public.notify('${A}', '${C}', 'like', null)`)).error?.includes("permission denied"), "helpers like notify can't be called directly");
  ok((await asUser(B, `select public.blocked('${A}', '${C}')`)).error?.includes("permission denied"), "nor can blocked()");
  await pg.cleanup();
}

console.log(`\n${steps} steps${pg ? `, ${compared} compared with Postgres` : ""}. ${failed ? failed + " FAILED" : "All passed."}`);
process.exit(failed ? 1 : 0);
