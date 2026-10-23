/* Work (LinkedIn-style): the professional side of the same account. Connections, jobs, applications, company pages.
   The work profile itself (headline, experience, skills) is the Professional tab of every profile. */
import { api } from "../api.js";
import { html, icon, avatar, ago, rich, empty, sheet, toast, plural, confirmSheet } from "../ui.js";
import { on, draw, go, route, ctx } from "../main.js";
import { more, moreBtn } from "./feed.js";

export const routes = { work: home, "job/:id": job, "company/:slug": company, companies, network, applications };

const TYPE = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };
const STATUS = { submitted: "Submitted", reviewing: "In review", rejected: "Not selected", offer: "Offer" };
const logo = (c, size = 44) => c.logo_url ? html`<img class="logo-img" style="width:${size}px;height:${size}px" data-src="${c.logo_url}" alt="">`
  : html`<span class="logo-img av-txt" style="width:${size}px;height:${size}px">${c.name.slice(0, 1).toUpperCase()}</span>`;
export const jobRow = j => html`<a class="job" href="#/job/${j.id}">${logo(j.company)}<div class="grow"><b>${j.title}</b><div>${j.company.name}</div>
  <div class="muted small">${[j.location, j.remote ? "Remote" : "", TYPE[j.employment_type]].filter(Boolean).join(" · ")} · ${ago(j.created_at)}</div></div>
  ${j.applied ? html`<span class="chip ok">Applied</span>` : !j.open ? html`<span class="chip">Closed</span>` : ""}</a>`;
const nav = on_ => html`<div class="seg">${[["work", "Jobs"], ["network", "Network"], ["applications", "Applied"], ["companies", "Companies"]].map(([r, l]) => html`<a class="${on_ === r ? "on" : ""}" href="#/${r}">${l}</a>`)}</div>`;

async function home(el, { q }) {
  const term = q.get("q") || "";
  const fetch = before => api.list_jobs({ q: term, before: before || null });
  const [jobs, me] = await Promise.all([fetch(), api.get_profile({ handle: ctx.me.handle })]);
  const pro = me.pro;
  draw(el, html`${nav("work")}
    <a class="card pro-card" href="#/u/${ctx.me.handle}?tab=work">${avatar(ctx.me, 48)}<div class="grow"><b>${ctx.me.name}</b>
      <div class="muted small">${pro.headline || "Add a headline, experience and skills"}</div><div class="muted small">${plural(me.counts.connections, "connection")}</div></div>
      ${pro.open_to_work ? html`<span class="chip ok">Open to work</span>` : ""}</a>
    <form class="pad" data-form="find"><input type="search" name="q" value="${term}" placeholder="Search jobs by title, company or place" aria-label="Search jobs"></form>
    ${jobs.length ? jobs.map(jobRow) : empty(term ? `No open jobs match "${term}".` : "No open jobs yet. Companies post them from their page.")}${moreBtn(jobs)}
    <button class="fab" data-act="post-job" aria-label="Post a job">${icon("plus")}</button>`);
  on({ find: (f, v) => go("#/work?q=" + encodeURIComponent(v.q.trim())), more: more(el, fetch, jobRow), "post-job": postJob });
}

/* posting a job needs a company page you own; offers to make one */
async function postJob() {
  const owned = await api.my_companies();
  if (!owned.length) return newCompany();
  const s = sheet(html`<form class="stack"><div class="row"><h3 class="grow">Post a job</h3><button type="button" class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div>
    <label>Company<select name="company">${owned.map(c => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
    <label>Title<input name="title" required maxlength="100" autofocus></label>
    <div class="row"><label class="grow">Location<input name="location" maxlength="80"></label>
      <label class="grow">Type<select name="type">${Object.entries(TYPE).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label></div>
    <label class="check"><input type="checkbox" name="remote"> Remote OK</label>
    <label>Description<textarea name="description" rows="5" maxlength="5000"></textarea></label><button class="btn">Post job</button></form>`);
  s.el.querySelector("form").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { const j = await api.create_job({ company: +f.company.value, title: f.title.value, location: f.location.value, remote: f.remote.checked, type: f.type.value, description: f.description.value });
      s.close(); go("#/job/" + j.id); } catch (err) { toast(err.message, true); }
  };
}

function newCompany() {
  const s = sheet(html`<form class="stack"><div class="row"><h3 class="grow">Create a company page</h3><button type="button" class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div>
    <p class="muted small">Jobs are posted from a company page. People who list this company in their experience appear on it.</p>
    <label>Name<input name="name" required maxlength="80" autofocus></label>
    <label>Page address<input name="slug" required pattern="[a-z0-9\\-]{2,40}" maxlength="40" placeholder="acme"></label>
    <label>Website<input name="website" type="url" placeholder="https://"></label>
    <label>About<textarea name="about" rows="3" maxlength="2000"></textarea></label><button class="btn">Create page</button></form>`);
  const f = s.el.querySelector("form");
  f.name.oninput = () => { if (!f.slug.dataset.touched) f.slug.value = f.name.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); };
  f.slug.oninput = () => (f.slug.dataset.touched = 1);
  f.onsubmit = async e => {
    e.preventDefault();
    try { const c = await api.create_company({ name: f.name.value, slug: f.slug.value, about: f.about.value, website: f.website.value, logo_url: null }); s.close(); go("#/company/" + c.slug); }
    catch (err) { toast(err.message, true); }
  };
}

async function job(el, { id }) {
  const d = await api.get_job({ id: +id }), j = d.job;
  draw(el, html`<div class="bar"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><b>Job</b></div>
    <section class="card stack"><div class="row">${logo(j.company, 56)}<div class="grow"><h2>${j.title}</h2><a href="#/company/${j.company.slug}">${j.company.name}</a></div></div>
      <div class="row wrap">${j.location ? html`<span class="chip">${j.location}</span>` : ""}${j.remote ? html`<span class="chip">Remote</span>` : ""}<span class="chip">${TYPE[j.employment_type]}</span>
        <span class="muted small">${ago(j.created_at)} · ${plural(j.applicants, "applicant")}</span></div>
      ${j.description ? html`<div>${rich(j.description)}</div>` : ""}
      ${!j.open ? html`<p class="chip">No longer accepting applications</p>` : j.can_manage ? html`<button class="btn ghost" data-act="close">Close job</button>`
        : j.applied ? html`<p class="chip ok">${icon("check")} Applied</p>`
        : html`<form class="stack" data-form="apply"><label>Note to the hiring team (optional)<textarea name="note" rows="3" maxlength="2000"></textarea></label>
            <p class="muted small">They'll see your professional profile: headline, experience and skills.</p><button class="btn">Apply</button></form>`}
    </section>
    ${d.applications ? html`<h3 class="pad">Applicants</h3>${d.applications.length ? d.applications.map(a => html`<div class="card stack">
      <a class="person" href="#/u/${a.applicant.handle}?as=work">${avatar(a.applicant, 40)}<div><b>${a.applicant.name}</b><div class="muted small">${a.applicant.headline}</div></div></a>
      ${a.note ? html`<p>${a.note}</p>` : ""}
      <div class="row"><span class="muted small grow">${ago(a.created_at)}</span><select data-app="${a.id}" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => html`<option value="${k}" ${a.status === k ? "selected" : ""}>${l}</option>`)}</select>
        <button class="btn small ghost" data-act="msg" data-id="${a.applicant.id}">Message</button></div></div>`) : html`<p class="muted pad">No applicants yet.</p>`}` : ""}`);
  for (const sel of el.querySelectorAll("[data-app]")) sel.onchange = async () => {
    try { await api.set_application_status({ id: +sel.dataset.app, status: sel.value }); toast("Updated"); } catch (e) { toast(e.message, true); }
  };
  on({
    apply: async (f, v) => { await api.apply_job({ job: j.id, note: v.note }); toast("Application sent"); route(); },
    close: async () => { if (await confirmSheet("Close this job? No one else can apply.", "Close job")) { await api.close_job({ id: j.id }); route(); } },
    msg: async b => { const c = await api.open_dm({ user: b.dataset.id }); go("#/chat/" + c.id); },
  });
}

async function company(el, { slug }) {
  const d = await api.get_company({ slug }), c = d.company;
  draw(el, html`<section class="card stack"><div class="row">${logo(c, 64)}<div class="grow"><h2>${c.name}</h2>
      ${c.website ? html`<a href="${/^https?:\/\//.test(c.website) ? c.website : "https://" + c.website}" target="_blank" rel="noopener noreferrer" class="small">${c.website}</a>` : ""}</div></div>
    ${c.about ? html`<p>${rich(c.about)}</p>` : ""}${d.owner ? html`<button class="btn" data-act="post-job">${icon("plus")} Post a job</button>` : ""}</section>
    <h3 class="pad">Open jobs</h3>${d.jobs.filter(j => j.open).length ? d.jobs.filter(j => j.open).map(jobRow) : html`<p class="muted pad">No open jobs.</p>`}
    <h3 class="pad">People</h3>${d.people.length ? d.people.map(u => html`<a class="person" href="#/u/${u.handle}?as=work">${avatar(u, 40)}<div><b>${u.name}</b>
      <div class="muted small">${u.title}${u.current ? "" : " (former)"}</div></div></a>`) : html`<p class="muted pad">Nobody lists ${c.name} in their experience yet.</p>`}`);
  on({ "post-job": postJob });
}

async function companies(el) {
  const list = await api.companies();
  draw(el, html`${nav("companies")}<div class="pad"><button class="btn" data-act="new-co">${icon("plus")} Create a company page</button></div>
    ${list.length ? list.map(c => html`<a class="job" href="#/company/${c.slug}">${logo(c)}<div class="grow"><b>${c.name}</b><div class="muted small clip">${c.about}</div></div></a>`) : empty("No company pages yet.")}`);
  on({ "new-co": newCompany });
}

async function network(el) {
  const n = await api.my_network();
  const person = (u, btns) => html`<div class="person"><a href="#/u/${u.handle}?as=work">${avatar(u, 44)}</a><a class="grow" href="#/u/${u.handle}?as=work"><b>${u.name}</b>
    <div class="muted small">${u.headline || "@" + u.handle}</div></a>${btns}</div>`;
  draw(el, html`${nav("network")}
    ${n.incoming.length ? html`<h3 class="pad">Invitations</h3>${n.incoming.map(u => person(u, html`<button class="btn small ghost" data-act="ignore" data-id="${u.id}">Ignore</button>
      <button class="btn small" data-act="accept" data-id="${u.id}">Accept</button>`))}` : ""}
    <h3 class="pad">Connections</h3>${n.connected.length ? n.connected.map(u => person(u, html`<button class="btn small ghost" data-act="msg" data-id="${u.id}">Message</button>`))
      : html`<p class="muted pad">Connect with people from their profile's Connect button.</p>`}
    ${n.outgoing.length ? html`<h3 class="pad">Sent</h3>${n.outgoing.map(u => person(u, html`<button class="btn small ghost" data-act="ignore" data-id="${u.id}">Withdraw</button>`))}` : ""}`);
  on({
    accept: async b => { await api.connect({ user: b.dataset.id }); route(); },
    ignore: async b => { await api.disconnect({ user: b.dataset.id }); route(); },
    msg: async b => { const c = await api.open_dm({ user: b.dataset.id }); go("#/chat/" + c.id); },
  });
}

async function applications(el) {
  const list = await api.my_applications();
  draw(el, html`${nav("applications")}${list.length ? list.map(a => html`<div class="app-row">${jobRow(a.job)}<div class="pad small">Status: <b>${STATUS[a.status]}</b> · applied ${ago(a.created_at)}</div></div>`)
    : empty("You haven't applied to any jobs yet.", html`<a class="btn" href="#/work">Browse jobs</a>`)}`);
}
