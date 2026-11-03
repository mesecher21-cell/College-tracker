// One WebCrypto implementation shared by the browser and the Node scripts.
// Node 18 callers must assign globalThis.crypto before calling these functions.
//
// File format (data/tracker.enc.json):
// {
//   version: 1,
//   kdf: "PBKDF2",
//   hash: "SHA-256",
//   iterations: 260000,          // must be >= 250000
//   salt: base64,                // 16 random bytes
//   iv: base64,                  // 12 random bytes
//   ciphertext: base64           // AES-256-GCM ciphertext with the 16-byte tag appended
// }

export const ITERATIONS = 260_000;
export const MIN_ITERATIONS = 250_000;
export const MAX_ITERATIONS = 2_000_000;

function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || !cryptoApi.getRandomValues) {
    throw Object.assign(new Error("WebCrypto is not available in this environment."), { code: "FORMAT" });
  }
  return cryptoApi;
}

function bytesToB64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64) {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw Object.assign(new Error("This tracker file isn't supported."), { code: "FORMAT" });
  }
  let binary;
  try {
    binary = atob(b64);
  } catch {
    throw Object.assign(new Error("This tracker file isn't supported."), { code: "FORMAT" });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function assertFormat(payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("This tracker file isn't supported."), { code: "FORMAT" });
  }
  if (payload.version !== 1 || payload.kdf !== "PBKDF2" || payload.hash !== "SHA-256") {
    throw Object.assign(new Error("This tracker file isn't supported."), { code: "FORMAT" });
  }
  if (!Number.isInteger(payload.iterations) || payload.iterations < MIN_ITERATIONS || payload.iterations > MAX_ITERATIONS) {
    throw Object.assign(new Error("This tracker file isn't supported."), { code: "FORMAT" });
  }
  const salt = b64ToBytes(payload.salt);
  const iv = b64ToBytes(payload.iv);
  const ciphertext = b64ToBytes(payload.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) {
    throw Object.assign(new Error("This tracker file isn't supported."), { code: "FORMAT" });
  }
  return { salt, iv, ciphertext };
}

async function deriveKey(passcode, salt, iterations, usages) {
  const cryptoApi = getCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

export async function encryptToPayload(plaintextBytes, passcode) {
  if (typeof passcode !== "string" || passcode.length === 0) {
    throw new Error("A passcode is required.");
  }
  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passcode, salt, ITERATIONS, ["encrypt"]);
  const cipherBuf = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintextBytes);
  return {
    version: 1,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: ITERATIONS,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(cipherBuf))
  };
}

export async function decryptToString(payload, passcode) {
  if (typeof passcode !== "string" || passcode.length === 0) {
    throw Object.assign(new Error("That passcode didn't unlock the tracker. Try again."), { code: "PASSCODE" });
  }
  const { salt, iv, ciphertext } = assertFormat(payload);
  try {
    const key = await deriveKey(passcode, salt, payload.iterations, ["decrypt"]);
    const plainBuf = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder("utf-8", { fatal: true }).decode(plainBuf);
  } catch (err) {
    if (err && err.code === "FORMAT") throw err;
    throw Object.assign(new Error("That passcode didn't unlock the tracker. Try again."), { code: "PASSCODE" });
  }
}

export async function decryptPayload(payload, passcode) {
  const text = await decryptToString(payload, passcode);
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("The file unlocked, but it isn't a tracker."), { code: "SHAPE" });
  }
}
