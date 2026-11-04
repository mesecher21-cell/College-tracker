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

function startServer(siteRoot) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
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
  await page.click(".todo-row input");
  await page.waitForSelector(".todo-done");
  const savedTodo = await page.evaluate(() => localStorage.getItem("college-tracker.todos.v1"));
  assert(savedTodo && savedTodo.includes("fake-highlight"), "check-off was not stored on the device");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".todo-done");
  await page.$eval(".todo-done", (node) => {
    node.open = true;
  });
  await page.click(".todo-done input");
  assert(!(await page.$(".todo-done")), "unchecking did not return the item to the open list");
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

  const noisy = errors.filter((error) => !/favicon|404|tracker\.enc\.json/i.test(error));
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
