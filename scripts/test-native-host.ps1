$ErrorActionPreference = 'Stop'
$exe = "D:\Project\Mynxapp\mynxapp-repo\src-tauri\target\release\mynx-native-host.exe"
$msg = '{"type":"status"}'

# Build payload: 4-byte little-endian length + UTF-8 message
$msgBytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
$lenBytes = [System.BitConverter]::GetBytes([int]$msgBytes.Length)
$payload = New-Object byte[] ($lenBytes.Length + $msgBytes.Length)
[Array]::Copy($lenBytes, 0, $payload, 0, 4)
[Array]::Copy($msgBytes, 0, $payload, 4, $msgBytes.Length)

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stderrTask = $proc.StandardError.ReadToEndAsync()
$stdin = $proc.StandardInput.BaseStream
$stdout = $proc.StandardOutput.BaseStream

$stdin.Write($payload, 0, $payload.Length)
$stdin.Flush()
$stdin.Close()

# Read 4-byte length
$lenBuf = New-Object byte[] 4
$read = 0
while ($read -lt 4) {
    $n = $stdout.Read($lenBuf, $read, 4 - $read)
    if ($n -le 0) { break }
    $read += $n
}
"Read $read bytes for length prefix"
if ($read -eq 4) {
    $respLen = [System.BitConverter]::ToInt32($lenBuf, 0)
    "Response length: $respLen"
    $respBuf = New-Object byte[] $respLen
    $totalRead = 0
    while ($totalRead -lt $respLen) {
        $n = $stdout.Read($respBuf, $totalRead, $respLen - $totalRead)
        if ($n -le 0) { break }
        $totalRead += $n
    }
    $response = [System.Text.Encoding]::UTF8.GetString($respBuf, 0, $totalRead)
    "Response: $response"
} else {
    "No response from native host"
}

$proc.WaitForExit(2000) | Out-Null
"Exit code: $($proc.ExitCode)"
"Stderr: $($stderrTask.Result)"
