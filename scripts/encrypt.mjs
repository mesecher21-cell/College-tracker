// Encrypt data/tracker.json into data/tracker.enc.json.
// Usage (from the repo root):
//   COLLEGE_TRACKER_PASSCODE='your passcode' node scripts/encrypt.mjs
//   COLLEGE_TRACKER_PASSCODE='your passcode' node scripts/encrypt.mjs input.json output.enc.json
//
// The passcode is read only from the environment. Do not pass it as an argument.
// Encryption is implemented in js/crypto.js so the browser decrypts these exact bytes.
// Node 18+ built-in WebCrypto only. No packages.

import { webcrypto } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { encryptToPayload } = await import("../js/crypto.js");
const { validateTracker } = await import("./validate.mjs");

export async function encryptFile(inputPath, outputPath, passcode) {
  let text;
  try {
    text = readFileSync(inputPath);
  } catch {
    throw new Error(`Could not read ${inputPath}. Create the plaintext locally. It is gitignored and must not be committed.`);
  }
  let data;
  try {
    data = JSON.parse(text.toString("utf8"));
  } catch (err) {
    throw new Error(`${inputPath} is not valid JSON. ${err.message}`);
  }
  const errors = validateTracker(data);
  if (errors.length) {
    throw new Error(`${inputPath} failed validation:\n${errors.map((error) => ` - ${error}`).join("\n")}`);
  }
  const payload = await encryptToPayload(text, passcode);
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, outputPath);
}

async function main() {
  const passcode = process.env.COLLEGE_TRACKER_PASSCODE;
  if (typeof passcode !== "string" || passcode.length === 0) {
    throw new Error("Set COLLEGE_TRACKER_PASSCODE in the environment. Do not pass the passcode as an argument or commit it.");
  }
  const inputPath = path.resolve(process.argv[2] || "data/tracker.json");
  const outputPath = path.resolve(process.argv[3] || "data/tracker.enc.json");
  await encryptFile(inputPath, outputPath, passcode);
  console.log(`Wrote ${outputPath}`);
  console.log("Leave data/tracker.json untracked. Commit tracker.enc.json only when you mean to publish the ciphertext.");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
