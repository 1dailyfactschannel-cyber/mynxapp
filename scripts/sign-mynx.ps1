# Mynx self-signed code signing script.
# Generates an RSA-2048 Code Signing cert in the user store, exports the .pfx +
# .cer pair, and signs both mynx.exe and mynx-native-host.exe.
# Re-run after rotating the cert; do NOT commit the .pfx.

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pfxPath   = Join-Path $scriptDir 'mynx-codesign.pfx'
$cerPath   = Join-Path $scriptDir 'mynx-codesign.cer'
$pfxPass   = 'mynx-dev-only'   # пароль для .pfx, для production-ключа замените
$certSubject = 'CN=Mynx, O=Matt, L=Moscow, C=RU'

# 1. Найти или создать сертификат в хранилище текущего пользователя.
$existing = Get-ChildItem "Cert:\CurrentUser\My" -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $certSubject } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

if ($existing) {
    "Found existing cert: $($existing.Thumbprint) (expires $($existing.NotAfter))"
    $cert = $existing
} else {
    "Creating new self-signed code signing cert..."
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -KeyUsage DigitalSignature `
        -NotAfter (Get-Date).AddYears(5) `
        -KeyExportPolicy Exportable
    "Created: $($cert.Thumbprint)"
}

# 2. Экспорт .pfx (приватный ключ — для подписи).
if (-not (Test-Path $pfxPath)) {
    $securePwd = ConvertTo-SecureString -String $pfxPass -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null
    "Exported PFX: $pfxPath"
} else {
    "PFX already exists, skipping export"
}

# 3. Экспорт .cer (публичный — для проверки в расширении).
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
"Exported CER: $cerPath"
"Cert SHA256 (fingerprint): $($cert.GetCertHashString('SHA256'))"
"Cert SHA1 (fingerprint):   $($cert.Thumbprint)"

# 4. Подписать exe-файлы.
$targets = @(
    'C:\Users\Valentin\AppData\Local\Mynx\mynx.exe',
    'C:\Users\Valentin\AppData\Local\Mynx\mynx-native-host.exe'
)
foreach ($exe in $targets) {
    if (-not (Test-Path $exe)) { "MISSING: $exe"; continue }
    try {
        $sig = Get-AuthenticodeSignature -FilePath $exe
        if ($sig.SignerCertificate.Thumbprint -eq $cert.Thumbprint) {
            "Already signed: $exe"
            continue
        }
        "Signing: $exe"
        Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -TimestampServer 'http://timestamp.digicert.com' -ErrorAction Stop | Out-Null
    } catch {
        "FAILED: $exe -> $_"
    }
}

# 5. Проверка.
"`n--- Verification ---"
foreach ($exe in $targets) {
    if (Test-Path $exe) {
        $sig = Get-AuthenticodeSignature -FilePath $exe
        "  $($sig.Status)  $exe"
        if ($sig.SignerCertificate) {
            "    Signer: $($sig.SignerCertificate.Subject)"
            "    SHA1:   $($sig.SignerCertificate.Thumbprint)"
        }
    }
}
"Done."
