# Registers the Mynx native messaging host for Chrome / Edge (current user).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File register-native-host.ps1
#   powershell -ExecutionPolicy Bypass -File register-native-host.ps1 -ExtensionId "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
#   ... -HostPath "D:\Tools\mynx-native-host.exe" -ExtensionId "id1,id2"
#
# The extension manifest ships with a fixed public key, so its ID is the same
# everywhere (unpacked and store build) and is baked in below as $StableId.
# Pass -ExtensionId only to additionally allow custom/local builds.

param(
  [string]$ExtensionId = "",
  [string]$HostPath = ""
)

$ErrorActionPreference = "Stop"
$HostName_ = "com.matt.mynx.native"
# Stable ID of the published Mynx extension (derived from manifest.json "key").
$StableId = "falikbndiimjeolnkclmifhgobmghhfe"

Write-Host "=== Mynx native host registration ===" -ForegroundColor Cyan

# 1. Locate mynx-native-host.exe ---------------------------------------------
if (-not $HostPath) {
  $candidates = @()
  if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA "Mynx\mynx-native-host.exe" }
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles "Mynx\mynx-native-host.exe" }
  if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} "Mynx\mynx-native-host.exe" }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $HostPath = $c; break }
  }
}
if (-not $HostPath -or -not (Test-Path $HostPath)) {
  Write-Host "ERROR: mynx-native-host.exe not found." -ForegroundColor Red
  Write-Host "Install Mynx 1.2.3+ (the host ships inside the installer),"
  Write-Host "or pass the path explicitly:  -HostPath `"C:\path\mynx-native-host.exe`""
  exit 1
}
Write-Host "Host exe : $HostPath"

# 2. Extension ID(s) ----------------------------------------------------------
# The stable ID is always allowed (covers both the unpacked build and the
# Chrome Web Store build - they share the same key). Extra IDs can be added
# via -ExtensionId "id1,id2" for custom local builds.
$ids = @("chrome-extension://$StableId/")
foreach ($raw in $ExtensionId.Split(",")) {
  $id = $raw.Trim().ToLower()
  if (-not $id) { continue }
  if ($id -match '^[a-p]{32}$') {
    $origin = "chrome-extension://$id/"
    if ($ids -notcontains $origin) { $ids += $origin }
  } else {
    Write-Host "ERROR: '$id' does not look like an extension ID (expected 32 letters a-p)." -ForegroundColor Red
    exit 1
  }
}

# 3. Write the host manifest ---------------------------------------------------
$manifestDir = Join-Path $env:LOCALAPPDATA "Mynx\native-host"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifestPath = Join-Path $manifestDir "$HostName_.json"

$manifest = [ordered]@{
  name        = $HostName_
  description = "Mynx Native Messaging Host"
  path        = $HostPath
  type        = "stdio"
  allowed_origins = $ids
}
$json = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Manifest : $manifestPath"
Write-Host "Origins  : $($ids -join ', ')"

# 4. Registry (HKCU, no admin needed) ------------------------------------------
$roots = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts",        # Chrome
  "HKCU:\Software\Google\Chrome SxS\NativeMessagingHosts",    # Chrome Canary
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts",       # Edge
  "HKCU:\Software\Chromium\NativeMessagingHosts"              # Chromium
)
foreach ($root in $roots) {
  $key = Join-Path $root $HostName_
  New-Item -Path $key -Force | Out-Null
  # Set-Item задает значение по умолчанию (default) ключа реестра
  Set-Item -LiteralPath $key -Value $manifestPath
  Write-Host "Registry : $key" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done. Restart your browser, open a login page and click the Mynx" -ForegroundColor Green
Write-Host "icon. Approve the pairing prompt in the Mynx desktop app (vault must be unlocked)."
