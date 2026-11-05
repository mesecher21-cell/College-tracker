// Proves encrypt → decrypt round-trips the example file, that a wrong passcode
// fails, and that the browser module can read what the script writes.
// Uses a throwaway passcode that exists only in this process.

import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { decryptPayload } = await import("../js/crypto.js");
const { validateTracker } = await import("./validate.mjs");
const { encryptFile } = await import("./encrypt.mjs");
const { decryptFile } = await import("./decrypt.mjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, "..", "data", "tracker.example.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const original = await readFile(examplePath);
const example = JSON.parse(original.toString("utf8"));
const errors = validateTracker(example);
if (errors.length) fail(errors.join("\n"));

function assertValid(data, label) {
  const found = validateTracker(data);
  if (found.length) fail(`${label}:\n${found.join("\n")}`);
}

function assertInvalid(data, label) {
  if (!validateTracker(data).length) fail(`${label} was accepted`);
}

assertValid({ ...example, sync: { doneWebhook: "https://example.com/hooks/done" } }, "doneWebhook without a header");
assertValid({ ...example, sync: { doneWebhook: "" } }, "empty doneWebhook");
assertValid({
  ...example,
  sync: { doneWebhook: "https://example.com/hooks/done", doneWebhookHeader: "" }
}, "empty doneWebhookHeader");
assertValid({
  ...example,
  sync: { doneWebhook: "http://127.0.0.1:9/hooks/done", doneWebhookHeader: "Bearer example" }
}, "http doneWebhook");
assertInvalid({ ...example, sync: { doneWebhook: "ftp://example.com/hooks/done" } }, "non-http doneWebhook");
assertInvalid({ ...example, sync: { doneWebhook: "https://example.com/hooks/done", token: "secret" } }, "unknown sync field");
assertInvalid({ ...example, sync: { doneWebhookHeader: "Bearer example" } }, "sync missing doneWebhook");
assertInvalid({ ...example, sync: { doneWebhook: "https://example.com/hooks/done", doneWebhookHeader: 1 } }, "non-string header");
assertInvalid({ ...example, sync: "https://example.com/hooks/done" }, "sync is not an object");

const appSource = await readFile(path.join(here, "..", "js", "app.js"), "utf8");
const indexSource = await readFile(path.join(here, "..", "index.html"), "utf8");
const cssSource = await readFile(path.join(here, "..", "css", "app.css"), "utf8");
const bundled = `${appSource}\n${indexSource}\n${cssSource}`;
if (/doneWebhook"\s*:\s*"https?:\/\//.test(bundled)) fail("a webhook URL is committed in the app source");
if (/Bearer\s+\S+/.test(bundled)) fail("a webhook header is committed in the app source");

const passcode = `throwaway-${crypto.randomUUID()}`;
const dir = await mkdtemp(path.join(tmpdir(), "college-tracker-"));
const encPath = path.join(dir, "tracker.enc.json");
const outPath = path.join(dir, "tracker.json");

try {
  await encryptFile(examplePath, encPath, passcode);
  const payload = JSON.parse(await readFile(encPath, "utf8"));
  if (payload.iterations < 250000) fail("iterations below 250000");
  if (payload.kdf !== "PBKDF2" || payload.hash !== "SHA-256") fail("unexpected kdf");

  const unlocked = await decryptPayload(payload, passcode);
  if (JSON.stringify(unlocked) !== JSON.stringify(example)) fail("browser decrypt did not match the example");

  let wrongFailed = false;
  try {
    await decryptPayload(payload, `${passcode}-wrong`);
  } catch (err) {
    wrongFailed = err.code === "PASSCODE";
  }
  if (!wrongFailed) fail("wrong passcode was accepted");

  await decryptFile(encPath, outPath, passcode);
  const roundTrip = await readFile(outPath);
  if (!roundTrip.equals(original)) fail("decrypt.mjs did not restore the original bytes");

  const encAgain = path.join(dir, "tracker-again.enc.json");
  const plainAgain = path.join(dir, "tracker-again.json");
  await encryptFile(outPath, encAgain, passcode);
  await decryptFile(encAgain, plainAgain, passcode);
  const second = await readFile(plainAgain);
  if (!second.equals(original)) fail("editing round-trip changed the plaintext");

  let lowIterationsRejected = false;
  try {
    await decryptPayload({ ...payload, iterations: 1000 }, passcode);
  } catch (err) {
    lowIterationsRejected = err.code === "FORMAT";
  }
  if (!lowIterationsRejected) fail("a low PBKDF2 iteration count was accepted");

  let cliWrong = false;
  try {
    await decryptFile(encPath, path.join(dir, "should-not-exist.json"), `${passcode}-wrong`);
  } catch {
    cliWrong = true;
  }
  if (!cliWrong) fail("decrypt.mjs accepted a wrong passcode");

  console.log(`roundtrip ok (PBKDF2-SHA256, ${payload.iterations} iterations, AES-GCM)`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
