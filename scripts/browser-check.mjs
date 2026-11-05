// Headless phone-width check. Uses the fake example file and a throwaway passcode.
// Requires puppeteer-core plus Chrome:
//   CHROME_PATH=/usr/local/bin/google-chrome node scripts/browser-check.mjs --out /tmp/shots

import { webcrypto } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { encryptFile } = await import("./encrypt.mjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = process.argv.includes("--out")
  ? path.resolve(process.argv[process.argv.indexOf("--out") + 1])
  : path.join(tmpdir(), "college-tracker-shots");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const hooks = [];
let failPosts = false;

function chicagoToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function waitForHook(predicate, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = hooks.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const summary = hooks.map((hook) => `${hook.status} ${hook.body?.todoId || "?"}`).join(", ");
  throw new Error(`webhook timeout (${summary || "no requests"})`);
}

function startServer(siteRoot) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/hooks/done" && (request.method === "POST" || request.method === "OPTIONS")) {
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type"
          }).end();
          return;
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          body = { raw };
        }
        const status = failPosts ? 500 : 204;
        hooks.push({
          body,
          authorization: request.headers.authorization || "",
          contentType: request.headers["content-type"] || "",
          status
        });
        response.writeHead(status).end(status === 204 ? "" : "nope");
        return;
      }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const relative = pathname.replace(/^\/+/, "");
      const filePath = path.resolve(siteRoot, relative);
      if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      const type = TYPES[path.extname(filePath)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      response.end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function copySite(destination) {
  const files = [
    "index.html",
    "sw.js",
    "manifest.webmanifest",
    "robots.txt",
    ".nojekyll",
    "css/app.css",
    "js/app.js",
    "js/crypto.js",
    "icons/favicon-32.png",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "data/tracker.example.json"
  ];
  for (const file of files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(root, file)));
  }
}

const puppeteer = (await import("puppeteer-core")).default;
const passcode = `throwaway-${crypto.randomUUID()}`;
const site = await mkdtemp(path.join(tmpdir(), "college-tracker-site-"));
const errors = [];
let server;
let browser;
let page;

try {
  await copySite(site);
  await mkdir(outDir, { recursive: true });
  server = await startServer(site);
  const port = server.address().port;
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setCacheEnabled(false);

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="missing"]');
  const missing = await page.$eval("h1", (node) => node.textContent);
  assert(missing.includes("No data yet"), "missing file did not show the empty state");
  const lockedHtml = await page.content();
  assert(!lockedHtml.includes("Northwind"), "school data was visible before unlock");

  const encPath = path.join(site, "data", "tracker.enc.json");
  await encryptFile(path.join(root, "data", "tracker.example.json"), encPath, passcode);
  await page.click("[data-action='retry']");
  await page.waitForSelector('[data-screen="lock"]');
  const unlockHeight = await page.$eval("#unlock-submit", (node) => node.getBoundingClientRect().height);
  const unlockWidth = await page.$eval("#unlock-submit", (node) => node.getBoundingClientRect().width);
  assert(unlockHeight >= 48, `unlock button height ${unlockHeight}`);
  assert(unlockWidth >= 200, `unlock button width ${unlockWidth}`);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  assert(width === 375, `viewport width ${width}`);
  await page.screenshot({ path: path.join(outDir, "screenshot_passcode.png") });

  await page.type("#passcode", "definitely-wrong");
  await page.click("#unlock-submit");
  await page.waitForSelector("[data-error]");
  const wrong = await page.$eval("[data-error]", (node) => node.textContent);
  assert(wrong.includes("didn't unlock"), `unexpected error: ${wrong}`);
  const afterWrong = await page.content();
  assert(!afterWrong.includes("Northwind"), "wrong passcode revealed school data");
  assert(await page.$('[data-screen="lock"]'), "wrong passcode left the lock screen");

  await page.$eval("#passcode", (node, value) => {
    node.value = value;
  }, passcode);
  await page.click("#remember");
  await page.click("#unlock-submit");
  await page.waitForSelector('[data-screen="list"]');
  const homeText = (await page.$eval("main", (node) => node.innerText)).toLowerCase();
  assert(homeText.includes("to-do"), "home is missing the to-do list");
  assert(homeText.includes("send the fake highlight film"), "home is missing the overdue to-do");
  assert(homeText.startsWith("to-do") || homeText.includes("\nto-do"), "to-do is not the first section");
  const firstTodo = await page.$eval(".todo-row", (node) => node.innerText.toLowerCase());
  assert(firstTodo.includes("send the fake highlight film"), `first to-do was ${firstTodo}`);
  assert(firstTodo.includes("high"), "first to-do is missing the high badge");
  const overdueColor = await page.$eval(".when.overdue", (node) => getComputedStyle(node).color);
  const overdueChannels = overdueColor.match(/\d+/g).map(Number);
  assert(overdueChannels[0] > 120 && overdueChannels[1] < 80, `overdue color was ${overdueColor}`);
  await page.screenshot({ path: path.join(outDir, "screenshot_todo.png") });
  const firstName = await page.$eval(".school-card h2", (node) => node.textContent);
  assert(firstName.includes("Northwind"), `first school was ${firstName}`);
  const listText = (await page.$eval("main", (node) => node.innerText)).toLowerCase();
  assert(listText.includes("offer"), "list is missing the status");
  assert(listText.includes("next:"), "list is missing the next step");
  assert(listText.includes("last contact"), "list is missing the last contact");
  assert(listText.includes("closed door college"), "list is missing a lower-priority school");
  const cardHeight = await page.$eval(".school-card", (node) => node.getBoundingClientRect().height);
  assert(cardHeight >= 44, `school card height ${cardHeight}`);
  await page.$eval(".school-card", (node) => node.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(outDir, "screenshot_school_list.png") });

  await page.click(".school-card");
  await page.waitForSelector('[data-screen="detail"]');
  const detailText = (await page.$eval("main", (node) => node.innerText)).toLowerCase();
  assert(detailText.includes("to-do"), "detail is missing the school to-dos");
  assert(detailText.includes("send the fake highlight film"), "detail is missing the open to-do");
  assert(detailText.includes("overview"), "detail is missing the overview");
  assert(detailText.includes("offer"), "detail is missing the offer");
  assert(detailText.includes("sample campus tour"), "detail is missing the next step");
  assert(detailText.includes("communications"), "detail is missing communications");
  assert(detailText.includes("visits"), "detail is missing visits");
  assert(detailText.includes("application and scholarships"), "detail is missing application");
  assert(detailText.includes("contacts"), "detail is missing contacts");
  assert(detailText.includes("sam placeholder"), "detail is missing the contact");
  await page.screenshot({ path: path.join(outDir, "screenshot_school_detail.png") });

  async function publishTracker(data) {
    const plainPath = path.join(tmpdir(), `college-tracker-plain-${crypto.randomUUID()}.json`);
    await writeFile(plainPath, `${JSON.stringify(data)}\n`);
    try {
      await encryptFile(plainPath, path.join(site, "data", "tracker.enc.json"), passcode);
    } finally {
      await rm(plainPath, { force: true });
    }
  }

  async function openActions() {
    return page.$$eval(".todo-card > .todo-row .todo-action", (nodes) => nodes.map((node) => node.textContent.toLowerCase()).join("\n"));
  }

  async function pendingQueue() {
    return page.evaluate(() => JSON.parse(localStorage.getItem("college-tracker.todo-pending.v1") || "{}"));
  }

  async function settle() {
    await page.waitForNetworkIdle({ idleTime: 200, timeout: 15000 });
  }

  async function checkTodo(id) {
    await settle();
    const selector = `input[data-todo-id="${id}"]`;
    await page.waitForSelector(selector);
    await page.$eval(selector, (node) => node.click());
  }

  await page.click('input[data-todo-id="fake-highlight"]');
  await page.waitForFunction(() => !document.querySelector('input[data-todo-id="fake-highlight"]'));
  const detailAfterDone = (await page.$eval("main", (node) => node.innerText)).toLowerCase();
  assert(!detailAfterDone.includes("send the fake highlight film"), "school detail kept a checked to-do");
  assert(detailAfterDone.includes("confirm the sample campus tour"), "school detail dropped a different open to-do");
  const detailCount = await page.$eval(".todo-card .count", (node) => node.textContent.trim());
  assert(detailCount === "1", `school open count was ${detailCount}`);
  const unconfigured = await page.$eval("[data-sync-note]", (node) => ({
    text: node.textContent,
    role: node.getAttribute("role")
  }));
  assert(unconfigured.text.includes("isn't configured"), `sync note was ${unconfigured.text}`);
  assert(unconfigured.role !== "alert", "sync note used an alert");
  assert(!unconfigured.text.includes("http"), "sync note included a URL");
  assert(!(await page.$(".todo-done")), "checking Done parked the item in the Done section");
  await page.click('a[href="#/"]');
  await page.waitForSelector('[data-screen="list"]');
  const hiddenAtHome = await openActions();
  assert(!hiddenAtHome.includes("send the fake highlight film"), "home kept the checked to-do");
  assert(hiddenAtHome.includes("confirm the sample campus tour"), "home hid a different to-do");
  const homeCount = await page.$eval(".todo-card h1 .count", (node) => node.textContent.trim());
  assert(homeCount === "2", `home open count was ${homeCount}`);
  const queued = await pendingQueue();
  assert(queued["fake-highlight"]?.schoolId === "northwind", "pending queue missed the school");
  assert(queued["fake-highlight"]?.action === "Send the fake highlight film", "pending queue missed the action");
  assert(queued["fake-highlight"]?.remove === false, "pending queue changed remove");
  assert(queued["fake-highlight"]?.posted === false, "unconfigured item was marked posted");
  assert(queued["fake-highlight"]?.doneDate === chicagoToday(), `doneDate was ${queued["fake-highlight"]?.doneDate}`);
  const queuedRaw = await page.evaluate(() => localStorage.getItem("college-tracker.todo-pending.v1") || "");
  assert(!queuedRaw.includes("http"), "pending queue stored a webhook URL");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="list"]');
  const hiddenAfterReload = await openActions();
  assert(!hiddenAfterReload.includes("send the fake highlight film"), "reload showed the unsent to-do again");
  assert((await page.$eval("[data-sync-note]", (node) => node.textContent)).includes("isn't configured"));

  const example = JSON.parse(await readFile(path.join(root, "data", "tracker.example.json"), "utf8"));
  const configured = structuredClone(example);
  configured.sync = {
    doneWebhook: `http://127.0.0.1:${port}/hooks/done`,
    doneWebhookHeader: "Bearer test-token"
  };
  configured.todos.push({
    id: "fake-no-school",
    due: "",
    priority: "normal",
    school: "",
    coach: "",
    action: "Sample task with no school",
    status: "open"
  });
  await publishTracker(configured);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="list"]');
  const highlightHook = await waitForHook((hook) => hook.body?.todoId === "fake-highlight" && hook.status === 204);
  assert(highlightHook.authorization === "Bearer test-token", "webhook Authorization header was missing");
  assert(highlightHook.contentType.toLowerCase().includes("application/json"), `content type was ${highlightHook.contentType}`);
  assert(JSON.stringify(Object.keys(highlightHook.body)) === JSON.stringify(["todoId", "schoolId", "action", "doneDate", "remove"]));
  assert(highlightHook.body.schoolId === "northwind");
  assert(highlightHook.body.action === "Send the fake highlight film");
  assert(highlightHook.body.doneDate === chicagoToday());
  assert(highlightHook.body.remove === false);
  await page.waitForFunction(() => {
    const queue = JSON.parse(localStorage.getItem("college-tracker.todo-pending.v1") || "{}");
    return queue["fake-highlight"]?.posted === true && !document.querySelector("[data-sync-note]");
  });
  const configuredHtml = await page.content();
  assert(!configuredHtml.includes("Bearer test-token"), "webhook header was written into the page");
  assert(!configuredHtml.includes("/hooks/done"), "webhook URL was written into the page");

  await checkTodo("fake-no-school");
  const noSchoolHook = await waitForHook((hook) => hook.body?.todoId === "fake-no-school" && hook.status === 204);
  assert(noSchoolHook.body.schoolId === "", `blank schoolId was ${noSchoolHook.body.schoolId}`);
  assert(noSchoolHook.body.action === "Sample task with no school");
  assert(noSchoolHook.body.remove === false);
  assert(noSchoolHook.authorization === "Bearer test-token");
  await page.waitForFunction(() => !document.querySelector('input[data-todo-id="fake-no-school"]'));

  failPosts = true;
  await checkTodo("fake-tour");
  await page.waitForFunction(() => !document.querySelector('input[data-todo-id="fake-tour"]'));
  await waitForHook((hook) => hook.body?.todoId === "fake-tour" && hook.status === 500);
  const failedQueue = await pendingQueue();
  assert(failedQueue["fake-tour"]?.posted === false, "a failed POST was treated as synced");
  await page.waitForSelector("[data-sync-note]");
  assert((await page.$eval("[data-sync-note]", (node) => node.textContent)).includes("Couldn't sync yet"));
  const openWhileRetrying = await openActions();
  assert(!openWhileRetrying.includes("confirm the sample campus tour"), "failed sync put the to-do back");
  failPosts = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const tourHook = await waitForHook((hook) => hook.body?.todoId === "fake-tour" && hook.status === 204);
  assert(tourHook.authorization === "Bearer test-token");
  assert(tourHook.body.schoolId === "northwind");
  assert(tourHook.body.action === "Confirm the sample campus tour");
  assert(tourHook.body.doneDate === chicagoToday());
  assert(tourHook.body.remove === false);
  await page.waitForFunction(() => {
    const queue = JSON.parse(localStorage.getItem("college-tracker.todo-pending.v1") || "{}");
    return queue["fake-tour"]?.posted === true && !document.querySelector("[data-sync-note]");
  });

  const refreshed = structuredClone(configured);
  const lakeshore = refreshed.schools.find((school) => school.id === "lakeshore");
  lakeshore.nextSteps[0].text = "Republished sample step";
  await publishTracker(refreshed);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => document.body.innerText.includes("Republished sample step"));
  const openDuringRefresh = await openActions();
  assert(!openDuringRefresh.includes("send the fake highlight film"));
  assert(!openDuringRefresh.includes("confirm the sample campus tour"));
  assert(!openDuringRefresh.includes("sample task with no school"));
  assert(openDuringRefresh.includes("read the fake scholarship form"));
  const duringQueue = await pendingQueue();
  assert(duringQueue["fake-highlight"]?.posted === true);
  assert(duringQueue["fake-tour"]?.posted === true);
  const lakeshoreCard = await page.$$eval(".school-card", (cards) => {
    const card = cards.find((node) => node.innerText.includes("Lakeshore"));
    return card ? card.innerText : "";
  });
  assert(lakeshoreCard.includes("Republished sample step"), "republish did not update the school list");

  const confirmed = structuredClone(refreshed);
  confirmed.sync = {
    doneWebhook: `http://127.0.0.1:${port}/hooks/done`,
    doneWebhookHeader: ""
  };
  for (const todo of confirmed.todos) {
    if (todo.id === "fake-form") continue;
    todo.status = "done";
    todo.doneDate = chicagoToday();
  }
  await page.evaluate(() => {
    localStorage.setItem("college-tracker.todos.v1", JSON.stringify({
      "fake-tour": false,
      "fake-highlight": true
    }));
  });
  await publishTracker(confirmed);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="list"]');
  const openAfterConfirm = await openActions();
  assert(!openAfterConfirm.includes("send the fake highlight film"), "file status done was reopened");
  assert(!openAfterConfirm.includes("confirm the sample campus tour"), "a local false override reopened a done to-do");
  assert(openAfterConfirm.includes("read the fake scholarship form"));
  const legacy = await page.evaluate(() => localStorage.getItem("college-tracker.todos.v1"));
  assert(legacy === null, `old check-off override remained: ${legacy}`);
  const afterQueue = await pendingQueue();
  assert(!afterQueue["fake-highlight"] && !afterQueue["fake-tour"] && !afterQueue["fake-no-school"], "confirmed items stayed in the pending queue");
  const doneText = await page.$eval(".todo-done", (node) => node.textContent.toLowerCase());
  assert(doneText.includes("send the fake highlight film"), "file-done items were dropped from the shared record");

  await checkTodo("fake-form");
  const formHook = await waitForHook((hook) => hook.body?.todoId === "fake-form" && hook.status === 204);
  assert(formHook.authorization === "", "an empty header was sent as Authorization");
  assert(formHook.contentType.toLowerCase().includes("application/json"));
  assert(!formHook.contentType.toLowerCase().includes("authorization"));
  assert(formHook.body.schoolId === "lakeshore");
  assert(formHook.body.action === "Read the fake scholarship form");
  assert(formHook.body.remove === false);
  assert(formHook.body.doneDate === chicagoToday());
  await page.waitForFunction(() => !document.querySelector('input[data-todo-id="fake-form"]'));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".school-card")].find((node) => node.innerText.includes("Lakeshore"));
    card.click();
  });
  await page.waitForSelector('[data-screen="detail"]');
  const lakeText = (await page.$eval("main", (node) => node.innerText)).toLowerCase();
  assert(!lakeText.includes("read the fake scholarship form"), "school detail kept the synced to-do");
  assert(lakeText.includes("republished sample step"), "school detail missed the republished next step");
  await page.click('a[href="#/"]');
  await page.waitForSelector('[data-screen="list"]');

  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const channels = dark.match(/\d+/g).map(Number);
  assert(channels[0] < 40 && channels[1] < 40 && channels[2] < 50, `dark background was ${dark}`);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="detail"], [data-screen="list"]');
  await page.click("[data-action='lock']");
  await page.waitForSelector('[data-screen="lock"]');
  const savedAfterLock = await page.evaluate(() => localStorage.getItem("college-tracker.passcode.v1"));
  assert(savedAfterLock === null, "Lock left the passcode on the device");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-screen="lock"]');
  assert(!(await page.$('[data-screen="list"]')), "locked app reopened without a passcode");

  const noisy = errors.filter((error) => !/favicon|404|tracker\.enc\.json|hooks\/done|status of 500/i.test(error));
  assert(noisy.length === 0, `browser errors:\n${noisy.join("\n")}`);
  console.log(`browser check ok (375px, ${outDir})`);
} catch (err) {
  if (page) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    const screen = await page.evaluate(() => document.querySelector("[data-screen]")?.dataset.screen || "").catch(() => "");
    console.error(`SCREEN: ${screen}`);
    console.error(`PAGE:\n${text}`);
    console.error(`CONSOLE:\n${errors.join("\n")}`);
  }
  throw err;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(site, { recursive: true, force: true });
}
