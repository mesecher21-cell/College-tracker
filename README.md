# College Tracker

A phone-first college recruiting tracker. It is a static site: open it, enter a passcode, and read the school list. Tap a school for the status, offer, next step, communications, visits, application, scholarships, and contacts.

The site can be published with GitHub Pages. There is no server. The passcode never leaves the phone.

## One-time GitHub Pages setting

The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) deploys on every push to `main`. GitHub still needs one manual choice before the first deploy:

1. Open **Settings → Pages → Build and deployment**.
2. Set **Source** to **GitHub Actions** (not “Deploy from a branch”).

If that source option is missing, open **Settings → Actions → General** and allow actions, then check Pages again after this workflow is on `main`. The first successful run creates the `github-pages` environment.

Expected site: <https://mesecher21-cell.github.io/College-tracker/>

On an iPhone, open that URL in Safari, tap Share, then **Add to Home Screen**. The icon opens the tracker full screen. Android Chrome can use **Install app** or **Add to Home screen**.

## Privacy

This repository is public. Do not commit plaintext recruiting notes or the passcode.

| File | Commit it? |
| --- | --- |
| `data/tracker.json` | No. Gitignored plaintext. |
| `data/tracker.enc.json` | Yes, when you mean to publish the encrypted notes. |
| `data/tracker.example.json` | Yes. Obviously fake sample only. |
| `.env` or a shell history that contains the passcode | No. |

`scripts/encrypt.mjs` reads the passcode from the `COLLEGE_TRACKER_PASSCODE` environment variable. Do not pass the passcode as an argument. The Pages workflow refuses to deploy if `data/tracker.json` is present.

Until `data/tracker.enc.json` is published, the app shows **No data yet**.

The browser downloads the encrypted file with a cache-busting query and `cache: "no-store"`. The service worker is network-first, so the next time the app is opened online it picks up a newly published file. A remembered passcode stays in this browser’s `localStorage` until **Lock** is tapped. Decrypting happens on the device with WebCrypto. Nothing is uploaded.

## Update the notes

From the repository root, with Node 18 or newer:

```bash
# edit the gitignored plaintext, then encrypt it
COLLEGE_TRACKER_PASSCODE='your passcode' node scripts/encrypt.mjs

# turn the published ciphertext back into plaintext you can edit
COLLEGE_TRACKER_PASSCODE='your passcode' node scripts/decrypt.mjs
```

Optional paths: `node scripts/encrypt.mjs input.json output.enc.json` and `node scripts/decrypt.mjs input.enc.json output.json`.

Commit and push `data/tracker.enc.json` only. The next visit to the installed app loads that file.

Check the sample file without using a real passcode:

```bash
node scripts/roundtrip.mjs
```

Preview locally with a static server (a `file://` URL cannot decrypt or install the service worker):

```bash
python3 -m http.server
```

A headless check at a 375px-wide phone viewport, using the fake sample and a throwaway passcode:

```bash
CHROME_PATH=/usr/local/bin/google-chrome node scripts/browser-check.mjs --out /tmp/college-tracker-shots
```

That command needs `puppeteer-core`. It does not write the encrypted sample into the repository.

## Encryption

`js/crypto.js` is the only cipher. The Node scripts and the browser both use it, via built-in WebCrypto (no npm packages).

`data/tracker.enc.json` looks like this:

```json
{
  "version": 1,
  "kdf": "PBKDF2",
  "hash": "SHA-256",
  "iterations": 260000,
  "salt": "<base64, 16 random bytes>",
  "iv": "<base64, 12 random bytes>",
  "ciphertext": "<base64, AES-256-GCM ciphertext with the 16-byte tag appended>"
}
```

PBKDF2-HMAC-SHA-256 uses 260,000 iterations. The script refuses a file below 250,000. Each encrypt uses a new salt and IV. A wrong passcode fails the AES-GCM check; the app then says the passcode did not unlock the tracker. `decrypt.mjs` writes the original plaintext bytes, so an edit round-trips.

## Data model

`data/tracker.example.json` is a fake document with every field filled in somewhere. `scripts/encrypt.mjs` rejects a file that does not match this shape. Dates are `YYYY-MM-DD`. Empty strings are allowed where a date or detail was not recorded. School `priority` starts at 1 for the top school. The list is sorted by priority, then by status (`offer`, `accepted`, `applied`, `visited`, `interested`, `backup`, `pending`, `closed`).

```text
profile.name            string
profile.classYear       number, such as 2028
profile.gpa             number
profile.notes           string
lastUpdated             YYYY-MM-DD
upcoming[]              { date, title, school }
schools[]
  id                    lowercase slug, unique
  name                  string
  location              string
  level                 division or level, such as "NCAA D3" or "JUCO"
  sports                array of strings
  status                offer | accepted | applied | visited | interested | backup | pending | closed
  priority              integer, 1 is highest
  offers[]              { sport, type, amount, date, notes }
  application           { status, submitted, decision, decisionDate }
  visits[]              { date, type, notes }
  scholarships[]        { name, status, notes }
  contacts[]            { name, role, sport, email, phone }
  engineeringNotes      string
  nextSteps[]           { date, text }
  comms[]               { date, channel, direction, with, summary }
```

`comms.channel` is `email`, `text`, `call`, `in-person`, `X DM`, or `other`. `comms.direction` is `in` (received) or `out` (sent). `upcoming.school` and each school `id` should match a school name or id so the app can open that school.

On the list, each school shows its status, the next dated step (or the latest one, if every step is in the past), and the latest communication date. The school screen leads with status, offer, and next step, then the communications timeline, visits, application and scholarships, and contacts. Engineering notes show when that field is filled in.
