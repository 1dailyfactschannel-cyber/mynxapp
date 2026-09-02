# Mynx Browser Extension

Browser companion of the Mynx desktop password manager. Autofills logins,
saves new credentials and generates strong passwords — your encrypted vault
stays in the desktop app and never leaves your PC.

Communication with the desktop app goes through Chrome native messaging
(host name: `com.matt.mynx.native`). The extension itself stores nothing
persistently except session-scoped pending logins.

## Development install

1. Install the Mynx desktop app 1.2.3+ — `mynx-native-host.exe` ships
   inside the installer (`%LOCALAPPDATA%\Mynx\mynx-native-host.exe`).
   Alternatively build it yourself: `cd src-tauri && cargo build --release --bin mynx-native-host`.
2. Open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked** and select this `extension/` folder.
3. Copy the generated extension ID (under the extension name).
4. Register the native host (no admin rights needed):

   ```powershell
   powershell -ExecutionPolicy Bypass -File native-host\register-native-host.ps1 `
     -ExtensionId "<YOUR-EXTENSION-ID>"
   ```

   The script finds `mynx-native-host.exe`, writes the host manifest to
   `%LOCALAPPDATA%\Mynx\native-host\` with your extension ID in
   `allowed_origins`, and registers it for Chrome / Edge / Chromium in HKCU.
   Pass `-HostPath` if the exe is somewhere non-standard.
5. Restart the browser, start the Mynx desktop app, unlock your vault, and
   open the extension popup — the status pill should read **Unlocked**.

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

The store assigns a permanent extension ID on first upload. Native
messaging only works for origins listed in the native host manifest, so
**after publishing** add it to `native-host/com.matt.mynx.native.json`:

```json
"allowed_origins": ["chrome-extension://<PUBLISHED-ID>/"]
```

and ship the updated manifest with the desktop installer.

To keep the same ID during development, pack the extension once with
`chrome.exe --pack-extension=<path\to\extension>` and add the printed `key`
to `manifest.json` — the ID is derived from that key. Do not commit private
`.pem` keys to the repository.

## Files

- `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js` — the extension itself
- `icons/` — extension icons
- `native-host/register-native-host.ps1` — one-shot native messaging registration (Chrome/Edge/Chromium, HKCU)
- `store/` — Chrome Web Store listing materials
- `pack.bat` — builds the uploadable zip
