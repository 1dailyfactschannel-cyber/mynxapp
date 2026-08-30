@echo off
chcp 65001 >nul
rem Сборка через официальный Tauri CLI: вшивает фронтенд в exe (prod-режим).
rem Прямой cargo build --release НЕ вшивает assets — exe потом требует devUrl!
rem
rem Подпись Windows-бинарников (Authenticode): купить OV/EV code-signing
rem сертификат, установить в хранилище Windows и задать SIGN_CERT_THUMBPRINT —
rem ниже отработает опциональный шаг signtool. Альтернатива: вписать thumbprint
rem в src-tauri\tauri.conf.json (bundle.windows.certificateThumbprint).
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
set "PATH=%USERPROFILE%\.cargo\bin;C:\Users\Matt\AppData\Local\Programs\kimi-desktop\resources\resources\runtime;%PATH%"
cd /d "D:\Kimi проекты\Safepass"
call npm run tauri-build || exit /b 1

rem --- Опциональный шаг: Authenticode-подпись exe и NSIS-установщика ---
if defined SIGN_CERT_THUMBPRINT (
    where signtool >nul 2>nul
    if errorlevel 1 (
        echo [sign] signtool.exe не найден ^(нужен Windows SDK^), пропуск подписи
    ) else (
        set "SIGN_TS=http://timestamp.digicert.com"
        if defined SIGN_TIMESTAMP_URL set "SIGN_TS=%SIGN_TIMESTAMP_URL%"
        for %%F in ("src-tauri\target\release\mynx.exe" "src-tauri\target\release\mynx-native-host.exe" "src-tauri\target\release\bundle\nsis\*.exe") do (
            signtool sign /sha1 %SIGN_CERT_THUMBPRINT% /fd sha256 /td sha256 /tr "%SIGN_TS%" "%%~F" || exit /b 1
            echo [sign] подписан: %%~F
        )
    )
) else (
    echo [sign] SIGN_CERT_THUMBPRINT не задан — бинарники без Authenticode-подписи
)

echo.
echo === Готово: D:\Kimi проекты\Safepass\src-tauri\target\release\mynx.exe ===
