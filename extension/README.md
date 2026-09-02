# Mynx Browser Extension

Browser companion of the Mynx desktop password manager. Autofills logins,
saves new credentials and generates strong passwords — your encrypted vault
stays in the desktop app and never leaves your PC.

Communication with the desktop app goes through Chrome native messaging
(host name: `com.matt.mynx.native`). The extension itself stores nothing
persistently except session-scoped pending logins.

## Development install

1. Install the Mynx desktop app **1.2.4+** — it registers the native messaging
   host automatically during installation and re-registers on every launch
   (manifest in `%LOCALAPPDATA%\Mynx\native-host\`, HKCU keys for Chrome /
   Edge / Chromium / Brave). No manual steps required.
2. Open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked** and select this `extension/` folder. The ID shown
   under the extension name is the stable one (`falikbndiimjeolnkclmifhgobmghhfe`):
   manifest.json embeds a fixed public key, so unpacked and store builds
   share the same ID.
3. Restart the browser, start the Mynx desktop app, unlock your vault, and
   open the extension popup — the status pill should read **Unlocked**.

### Manual registration (repair / custom IDs only)

Only needed for non-standard browser builds or custom extension IDs:

```powershell
powershell -ExecutionPolicy Bypass -File native-host\register-native-host.ps1
```

The script finds `mynx-native-host.exe`, writes the host manifest to
`%LOCALAPPDATA%\Mynx\native-host\` with the stable extension ID in
`allowed_origins`, and registers it for Chrome / Edge / Chromium in HKCU.
Pass `-HostPath` if the exe is somewhere non-standard, or
`-ExtensionId "id1,id2"` to also allow custom local builds.

## Publishing to Chrome Web Store

1. Run `pack.bat` — it produces `mynx-extension.zip` with only the files
   the store needs.
2. Upload the zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Fill the listing from `store/description.md` (short/full description,
   permission justifications, privacy practices answers).
4. Add a public link to `store/privacy-policy.md` (GitHub Pages or your site).
5. Capture screenshots per the checklist in `store/description.md`;
   promo images are in `store/`.

### Stable extension ID and native messaging

`manifest.json` embeds a fixed public key (`"key"`), so the extension ID is
the same for the unpacked build and the Chrome Web Store build:

`falikbndiimjeolnkclmifhgobmghhfe`

This ID is already listed in `allowed_origins` of the native host manifest
written by `register-native-host.ps1` and in the template
`native-host/com.matt.mynx.native.json`, so native messaging works out of
the box — no post-publish registration changes are needed.

The private half of the key lives in `store/extension-key.pem` (gitignored).
Keep it safe: deleting or regenerating it changes the extension ID and
breaks native messaging for existing installs. To rotate the ID on purpose,
delete the `.pem`, rerun `scripts/build_store_package.py`, and ship an
updated native-host manifest with the new ID.

## Files

- `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js` — the extension itself
- `icons/` — extension icons
- `native-host/register-native-host.ps1` — one-shot native messaging registration (Chrome/Edge/Chromium, HKCU)
- `store/` — Chrome Web Store listing materials
- `pack.bat` — builds the uploadable zip
