# Mynx Browser Extension

Browser companion of the Mynx desktop password manager. Autofills logins,
saves new credentials and generates strong passwords — your encrypted vault
stays in the desktop app and never leaves your PC.

Communication with the desktop app goes through Chrome native messaging
(host name: `com.matt.mynx.native`). The extension itself stores nothing
persistently except session-scoped pending logins.

## Development install

1. Install the Mynx desktop app **1.2.5+** — it registers the native messaging
   host automatically during installation and re-registers on every launch
   (manifest in `%LOCALAPPDATA%\Mynx\native-host\`, HKCU keys for Chrome /
   Edge / Chromium / Brave). No manual steps required.
2. Open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked** and select this `extension/` folder. The ID shown
   under the extension name is the dev one (`falikbndiimjeolnkclmifhgobmghhfe`):
   manifest.json embeds a fixed public key, so the unpacked ID is stable no
   matter where the folder lives. The desktop app allows both the dev ID and
   the store ID, so no extra configuration is needed.
3. Restart the browser, start the Mynx desktop app, unlock your vault, and
   open the extension popup — the status pill should read **Unlocked**.

### Manual registration (repair / custom IDs only)

Only needed for non-standard browser builds or custom extension IDs:

```powershell
powershell -ExecutionPolicy Bypass -File native-host\register-native-host.ps1
```

The script finds `mynx-native-host.exe`, writes the host manifest to
`%LOCALAPPDATA%\Mynx\native-host\` with both extension IDs (store + dev)
in `allowed_origins`, and registers it for Chrome / Edge / Chromium in HKCU.
Pass `-HostPath` if the exe is somewhere non-standard, or
`-ExtensionId "id1,id2"` to also allow custom local builds.

## Publishing to Chrome Web Store

1. Run `python3 scripts/build_store_package.py` — it produces
   `mynx-extension-<version>-webstore.zip` with only the files the store
   needs (its manifest carries no `"key"`, so the item keeps the ID Google
   assigned on first upload).
2. Upload the zip as an **update of the existing item** in the [Chrome Web
   Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (`kjgmcffggjpmghjmhkhdiandaoefkmpb`). If the dashboard reports that the
   version is not higher than the live one, bump it via
   `--version 1.0.5` and rebuild.
3. Fill the listing from `store/description.md` (short/full description,
   permission justifications, privacy practices answers).
4. Add a public link to `store/privacy-policy.md` (GitHub Pages or your site).
5. Capture screenshots per the checklist in `store/description.md`;
   promo images are in `store/`.

### Extension IDs and native messaging

Two IDs identify Mynx extension builds, and both are allowed by the native
host everywhere (desktop-app auto-registration, `register-native-host.ps1`,
and the `native-host/com.matt.mynx.native.json` template):

- **Store ID `kjgmcffggjpmghjmhkhdiandaoefkmpb`** — assigned by Chrome Web
  Store to the published item. Every store install runs under it; it never
  changes and does not depend on what we upload.
- **Dev ID `falikbndiimjeolnkclmifhgobmghhfe`** — derived from the public
  key embedded in `manifest.json` (`"key"`). It keeps unpacked installs
  path-independent, so native messaging survives moving the folder.

Because both origins are whitelisted, any install method works out of the
box. The private half of the dev key lives in `store/extension-key.pem`
(gitignored). Keep it safe: regenerating it changes the dev ID (the build
script refuses to run with a mismatched key). The store ID cannot be
rotated at all — it belongs to the store item.

## Files

- `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js` — the extension itself
- `icons/` — extension icons
- `native-host/register-native-host.ps1` — one-shot native messaging registration (Chrome/Edge/Chromium, HKCU)
- `store/` — Chrome Web Store listing materials
- `pack.bat` — builds the uploadable zip
