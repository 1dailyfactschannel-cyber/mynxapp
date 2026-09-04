# Mynx release pipeline.
# Builds the frontend, the Rust app, the native host, injects the SHA256
# of the freshly built mynx.exe into the native host, signs both, and
# (optionally) re-builds the NSIS installer.
#
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1
# To also rebuild the NSIS installer at the end:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Bundle

[CmdletBinding()]
param(
    [switch]$Bundle,
    [switch]$SkipVite,
    [switch]$SkipApp,
    [string]$InstallDir = "$env:LOCALAPPDATA\Mynx"
)

$ErrorActionPreference = 'Stop'
$env:PATH = 'C:\Users\Valentin\.cargo\bin;' + $env:PATH

$repoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$srcTauri     = Join-Path $repoRoot 'src-tauri'
$targetRel    = Join-Path $srcTauri 'target\release'
$binariesDir  = Join-Path $srcTauri 'binaries'
$signScript   = Join-Path $PSScriptRoot 'sign-mynx.ps1'
$logFile      = Join-Path $repoRoot 'release.log'
$errFile      = Join-Path $repoRoot 'release.err'

function Step($msg) { Write-Host "`n===> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host ('  + ' + $msg) -ForegroundColor Green }
function Warn($m)  { Write-Host ('  ! ' + $m) -ForegroundColor Yellow }
function Fail($m)  { Write-Host ('  X ' + $m) -ForegroundColor Red; throw $m }

# --- 1. Frontend ---
if (-not $SkipVite) {
    Step 'Building frontend (vite build)'
    Push-Location $repoRoot
    try {
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run build' `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $logFile -RedirectStandardError $errFile
        if ($proc.ExitCode -ne 0) {
            Get-Content $errFile -Tail 30
            Fail ('npm run build failed (exit ' + $proc.ExitCode + ')')
        }
    } finally { Pop-Location }
    Ok 'dist/ refreshed'
} else { Warn 'skipping vite build (-SkipVite)' }

# --- 2. Rust app ---
if (-not $SkipApp) {
    Step 'Building mynx.exe (release)'
    $proc = Start-Process -FilePath 'C:\Users\Valentin\.cargo\bin\cargo.exe' `
        -ArgumentList 'build','--release','--bin','mynx' `
        -WorkingDirectory $srcTauri `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $logFile -RedirectStandardError $errFile
    if ($proc.ExitCode -ne 0) {
        Get-Content $errFile -Tail 30
        Fail ('cargo build mynx failed (exit ' + $proc.ExitCode + ')')
    }
    Ok "$targetRel\mynx.exe built"
} else { Warn 'skipping mynx build (-SkipApp)' }

$mynxExe = Join-Path $targetRel 'mynx.exe'
if (-not (Test-Path $mynxExe)) { Fail "mynx.exe not found at $mynxExe" }

# --- 3. Sign mynx.exe FIRST (signing adds a PE section, changes hash) ---
Step 'Signing mynx.exe (before computing hash)'
$cert = Get-ChildItem 'Cert:\CurrentUser\My' -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq 'CN=Mynx, O=Matt, L=Moscow, C=RU' } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) { Fail 'signing cert not found; run scripts/sign-mynx.ps1 first' }
Set-AuthenticodeSignature -FilePath $mynxExe -Certificate $cert `
    -TimestampServer 'http://timestamp.digicert.com' | Out-Null
Ok 'mynx.exe signed'

# --- 4. SHA256 of SIGNED mynx.exe ---
Step 'Computing SHA256 of signed mynx.exe'
$sha = (Get-FileHash $mynxExe -Algorithm SHA256).Hash.ToLower()
Ok ('mynx.exe SHA256: ' + $sha)

# --- 4. Patch native_host.rs and rebuild native host ---
Step 'Patching native_host.rs and building mynx-native-host.exe'
$nhSrc = Join-Path $srcTauri 'src\native_host.rs'
$nhText = Get-Content $nhSrc -Raw
# Use [char]38 to avoid ampersand parse issue.
$amp = [char]38
$pattern = 'const EXPECTED_MYNX_SHA256: ' + $amp + 'str = "([0-9a-f]{64})"'
$replacement = 'const EXPECTED_MYNX_SHA256: ' + $amp + 'str = "' + $sha + '"'

if ($nhText -notmatch $pattern) {
    Fail 'EXPECTED_MYNX_SHA256 constant not found in native_host.rs'
}
$nhTextNew = [regex]::Replace($nhText, $pattern, $replacement)
Set-Content -Path $nhSrc -Value $nhTextNew -NoNewline
Ok ('native_host.rs patched (hash = ' + $sha + ')')

$proc = Start-Process -FilePath 'C:\Users\Valentin\.cargo\bin\cargo.exe' `
    -ArgumentList 'build','--release','--bin','mynx-native-host' `
    -WorkingDirectory $srcTauri `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $logFile -RedirectStandardError $errFile
if ($proc.ExitCode -ne 0) {
    Get-Content $errFile -Tail 30
    Fail ('cargo build mynx-native-host failed (exit ' + $proc.ExitCode + ')')
}
$nhExe = Join-Path $targetRel 'mynx-native-host.exe'
Ok 'mynx-native-host.exe built'

# --- 5. Stage binaries ---
Step 'Staging binaries'
$binstubs = Join-Path $binariesDir 'mynx-native-host-x86_64-pc-windows-msvc.exe'
Copy-Item -Path $nhExe   -Destination $binstubs -Force
Ok ('binstubs: ' + $binstubs)
Copy-Item -Path $nhExe   -Destination (Join-Path $InstallDir 'mynx-native-host.exe') -Force
Copy-Item -Path $mynxExe -Destination (Join-Path $InstallDir 'mynx.exe') -Force
Ok ('installed to ' + $InstallDir)

# --- 6. Sign native host (mynx.exe was already signed above) ---
Step 'Signing mynx-native-host.exe'
$nhExe = Join-Path $targetRel 'mynx-native-host.exe'
Set-AuthenticodeSignature -FilePath $nhExe -Certificate $cert `
    -TimestampServer 'http://timestamp.digicert.com' | Out-Null
Ok 'native host signed'

# --- 7. Optional: NSIS installer ---
if ($Bundle) {
    Step 'Rebuilding NSIS installer (npm run tauri-build)'
    Push-Location $repoRoot
    try {
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run tauri-build' `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $logFile -RedirectStandardError $errFile
        if ($proc.ExitCode -ne 0) {
            Get-Content $errFile -Tail 30
            Fail ('tauri-build failed (exit ' + $proc.ExitCode + ')')
        }
    } finally { Pop-Location }
    $installer = Get-ChildItem (Join-Path $targetRel 'bundle\nsis') -Filter '*.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
        $mb = [math]::Round($installer.Length / 1MB, 2)
        Ok ('installer: ' + $installer.FullName + ' (' + $mb + ' MB)')
    } else { Warn 'no installer produced' }
}

Ok ('Release complete. mynx.exe: ' + $sha)
