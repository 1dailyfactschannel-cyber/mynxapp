# ============================================================
#  Mynx connectivity diagnostics (read-only, changes nothing)
#  Run:  powershell -ExecutionPolicy Bypass -File mynx-diagnostics.ps1
# ============================================================
$ErrorActionPreference = "Continue"
$sidecarPath = Join-Path $env:LOCALAPPDATA "Mynx\mynx-native-host.exe"
$storeId     = "kjgmcffggjpmghjmhkhdiandaoefkmpb"
$devId       = "falikbndiimjeolnkclmifhgobmghhfe"
$hostName    = "com.matt.mynx.native"

function Section($t) {
    Write-Host ""
    Write-Host ("== " + $t + " ==") -ForegroundColor Cyan
}

function Check-Manifest($browser, $root, $manifestPathFromRegistry) {
    if (-not $manifestPathFromRegistry) {
        Write-Host ("  [" + $browser + "] registry key NOT found") -ForegroundColor Yellow
        return
    }
    Write-Host ("  [" + $browser + "] registry -> " + $manifestPathFromRegistry)
    if (-not (Test-Path $manifestPathFromRegistry)) {
        Write-Host ("  [" + $browser + "] manifest file MISSING on disk") -ForegroundColor Red
        return
    }
    try {
        $m = Get-Content -Raw -Encoding UTF8 $manifestPathFromRegistry | ConvertFrom-Json
    } catch {
        Write-Host ("  [" + $browser + "] manifest JSON parse error") -ForegroundColor Red
        return
    }
    $exe = $m.path
    if ($exe -and (Test-Path $exe)) {
        Write-Host ("  [" + $browser + "] host exe OK: " + $exe) -ForegroundColor Green
    } else {
        Write-Host ("  [" + $browser + "] host exe MISSING: " + $exe) -ForegroundColor Red
    }
    $origins = @($m.allowed_origins)
    $hasStore = $origins -contains ("chrome-extension://" + $storeId + "/")
    $hasDev   = $origins -contains ("chrome-extension://" + $devId + "/")
    if ($hasStore) {
        Write-Host ("  [" + $browser + "] allowed_origins: store ID present") -ForegroundColor Green
    } else {
        Write-Host ("  [" + $browser + "] allowed_origins: STORE ID MISSING (old manifest)") -ForegroundColor Red
    }
    if (-not $hasDev) {
        Write-Host ("  [" + $browser + "] allowed_origins: dev ID missing (minor)") -ForegroundColor Yellow
    }
}

Section "1. Desktop app process"
$procs = Get-Process -Name "mynx","mynx-native-host" -ErrorAction SilentlyContinue
if ($procs) {
    $procs | ForEach-Object {
        Write-Host ("  running: " + $_.Name + " (PID " + $_.Id + ")") -ForegroundColor Green
        if ($_.Path) { Write-Host ("    path: " + $_.Path) }
    }
} else {
    Write-Host "  mynx.exe NOT running  <-- most likely cause" -ForegroundColor Yellow
}

Section "2. IPC pipe \\.\pipe\mynx"
$found = $false
try {
    [System.IO.Directory]::GetFiles("\\.\pipe\") | ForEach-Object {
        if ($_ -like "*mynx*") {
            $found = $true
            Write-Host ("  FOUND pipe: " + $_) -ForegroundColor Green
        }
    }
} catch {
    Write-Host ("  pipe listing failed: " + $_.Exception.Message) -ForegroundColor Yellow
}
if (-not $found) {
    Write-Host "  pipe \\.\pipe\mynx NOT found -> desktop app is not running or IPC server failed" -ForegroundColor Yellow
}

Section "3. Native host sidecar"
if (Test-Path $sidecarPath) {
    $v = (Get-Item $sidecarPath).VersionInfo
    Write-Host ("  found: " + $sidecarPath) -ForegroundColor Green
    Write-Host ("    version: " + $v.FileVersion)
} else {
    Write-Host ("  MISSING: " + $sidecarPath) -ForegroundColor Red
}

Section "4. Registry + manifest (per browser, HKCU then HKLM)"
$paths = @(
    @{ B = "Chrome";   K = "HKCU:\Software\Google\Chrome\NativeMessagingHosts" },
    @{ B = "Chrome";   K = "HKLM:\Software\Google\Chrome\NativeMessagingHosts" },
    @{ B = "Edge";     K = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts" },
    @{ B = "Brave";    K = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts" },
    @{ B = "Chromium"; K = "HKCU:\Software\Chromium\NativeMessagingHosts" }
)
foreach ($p in $paths) {
    $key = Join-Path $p.K $hostName
    try {
        $reg = Get-ItemProperty -Path $key -ErrorAction Stop
        Check-Manifest $p.B $p.K $reg.'(default)'
    } catch {
        Write-Host ("  [" + $p.B + "/" + (Split-Path $p.K -Qualifier) + "] no registry key") -ForegroundColor DarkGray
    }
}

Section "5. Verdict hints"
$mynxRunning = [bool](Get-Process -Name "mynx" -ErrorAction SilentlyContinue)
if (-not $mynxRunning -and -not $found) {
    Write-Host "  ACTION: start Mynx from the Start menu, unlock the vault, keep it running," -ForegroundColor Green
    Write-Host "  then click the extension icon and confirm access in the app (pairing)." -ForegroundColor Green
} elseif ($mynxRunning -and -not $found) {
    Write-Host "  ACTION: app runs but IPC pipe is absent. Fully quit Mynx (tray -> Exit)," -ForegroundColor Green
    Write-Host "  kill any leftover mynx.exe in Task Manager, start Mynx again." -ForegroundColor Green
} elseif ($found) {
    Write-Host "  Pipe is up. If the popup still says offline: click the extension icon and" -ForegroundColor Green
    Write-Host "  confirm the pairing request inside the Mynx app window." -ForegroundColor Green
}
Write-Host ""
Write-Host "Diagnostics complete. Paste the full output back into the chat." -ForegroundColor Cyan
