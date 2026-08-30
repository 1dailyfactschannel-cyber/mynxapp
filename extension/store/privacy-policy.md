# Mynx Browser Extension — Privacy Policy

> **Note:** Chrome Web Store requires a public URL to the privacy policy.
> Publish this file (e.g. GitHub Pages, project website) and paste the link
> into the listing's "Privacy policy" field.

_Last updated: 2026-07-30_

## Overview

Mynx ("the extension") is a companion to the Mynx desktop password manager.
It is designed so that your data never leaves your computer.

## What the extension does with your data

- **Credential lookup and autofill.** When you ask Mynx to fill a login, the
  extension sends the current website's domain to the Mynx desktop application
  on the same computer using Chrome's native messaging API. The desktop app
  decrypts your vault locally and returns the matching credentials. This
  exchange never involves any network connection.
- **Saving new logins.** When you sign in somewhere, the extension may
  temporarily keep the entered username and password in
  `chrome.storage.session` — memory-only storage that disappears when the
  browser session ends. The data stays there until you explicitly save it to
  your vault or dismiss it.
- **No storage of your vault.** The extension never stores your vault,
  master password or decrypted credentials in persistent browser storage.

## What the extension does NOT do

- No data is transmitted to any external server.
- No analytics, telemetry, crash reporting or usage tracking.
- No cookies, fingerprinting or advertising identifiers.
- No third-party code, libraries loaded at runtime, or remote code execution.
- No sale or sharing of personal information — there is nothing to share.

## Network activity

The extension makes **no network requests**. Its only communication channel
is Chrome native messaging with the locally installed Mynx desktop
application (`com.matt.mynx.native`).

## Third parties

None. The extension has no dependencies on external services.

## Changes to this policy

Any changes will be published at the same URL with an updated date.

## Contact

Questions about this policy: **<your-email@example.com>** (replace before publishing)
