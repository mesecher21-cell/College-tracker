// Decrypt data/tracker.enc.json back to data/tracker.json.
// Usage (from the repo root):
//   COLLEGE_TRACKER_PASSCODE='your passcode' node scripts/decrypt.mjs
//   COLLEGE_TRACKER_PASSCODE='your passcode' node scripts/decrypt.mjs input.enc.json output.json
//
// Restores the original plaintext bytes so an edit can be encrypted again.
// Node 18+ built-in WebCrypto only. No packages.

import { webcrypto } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { decryptToString } = await import("../js/crypto.js");

export async function decryptFile(inputPath, outputPath, passcode) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (err) {
    throw new Error(`Could not read ${inputPath} as JSON. ${err.message}`);
  }
  let text;
  try {
    text = await decryptToString(payload, passcode);
  } catch (err) {
    if (err && err.code === "PASSCODE") {
      throw new Error("Decryption failed. The passcode is wrong, or the file is damaged.");
    }
    throw err;
  }
  try {
    JSON.parse(text);
  } catch {
    throw new Error("Decryption succeeded but the plaintext is not JSON. Refusing to write it.");
  }
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, outputPath);
}

async function main() {
  const passcode = process.env.COLLEGE_TRACKER_PASSCODE;
  if (typeof passcode !== "string" || passcode.length === 0) {
    throw new Error("Set COLLEGE_TRACKER_PASSCODE in the environment. Do not pass the passcode as an argument or commit it.");
  }
  const inputPath = path.resolve(process.argv[2] || "data/tracker.enc.json");
  const outputPath = path.resolve(process.argv[3] || "data/tracker.json");
  await decryptFile(inputPath, outputPath, passcode);
  console.log(`Wrote ${outputPath}`);
  console.log("This file is plaintext. Do not commit it.");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
