@echo off
rem Builds mynx-extension.zip for Chrome Web Store upload.
setlocal
cd /d "%~dp0"

set ZIP=mynx-extension.zip
if exist "%ZIP%" del "%ZIP%"

powershell -NoProfile -Command "Compress-Archive -Path 'manifest.json','background.js','content.js','popup.html','popup.js','icons' -DestinationPath '%ZIP%' -Force" || goto :err

echo.
echo Package contents:
powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('%ZIP%').Entries.FullName"
echo.
echo Created %CD%\%ZIP%
exit /b 0

:err
echo Failed to create %ZIP%
exit /b 1
