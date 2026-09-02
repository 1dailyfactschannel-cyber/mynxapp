; Mynx NSIS installer hooks (wired via bundle.windows.nsis.installerHooks).
;
; POSTINSTALL registers the native messaging host for the browser extension:
; per-user (HKCU) registry keys point Chrome / Edge / Chromium / Brave /
; Canary to %LOCALAPPDATA%\Mynx\native-host\com.matt.mynx.native.json.
;
; The manifest JSON itself is (re)written by the app on every launch
; (src-tauri/src/native_host_reg.rs) because it must contain the absolute
; path to mynx-native-host.exe; the NSIS FileWrite output would be UTF-16,
; which Chrome cannot read. Tauri launches the app right after install by
; default, so registration completes immediately. No admin rights needed
; (installMode: currentUser, HKCU only).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.matt.mynx.native" "" "$LOCALAPPDATA\Mynx\native-host\com.matt.mynx.native.json"
  WriteRegStr HKCU "Software\Google\Chrome SxS\NativeMessagingHosts\com.matt.mynx.native" "" "$LOCALAPPDATA\Mynx\native-host\com.matt.mynx.native.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.matt.mynx.native" "" "$LOCALAPPDATA\Mynx\native-host\com.matt.mynx.native.json"
  WriteRegStr HKCU "Software\Chromium\NativeMessagingHosts\com.matt.mynx.native" "" "$LOCALAPPDATA\Mynx\native-host\com.matt.mynx.native.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.matt.mynx.native" "" "$LOCALAPPDATA\Mynx\native-host\com.matt.mynx.native.json"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.matt.mynx.native"
  DeleteRegKey HKCU "Software\Google\Chrome SxS\NativeMessagingHosts\com.matt.mynx.native"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.matt.mynx.native"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.matt.mynx.native"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.matt.mynx.native"
  Delete "$LOCALAPPDATA\Mynx\native-host\com.matt.mynx.native.json"
  RMDir "$LOCALAPPDATA\Mynx\native-host"
!macroend
