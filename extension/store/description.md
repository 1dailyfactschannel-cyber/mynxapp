# Mynx — Chrome Web Store Listing

## Short description (max 132 chars)

Offline password manager. Autofill logins and generate strong passwords — your vault never leaves your PC.

## Full description

Mynx is the browser companion of the Mynx desktop password manager. It fills your logins on any website while your encrypted vault stays offline on your own computer — no cloud, no accounts, no tracking.

**Why Mynx?**

- **Your vault never touches the cloud.** Everything is encrypted and stored on your own computer. No company servers, no data leaks, no subscription lock-in.
- **One app — no accounts.** Forget passwords for your password manager. Mynx works without signing up, syncing or trusting a third party.
- **Faster than browser autofill.** The inline icon puts your logins exactly where you need them. Pick an account and sign in with one click.
- **Built for privacy.** No analytics, no trackers, no remote code. The extension only talks to the Mynx app on the same machine.
- **Works the way you do.** Save new credentials automatically, generate strong passwords on the spot, and search your vault instantly from the toolbar.

**Features**

- One-click autofill: an inline icon appears in login fields, pick an account and you're in
- Multiple accounts per site: choose from a dropdown of matching logins
- Save new logins: Mynx offers to store credentials after you sign in
- Password generator: 8–64 characters with configurable character sets, cryptographically secure randomness
- Vault search: find any login and copy usernames or open sites straight from the popup
- TOTP autofill: fills one-time codes when a site asks for them
- Status at a glance: toolbar badge shows whether the desktop app is unlocked, locked or offline

**How it works**

The extension talks exclusively to the Mynx desktop app running on your PC through Chrome's native messaging. All decryption happens locally in the desktop app; the extension never stores your vault and never connects to any server.

**Requirements**

The free Mynx desktop application must be installed and unlocked.

**Privacy**

No analytics, no remote code, no third-party servers. Your data never leaves your computer. See the privacy policy for details.

---

## Permission justifications (review form)

- **activeTab** — Used to read the domain of the current tab when the user opens the popup, so Mynx can show and fill matching logins. No browsing history is collected or stored.
- **storage** — Used for chrome.storage.session only: temporarily holds credentials captured from a login form until the user confirms saving them into the encrypted vault. Data lives in memory for the browser session and is never synced or transmitted.
- **nativeMessaging** — Required to communicate with the Mynx desktop application on the same machine, which holds the encrypted vault and performs all decryption. This is the core function of the extension.
- **Content scripts on all URLs (`<all_urls>`)** — Login forms exist on arbitrary websites, so the autofill content script must run wherever the user signs in. The script only detects login fields, fills credentials chosen by the user, and captures new logins on submit. It collects no page content and sends nothing anywhere except to the local desktop app.
- **Host permissions** — Not used.
- **Remote code** — Not used. All code ships inside the extension package.

## Data usage / privacy practices answers

- The extension does **not** collect, transmit or sell any user data.
- Credentials are exchanged only between the browser and the locally installed Mynx desktop app via Chrome native messaging.
- Pending logins captured for the "save new login" feature are stored in `chrome.storage.session` (memory, per-session) until the user saves or dismisses them.
- No data leaves the user's device; there are no third-party requests, analytics or advertising.
- Single purpose: password manager autofill companion for the Mynx desktop application.

## Screenshots to capture (1280×800 or 640×400)

1. Popup, **Site** tab with matching logins on a real website
2. Autofill dropdown open on a login form (inline Mynx icon visible)
3. Popup, **Generator** tab
4. Popup, **Saved** tab offering to save a new login
5. (Optional) Popup, **All** tab with search
