import { decryptPayload } from "./crypto.js";

const REMEMBER_KEY = "college-tracker.passcode.v1";
const THEME_KEY = "college-tracker.theme";
const STATUS_LABEL = {
  offer: "Offer",
  accepted: "Accepted",
  applied: "Applied",
  visited: "Visited",
  interested: "Interested",
  backup: "Backup",
  pending: "Pending",
  closed: "Closed"
};
const STATUS_RANK = {
  offer: 0,
  accepted: 1,
  applied: 2,
  visited: 3,
  interested: 4,
  backup: 5,
  pending: 6,
  closed: 7
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const app = document.querySelector("#app");
let loadState = "loading";
let loadError = "";
let unlockError = "";
let encPayload = null;
let tracker = null;
let pendingPasscode = "";
let booting = false;

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Private mode can reject storage. The in-memory session still locks. */
  }
}

function effectiveTheme() {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", effectiveTheme() === "dark" ? "#10161d" : "#f2f4f7");
}

function formatDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatGpa(gpa) {
  if (typeof gpa !== "number" || !Number.isFinite(gpa)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(gpa);
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || "Unknown";
}

function channelLabel(channel) {
  if (channel === "X DM") return "X DM";
  if (channel === "in-person") return "In person";
  if (!channel) return "";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function directionLabel(direction) {
  if (direction === "in") return "Received";
  if (direction === "out") return "Sent";
  return direction || "";
}

function subtitle(school) {
  return [school.location, school.level, ...(school.sports || [])].filter(Boolean).join(" · ");
}

function sortedSchools(schools) {
  return (schools || []).slice().sort((a, b) => {
    const priorityA = Number.isInteger(a.priority) ? a.priority : 9999;
    const priorityB = Number.isInteger(b.priority) ? b.priority : 9999;
    if (priorityA !== priorityB) return priorityA - priorityB;
    const statusA = STATUS_RANK[a.status] ?? 99;
    const statusB = STATUS_RANK[b.status] ?? 99;
    if (statusA !== statusB) return statusA - statusB;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function nextItem(school, upcoming) {
  const items = [];
  for (const step of school.nextSteps || []) {
    if (step?.text) items.push({ date: step.date || "", text: step.text });
  }
  for (const item of upcoming || []) {
    if (item && (item.school === school.name || item.school === school.id) && item.title) {
      items.push({ date: item.date || "", text: item.title });
    }
  }
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = `${item.date}|${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dated = unique.filter((item) => item.date).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();
  const future = dated.find((item) => item.date >= today);
  if (future) return future;
  if (dated.length) return dated[dated.length - 1];
  return unique.find((item) => item.text) || null;
}

function lastContact(school) {
  const dates = (school.comms || []).map((comm) => comm.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : "";
}

function schoolIdFromHash() {
  const match = /^#\/school\/([^/]+)$/.exec(location.hash);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function findSchool(label) {
  return (tracker?.schools || []).find((school) => school.name === label || school.id === label) || null;
}

function renderTopbar({ back = false, showLock = false } = {}) {
  const bar = document.createElement("header");
  bar.className = "topbar";
  if (back) {
    const link = document.createElement("a");
    link.className = "ghost";
    link.href = "#/";
    link.textContent = "Schools";
    bar.append(link, h("div", "spacer"));
  } else {
    bar.append(h("div", "brand", "College Tracker"));
  }
  const theme = document.createElement("button");
  theme.type = "button";
  theme.className = "ghost";
  theme.dataset.action = "theme";
  const dark = effectiveTheme() === "dark";
  theme.textContent = dark ? "Light" : "Dark";
  theme.setAttribute("aria-label", dark ? "Switch to light appearance" : "Switch to dark appearance");
  bar.append(theme);
  if (showLock) {
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "ghost";
    lock.dataset.action = "lock";
    lock.textContent = "Lock";
    bar.append(lock);
  }
  return bar;
}

function renderScreen(screen, { back = false, showLock = false, nodes }) {
  document.title = screen === "detail" ? document.title : "College Tracker";
  const page = document.createElement("div");
  page.className = "page";
  page.dataset.screen = screen;
  page.append(renderTopbar({ back, showLock }));
  const main = document.createElement("main");
  main.className = "main";
  for (const node of nodes) main.append(node);
  page.append(main);
  app.replaceChildren(page);
}

function renderLoading() {
  renderScreen("loading", { nodes: [h("p", "lede", "Loading the tracker…")] });
}

function renderUnlocking() {
  renderScreen("unlocking", { nodes: [h("h1", null, "Unlocking…"), h("p", "lede", "Checking the passcode saved on this device.")] });
}

function renderMissing() {
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary";
  retry.dataset.action = "retry";
  retry.textContent = "Check again";
  renderScreen("missing", {
    nodes: [
      h("h1", null, "No data yet"),
      h("p", "lede", "The encrypted tracker isn't on this copy of the app yet. After it is published, open the app again and enter the passcode."),
      retry
    ]
  });
}

function renderLoadError() {
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary";
  retry.dataset.action = "retry";
  retry.textContent = "Try again";
  renderScreen("error", {
    nodes: [h("h1", null, "Couldn't load"), h("p", "lede", loadError), retry]
  });
}

function renderLock() {
  const wrap = h("div", "stack lock");
  const mark = document.createElement("img");
  mark.className = "lock-mark";
  mark.src = "icons/icon-192.png";
  mark.alt = "";
  mark.width = 72;
  mark.height = 72;
  wrap.append(mark, h("h1", null, "College Tracker"), h("p", "lede", "Enter the passcode to open recruiting notes on this device."));

  const form = document.createElement("form");
  form.id = "unlock-form";
  form.className = "stack-form";
  const label = document.createElement("label");
  label.htmlFor = "passcode";
  label.textContent = "Passcode";
  const input = document.createElement("input");
  input.id = "passcode";
  input.name = "passcode";
  input.type = "password";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.enterKeyHint = "go";
  input.value = pendingPasscode;
  if (unlockError) input.setAttribute("aria-invalid", "true");
  if (unlockError) input.setAttribute("aria-describedby", "unlock-error");
  const rememberLabel = document.createElement("label");
  rememberLabel.className = "check";
  const remember = document.createElement("input");
  remember.type = "checkbox";
  remember.id = "remember";
  remember.name = "remember";
  remember.checked = Boolean(safeGet(REMEMBER_KEY));
  rememberLabel.append(remember, h("span", null, "Remember on this device"));
  const submit = document.createElement("button");
  submit.id = "unlock-submit";
  submit.className = "primary";
  submit.type = "submit";
  submit.textContent = "Unlock";
  form.append(label, input, rememberLabel, submit);
  wrap.append(form);
  if (unlockError) {
    const error = h("p", "error", unlockError);
    error.id = "unlock-error";
    error.dataset.error = "true";
    error.setAttribute("role", "alert");
    wrap.append(error);
  }
  wrap.append(h("p", "small muted", "The passcode stays on this phone. Remember keeps it in this browser until you tap Lock. Notes are decrypted here and are not sent to a server."));
  wrap.append(h("p", "small muted", "To install it, use the browser Share menu and choose Add to Home Screen."));
  renderScreen("lock", { nodes: [wrap] });
  if (unlockError) input.focus();
}

function pill(status) {
  const node = h("span", "pill", statusLabel(status));
  if (status) node.dataset.status = status;
  return node;
}

function renderList() {
  const profile = tracker.profile || {};
  const profileCard = h("section", "card stack");
  profileCard.append(h("p", "profile-name", profile.name || "Recruiting tracker"));
  const meta = [profile.classYear ? `Class of ${profile.classYear}` : "", formatGpa(profile.gpa) ? `GPA ${formatGpa(profile.gpa)}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (meta) profileCard.append(h("p", "muted", meta));
  if (tracker.lastUpdated) profileCard.append(h("p", "small muted", `Updated ${formatDate(tracker.lastUpdated)}`));
  if (profile.notes) profileCard.append(h("p", null, profile.notes));

  const nodes = [profileCard];
  const upcoming = (tracker.upcoming || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (upcoming.length) {
    const card = h("section", "card stack");
    card.append(h("h2", null, "Coming up"));
    for (const item of upcoming) {
      const school = findSchool(item.school);
      const row = document.createElement(school ? "a" : "div");
      row.className = "up-link";
      if (school) row.href = `#/school/${encodeURIComponent(school.id)}`;
      if (item.date) row.append(h("span", "when", formatDate(item.date)));
      row.append(h("span", null, item.title || "Upcoming"));
      if (item.school) row.append(h("span", "small muted", item.school));
      card.append(row);
    }
    nodes.push(card);
  }

  const schools = sortedSchools(tracker.schools);
  const heading = h("h1", null, "Schools");
  heading.append(h("span", "count", ` ${schools.length}`));
  nodes.push(heading);
  if (!schools.length) nodes.push(h("p", "empty", "No schools yet."));
  for (const school of schools) {
    const link = document.createElement("a");
    link.className = "school-card";
    link.href = `#/school/${encodeURIComponent(school.id)}`;
    const top = h("div", "card-top");
    top.append(h("h2", "school-name", school.name || "School"), pill(school.status));
    link.append(top);
    const line = subtitle(school);
    if (line) link.append(h("p", "small muted", line));
    const next = nextItem(school, tracker.upcoming);
    const today = todayISO();
    const nextLabel = next?.date && next.date < today ? "Latest step" : "Next";
    const nextText = next ? [next.text, next.date ? formatDate(next.date) : ""].filter(Boolean).join(" · ") : "None logged";
    const contact = lastContact(school);
    link.append(h("p", "small", `${nextLabel}: ${nextText}`));
    link.append(h("p", "small muted", contact ? `Last contact ${formatDate(contact)}` : "Last contact: none logged"));
    nodes.push(link);
  }
  renderScreen("list", { showLock: true, nodes });
}

function addFact(list, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  if (typeof value === "string") detail.textContent = value;
  else detail.append(value);
  list.append(term, detail);
}

function soFar(school) {
  const items = [];
  const application = school.application || {};
  if (application.decision) {
    items.push(`Decision: ${application.decision}${application.decisionDate ? ` (${formatDate(application.decisionDate)})` : ""}`);
  } else if (application.status) {
    items.push(`Application ${application.status}${application.submitted ? ` · submitted ${formatDate(application.submitted)}` : ""}`);
  }
  const visits = school.visits || [];
  if (visits.length) items.push(visits.length === 1 ? "1 visit" : `${visits.length} visits`);
  for (const scholarship of school.scholarships || []) {
    items.push([scholarship.name, scholarship.status].filter(Boolean).join(": "));
  }
  const contact = lastContact(school);
  items.push(contact ? `Last contact ${formatDate(contact)}` : "No contact logged");
  return items;
}

function offerBlock(school) {
  const wrap = h("div", "stack");
  const offers = school.offers || [];
  if (!offers.length) {
    wrap.append(h("p", null, "No offer logged"));
    return wrap;
  }
  for (const offer of offers) {
    const parts = [offer.sport, offer.type, offer.amount].filter(Boolean);
    let line = parts.join(" · ");
    if (offer.date) line += ` (${formatDate(offer.date)})`;
    wrap.append(h("p", null, line || "Offer logged"));
    if (offer.notes) wrap.append(h("p", "note", offer.notes));
  }
  return wrap;
}

function section(title, children, emptyText) {
  const block = h("section", "section");
  block.append(h("h2", null, title));
  if (!children.length) block.append(h("p", "empty", emptyText));
  else children.forEach((child) => block.append(child));
  return block;
}

function mailLink(email) {
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return h("span", null, email);
  const link = document.createElement("a");
  link.href = `mailto:${email}`;
  link.textContent = email;
  return link;
}

function phoneLink(phone) {
  if (!phone) return null;
  const dial = phone.replace(/[^\d+]/g, "");
  const link = document.createElement("a");
  link.href = `tel:${dial}`;
  link.textContent = phone;
  return link;
}

function renderDetail(school) {
  document.title = `${school.name} · College Tracker`;
  const intro = h("div", "stack");
  intro.append(h("h1", null, school.name || "School"));
  const line = subtitle(school);
  if (line) intro.append(h("p", "muted", line));

  const overview = h("section", "card");
  overview.id = "overview";
  overview.append(h("h2", null, "Overview"));
  const facts = document.createElement("dl");
  facts.className = "facts";
  addFact(facts, "Status", pill(school.status));
  addFact(facts, "Offer", offerBlock(school));
  const next = nextItem(school, tracker.upcoming);
  const today = todayISO();
  const nextLabel = next?.date && next.date < today ? "Latest step" : "Next";
  const nextText = next ? [next.text, next.date ? formatDate(next.date) : ""].filter(Boolean).join(" · ") : "None logged";
  addFact(facts, nextLabel, nextText);
  const done = document.createElement("ul");
  done.className = "stack";
  for (const item of soFar(school)) done.append(h("li", null, item));
  addFact(facts, "So far", done);
  overview.append(facts);

  const nodes = [intro, overview];
  if (school.engineeringNotes) {
    const note = h("section", "card callout stack");
    note.append(h("h2", null, "Engineering"), h("p", null, school.engineeringNotes));
    nodes.push(note);
  }

  const comms = (school.comms || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const timeline = document.createElement("ol");
  timeline.className = "timeline";
  for (const comm of comms) {
    const item = document.createElement("li");
    const meta = [formatDate(comm.date), channelLabel(comm.channel), directionLabel(comm.direction)].filter(Boolean).join(" · ");
    item.append(h("p", "small muted", meta));
    if (comm.with) item.append(h("p", "subhead", comm.with));
    if (comm.summary) item.append(h("p", null, comm.summary));
    timeline.append(item);
  }
  nodes.push(section("Communications", comms.length ? [timeline] : [], "No communications logged."));

  const visits = (school.visits || []).slice().sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
  const visitCards = visits.map((visit) => {
    const card = h("article", "subcard stack");
    const title = [visit.type, visit.date ? formatDate(visit.date) : ""].filter(Boolean).join(" · ");
    card.append(h("p", "subhead", title || "Visit"));
    if (visit.notes) card.append(h("p", null, visit.notes));
    return card;
  });
  nodes.push(section("Visits", visitCards, "No visits logged."));

  const applicationCards = [];
  const application = school.application || {};
  const applicationRows = [
    ["Status", application.status],
    ["Submitted", application.submitted ? formatDate(application.submitted) : ""],
    ["Decision", application.decision],
    ["Decision date", application.decisionDate ? formatDate(application.decisionDate) : ""]
  ].filter(([, value]) => value);
  if (applicationRows.length) {
    const card = h("article", "subcard");
    const list = document.createElement("dl");
    list.className = "facts";
    for (const [label, value] of applicationRows) addFact(list, label, value);
    card.append(h("p", "subhead", "Application"), list);
    applicationCards.push(card);
  }
  for (const scholarship of school.scholarships || []) {
    const card = h("article", "subcard stack");
    card.append(h("p", "subhead", scholarship.name || "Scholarship"));
    if (scholarship.status) card.append(h("p", null, scholarship.status));
    if (scholarship.notes) card.append(h("p", "note", scholarship.notes));
    applicationCards.push(card);
  }
  nodes.push(section("Application and scholarships", applicationCards, "No application or scholarships logged."));

  const contactCards = (school.contacts || []).map((contact) => {
    const card = h("article", "subcard contact stack");
    card.append(h("p", "subhead", contact.name || "Contact"));
    const role = [contact.role, contact.sport].filter(Boolean).join(" · ");
    if (role) card.append(h("p", "muted", role));
    const email = mailLink(contact.email);
    const phone = phoneLink(contact.phone);
    if (email) card.append(email);
    if (phone) card.append(phone);
    return card;
  });
  nodes.push(section("Contacts", contactCards, "No contacts logged."));

  renderScreen("detail", { back: true, showLock: true, nodes });
}

function renderNotFound() {
  const back = document.createElement("a");
  back.className = "primary";
  back.href = "#/";
  back.textContent = "Back to schools";
  renderScreen("missing-school", {
    showLock: true,
    nodes: [h("h1", null, "School not found"), h("p", "lede", "That school isn't in the unlocked tracker."), back]
  });
}

function render() {
  if (loadState === "loading") return renderLoading();
  if (loadState === "missing") return renderMissing();
  if (loadState === "error") return renderLoadError();
  if (!tracker) return renderLock();
  const id = schoolIdFromHash();
  if (!id) return renderList();
  const school = (tracker.schools || []).find((item) => item.id === id);
  if (!school) return renderNotFound();
  return renderDetail(school);
}

async function fetchEnc() {
  const url = new URL("data/tracker.enc.json", document.baseURI);
  url.searchParams.set("t", String(Date.now()));
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return { missing: true };
  if (!response.ok) throw new Error(String(response.status));
  return { missing: false, payload: await response.json() };
}

async function tryUnlock(passcode, { remember = false, auto = false } = {}) {
  const submit = document.getElementById("unlock-submit");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Unlocking…";
  }
  try {
    const data = await decryptPayload(encPayload, passcode);
    if (!data?.profile || !Array.isArray(data.schools)) {
      throw Object.assign(new Error("The file unlocked, but it isn't a tracker."), { code: "SHAPE" });
    }
    if (remember) {
      const saved = safeSet(REMEMBER_KEY, passcode);
      if (!saved) unlockError = "This browser blocked saving the passcode. It is unlocked for this visit only.";
      else unlockError = "";
    } else {
      safeRemove(REMEMBER_KEY);
      unlockError = "";
    }
    pendingPasscode = "";
    tracker = data;
    render();
  } catch (err) {
    tracker = null;
    pendingPasscode = auto ? "" : passcode;
    if (err && err.code === "SHAPE") unlockError = err.message;
    else if (err && err.code === "FORMAT") unlockError = "This tracker file isn't supported.";
    else if (auto) unlockError = "The saved passcode didn't unlock the tracker. Enter it again.";
    else unlockError = "That passcode didn't unlock the tracker. Try again.";
    if (auto) safeRemove(REMEMBER_KEY);
    render();
  }
}

async function boot() {
  if (booting) return;
  booting = true;
  loadState = "loading";
  tracker = null;
  unlockError = "";
  render();
  try {
    const result = await fetchEnc();
    if (result.missing) {
      loadState = "missing";
      encPayload = null;
      return;
    }
    encPayload = result.payload;
    loadState = "ready";
    const saved = safeGet(REMEMBER_KEY);
    if (saved) {
      renderUnlocking();
      await tryUnlock(saved, { remember: true, auto: true });
      return;
    }
  } catch {
    loadState = "error";
    loadError = "Couldn't load the tracker. Check your connection and try again.";
  } finally {
    booting = false;
    if (!tracker) render();
  }
}

function toggleTheme() {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  safeSet(THEME_KEY, next);
  applyTheme(next);
  const button = document.querySelector("[data-action='theme']");
  if (!button) return;
  const dark = next === "dark";
  button.textContent = dark ? "Light" : "Dark";
  button.setAttribute("aria-label", dark ? "Switch to light appearance" : "Switch to dark appearance");
}

function doLock() {
  tracker = null;
  pendingPasscode = "";
  unlockError = "";
  safeRemove(REMEMBER_KEY);
  if (location.hash && location.hash !== "#/") location.hash = "#/";
  boot();
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target) return;
  if (target.dataset.action === "theme") toggleTheme();
  else if (target.dataset.action === "lock") doLock();
  else if (target.dataset.action === "retry") boot();
});

app.addEventListener("submit", (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== "unlock-form") return;
  event.preventDefault();
  const passcode = String(new FormData(event.target).get("passcode") || "");
  const remember = Boolean(event.target.remember?.checked);
  pendingPasscode = passcode;
  if (!passcode) {
    unlockError = "Enter a passcode.";
    render();
    return;
  }
  tryUnlock(passcode, { remember });
});

window.addEventListener("hashchange", () => {
  if (!booting) render();
});

applyTheme(safeGet(THEME_KEY));
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {});
}
boot();
