/* End-to-end run of the real app in offline mode: two people in two tabs of one browser go through every mode.
   Run with: npm run e2e   (needs Playwright's Chromium; screenshots land in tests/shots/) */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, ".."), shots = path.join(root, "tests/shots");
fs.mkdirSync(shots, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/?offline`;

let failed = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) failed++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
const errors = [];
const page = async name => { const p = await ctx.newPage(); p.on("pageerror", e => errors.push(name + ": " + e.message)); p.on("console", m => m.type() === "error" && errors.push(name + ": " + m.text())); await p.goto(URL_); return p; };
const fixture = f => path.join(root, "tests/fixtures", f);
const shot = (p, n) => p.screenshot({ path: path.join(shots, n + ".png") });
const pick = async (p, click, files) => { const [fc] = await Promise.all([p.waitForEvent("filechooser"), click()]); await fc.setFiles(files.map(fixture)); };

async function signUp(p, email, name, handle) {
  await p.click("text=New here? Create an account");
  await p.fill("input[name=email]", email); await p.fill("input[name=password]", "password123"); await p.click("button:has-text('Sign up')");
  await p.fill("input[name=name]", name); await p.fill("input[name=handle]", handle); await p.click("button:has-text('Continue')");
  await p.waitForSelector(".tabs");
}

try {
  console.log("Accounts");
  const A = await page("alice");
  await shot(A, "01-login");
  await signUp(A, "alice@example.com", "Alice Ng", "alice");
  ok(await A.isVisible("text=Your timeline is empty"), "Alice lands on an empty Feed");
  const B = await page("bob");
  ok(await B.isVisible("text=Log in"), "a second tab is signed out (sessions are per tab)");
  await signUp(B, "bob@example.com", "Bob Ray", "bob");

  console.log("Feed");
  await A.click(".composer"); await A.fill(".compose textarea", "Hello from Sin! #launch @bob"); await A.click(".compose button:has-text('Post')");
  await A.waitForSelector(".post-body:has-text('Hello from Sin')");
  ok(await A.isVisible(".post-body a:has-text('@bob')"), "@mentions and #tags are links");
  await B.goto(URL_ + "#/feed?s=all"); await B.waitForSelector(".post-body:has-text('Hello from Sin')");
  ok(true, "Bob sees Alice's post on Explore");
  await B.click(".mini-person button:has-text('Follow')");
  await B.click("[data-act=like]"); await B.waitForSelector(".on-like");
  await B.click("[data-act=repost]"); await B.waitForSelector(".on-repost");
  await B.goto(URL_ + "#/feed"); await B.waitForSelector(".reposted");
  ok(await B.isVisible(".reposted:has-text('You reposted')"), "repost shows on Bob's timeline");
  await B.click(".post-body >> nth=0", { position: { x: 4, y: 8 } }); await B.waitForSelector(".reply-box");
  await B.fill(".reply-box textarea", "Welcome!"); await B.click(".reply-box button"); await B.waitForSelector(".post-body:has-text('Welcome!')");
  ok(true, "reply posted in the thread");
  await shot(B, "02-thread");

  console.log("Notifications");
  await A.waitForSelector("#nb:not([hidden])", { timeout: 5000 });
  ok(true, "Alice's bell shows a badge live");
  await A.click("[aria-label=Notifications]"); await A.waitForSelector(".note");
  const notes = await A.locator(".note").allInnerTexts();
  ok(["followed you", "liked your post", "reposted your post", "replied to your post"].every(t => notes.some(n => n.includes(t))), "follow, like, repost and reply notifications");
  await shot(A, "03-notifications");

  console.log("Photos and stories");
  await A.click(".tabs a[data-mode=photos]"); await A.waitForSelector(".stories");
  await pick(A, () => A.click(".fab"), ["photo.png", "photo2.jpg"]);
  await A.waitForSelector(".previews img >> nth=1");
  await A.fill(".compose textarea", "Sunset colours"); await A.click(".compose button:has-text('Post')");
  await A.waitForSelector(".photo-post");
  const nat = await A.locator(".photo-post .carousel img").first().evaluate(i => new Promise(r => i.complete && i.naturalWidth ? r(i.naturalWidth) : (i.onload = () => r(i.naturalWidth))));
  ok(nat === 1080, "photos are resized to 1080px before upload (got " + nat + ")");
  await pick(A, () => A.click(".story >> nth=0"), ["photo2.jpg"]);
  await A.waitForSelector(".story:not(.ring) .av"); await A.waitForTimeout(300);
  await B.goto(URL_ + "#/photos"); await B.waitForSelector(".photo-post");
  ok(await B.isVisible(".story.ring"), "Bob sees Alice's story ring");
  await B.click(".story.ring"); await B.waitForSelector(".story-view img");
  await shot(B, "04-story"); await B.click(".story-view .close");
  await shot(B, "05-photos");
  await A.goto(URL_ + "#/u/alice?tab=photo"); await A.waitForSelector(".grid a");
  ok(await A.locator(".grid a").count() === 1, "profile photo grid");

  console.log("Video");
  await A.click(".tabs a[data-mode=video]"); await A.waitForSelector(".fab");
  await pick(A, () => A.click(".fab"), ["clip.webm"]);
  await A.waitForSelector(".previews img", { timeout: 15000 });
  await A.fill(".compose input[name=title]", "Building Sin in a day"); await A.fill(".compose textarea", "How it works");
  await A.click(".compose button:has-text('Post')"); await A.waitForSelector(".watch video");
  ok(await A.isVisible("h2:has-text('Building Sin in a day')"), "upload goes straight to the watch page");
  await B.goto(URL_ + "#/video"); await B.waitForSelector(".vtile");
  ok((await B.locator(".vtile .dur").innerText()) === "0:03", "duration read from the file");
  await B.click(".vtile .vtitle"); await B.waitForSelector(".watch video");
  await B.evaluate(() => { const v = document.querySelector(".watch video"); v.muted = true; return v.play(); });
  await B.waitForTimeout(1200);
  ok(await B.isVisible("[data-act=sub]:has-text('Subscribed')"), "following on Feed = subscribed on Video (one graph)");
  await B.click("[data-act=sub]"); await B.waitForSelector("[data-act=sub]:text-is('Subscribe')");
  await B.click("[data-act=sub]"); await B.waitForSelector("[data-act=sub]:has-text('Subscribed')");
  await B.fill(".reply-box textarea", "Great video"); await B.click(".reply-box button"); await B.waitForSelector(".post-body:has-text('Great video')");
  await B.click("[data-act=save]"); await B.fill("[data-new] input", "Watch later"); await B.click("[data-new] button");
  await shot(B, "06-watch");
  await B.goto(URL_ + "#/library"); await B.waitForSelector(".hist");
  ok(await B.isVisible("text=Watch later"), "playlist saved"); ok(await B.locator(".hist").count() === 1, "watch history recorded");
  await shot(B, "07-library");

  console.log("Chat");
  await A.goto(URL_ + "#/u/bob"); await A.click("[data-act=message]"); await A.waitForSelector(".msg-box");
  await A.fill(".msg-box textarea", "Hey Bob 👋"); await A.press(".msg-box textarea", "Enter");
  await A.waitForSelector(".msg.me"); ok(await A.isVisible(".seen:has-text('Sent')"), "sent");
  await B.waitForSelector("#mb:not([hidden])", { timeout: 5000 }); ok(true, "Bob's Chat tab shows an unread badge live");
  await B.click(".tabs a[data-mode=chat]"); await B.waitForSelector(".conv.unread"); await B.click(".conv");
  await B.waitForSelector(".msg:has-text('Hey Bob')");
  await A.waitForSelector(".seen:has-text('Seen')", { timeout: 5000 }); ok(true, "read receipt reaches Alice live");
  await B.fill(".msg-box textarea", "Hi Alice!"); await B.press(".msg-box textarea", "Enter");
  await A.waitForSelector(".msg:not(.me):has-text('Hi Alice!')", { timeout: 5000 }); ok(true, "message delivered live");
  await pick(B, () => B.click("[data-act=attach]"), ["photo2.jpg"]); await B.waitForSelector(".msg.me img");
  ok(true, "photo shared in chat");
  await shot(A, "08-chat");

  console.log("Work");
  await A.goto(URL_ + "#/settings"); await A.waitForSelector("[data-form=pro]");
  await A.fill("[name=headline]", "Founder at Sinworks"); await A.fill("[name=skills]", "Product, Postgres, product"); await A.click("[data-form=pro] button");
  await A.fill("[data-form=exp] [name=title]", "Founder"); await A.fill("[data-form=exp] [name=company_name]", "Sinworks"); await A.fill("[data-form=exp] [name=start_date]", "2024-01-01");
  await A.click("[data-form=exp] button"); await A.waitForTimeout(200);
  await A.goto(URL_ + "#/work"); await A.click(".fab");
  await A.fill(".sheet [name=name]", "Sinworks"); ok(await A.inputValue(".sheet [name=slug]") === "sinworks", "page address follows the name");
  await A.click(".sheet button:has-text('Create page')"); await A.waitForSelector("h2:has-text('Sinworks')");
  ok(await A.isVisible(".person:has-text('Founder')"), "Alice's experience links to the new company page");
  await A.click("[data-act=post-job]"); await A.fill(".sheet [name=title]", "Frontend Engineer"); await A.fill(".sheet [name=location]", "Pune");
  await A.check(".sheet [name=remote]"); await A.click(".sheet button:has-text('Post job')"); await A.waitForSelector("h2:has-text('Frontend Engineer')");
  await B.goto(URL_ + "#/u/alice?as=work"); await B.waitForSelector("text=Founder at Sinworks");
  ok(await B.isVisible(".chip:has-text('Product')") && await B.locator(".chip:has-text('product')").count() === 1, "professional profile with de-duplicated skills");
  await B.click("[data-act=connect]"); await B.waitForSelector("[data-act=connect]:has-text('Requested')");
  await shot(B, "09-pro-profile");
  await B.goto(URL_ + "#/work"); await B.click(".job:has-text('Frontend Engineer')"); await B.fill("[name=note]", "I'd love to help"); await B.click("button:has-text('Apply')");
  await B.waitForSelector(".chip:has-text('Applied')");
  await A.goto(URL_ + "#/network"); await A.click("[data-act=accept]"); await A.waitForSelector("h3:has-text('Connections') + .person, .person:has-text('Bob')");
  await A.goto(URL_ + "#/work"); await A.click(".job:has-text('Frontend Engineer')"); await A.waitForSelector("[data-app]");
  await A.selectOption("[data-app]", "offer"); await A.waitForTimeout(200);
  await B.goto(URL_ + "#/applications"); await B.waitForSelector("text=Offer");
  ok(true, "apply → applicant list → status update reaches the applicant");
  await shot(A, "10-work");

  console.log("Search, moderation, blocking");
  await B.goto(URL_ + "#/search?q=sin"); await B.waitForSelector("h4:has-text('Videos')");
  ok(await B.isVisible("h4:has-text('Companies')") && await B.isVisible("h4:has-text('Jobs')"), "one search across every mode");
  await shot(B, "11-search");
  await B.goto(URL_ + "#/feed?s=all"); await B.click(".post:has-text('Hello from Sin') [data-act=post-menu] >> nth=0");
  await B.click("button:has-text('Report')"); await B.fill(".sheet input", "test report"); await B.click(".sheet button:has-text('OK')");
  await A.goto(URL_ + "#/mod"); await A.waitForSelector("text=test report");
  ok(true, "first account moderates; report reaches the queue");
  await A.click("[data-a=dismiss]"); await A.waitForSelector("text=Nothing to review");
  await B.goto(URL_ + "#/u/alice"); await B.click("[data-act=pmenu]"); await B.click("button:has-text('Block')"); await B.click(".sheet [data-yes]");
  await B.waitForSelector("[data-act=unblock]");
  await A.goto(URL_ + "#/u/bob"); await A.waitForSelector(".empty");
  ok(await A.isVisible("text=Profile not found."), "blocked person can't see the blocker's profile");
  await B.click("[data-act=unblock]");

  console.log("Forgot and change password");
  await B.goto(URL_ + "#/feed"); await B.click("#me-av"); await B.waitForSelector(".menu.account");
  ok(await B.isVisible(".menu.account >> text=Settings and password"), "your photo opens the account menu");
  await B.click(".menu.account >> text=Log out"); await B.waitForSelector("#auth");
  ok(await B.isVisible("text=Log in") && !(await B.isVisible(".tabs")), "log out from the account menu");
  await B.fill("[name=email]", "bob@example.com"); await B.click("#forgot"); await B.waitForSelector("#fp");
  ok(await B.inputValue("#fp [name=email]") === "bob@example.com", "forgot screen keeps the typed email");
  await B.click("#fp button"); await B.waitForSelector("text=Check your email");
  await B.click("#offline-link"); await B.waitForSelector("#np");
  await B.fill("#np [name=password]", "newpass123"); await B.fill("#np [name=again]", "different1"); await B.click("#np button");
  ok(await B.isVisible("text=The two passwords don't match."), "mismatched passwords are caught");
  await B.fill("#np [name=again]", "newpass123"); await B.click("#np button"); await B.waitForSelector(".tabs");
  ok(true, "reset link signs you in after choosing a new password");
  await B.goto(URL_ + "#/settings"); await B.click("[data-act=signout]"); await B.waitForSelector("#auth");
  await B.fill("[name=email]", "bob@example.com"); await B.fill("[name=password]", "password123"); await B.click("#auth button.btn");
  await B.waitForSelector("text=Wrong email or password."); ok(true, "old password no longer works");
  await B.fill("[name=password]", "newpass123"); await B.click("#auth button.btn"); await B.waitForSelector(".tabs"); ok(true, "new password works");
  await B.goto(URL_ + "#/settings"); await B.fill("[data-form=password] [name=password]", "third-pass1"); await B.fill("[data-form=password] [name=again]", "third-pass1");
  await B.click("[data-form=password] button"); await B.waitForSelector("text=Password changed");
  await B.click("[data-act=signout]"); await B.waitForSelector("#auth"); await B.fill("[name=email]", "bob@example.com"); await B.fill("[name=password]", "third-pass1");
  await B.click("#auth button.btn"); await B.waitForSelector(".tabs"); ok(true, "change password from Settings");
  await B.goto(URL_ + "#/settings"); await B.click("[data-act=signout]"); await B.waitForSelector("#auth");
  await B.goto(URL_ + "#/reset/0123456789abcdef"); await B.reload(); await B.waitForSelector("#auth");
  ok(await B.isVisible("text=That reset link has expired or was already used."), "a used or made-up reset link is refused");
  await B.fill("[name=email]", "bob@example.com"); await B.fill("[name=password]", "third-pass1"); await B.click("#auth button.btn"); await B.waitForSelector(".tabs");
  console.log("Desktop layout");
  const D = await ctx.newPage(); await D.setViewportSize({ width: 1280, height: 800 }); await D.goto(URL_);
  await signUp(D, "cara@example.com", "Cara Diaz", "cara");
  await D.goto(URL_ + "#/feed?s=all"); await D.waitForSelector(".post"); await shot(D, "12-desktop-feed");
  await D.goto(URL_ + "#/video"); await D.waitForSelector(".vtile"); await D.click(".vtile .vtitle"); await D.waitForSelector(".watch"); await shot(D, "13-desktop-watch");
  await D.click(".rail-out"); await D.waitForSelector("#auth"); ok(true, "log out from the side menu on a laptop");

  ok(errors.length === 0, "no errors in the console" + (errors.length ? ":\n    " + errors.join("\n    ") : ""));
} catch (e) {
  failed++; console.log("  FAIL " + e.message.split("\n")[0]);
  for (const p of ctx.pages()) await p.screenshot({ path: path.join(shots, "failure-" + ctx.pages().indexOf(p) + ".png") }).catch(() => { });
  if (errors.length) console.log("  console errors:\n    " + errors.join("\n    "));
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nAll passed.");
process.exit(failed ? 1 : 0);
