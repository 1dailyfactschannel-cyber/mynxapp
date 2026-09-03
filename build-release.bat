@echo off
chcp 65001 >nul
rem Сборка через официальный Tauri CLI: вшивает фронтенд в exe (prod-режим).
rem Прямой cargo build --release НЕ вшивает assets — exe потом требует devUrl!
rem
rem Скрипт автономен: корень проекта определяется по расположению файла
 rem (%~dp0), а не захардкоженным путям конкретной машины.
rem
rem Подпись Windows-бинарников (Authenticode): купить OV/EV code-signing
rem сертификат, установить в хранилище Windows и задать SIGN_CERT_THUMBPRINT —
rem ниже отработает опциональный шаг signtool. Альтернатива: вписать thumbprint
rem в src-tauri\tauri.conf.json (bundle.windows.certificateThumbprint).

setlocal
set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

rem Visual Studio Build Tools: стандартное расположение, но необязательны —
rem cargo сам находит MSVC через vswhere, если vcvars не найден.
set "VCVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" set "VCVARS=%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" (
    call "%VCVARS%" >nul
) else (
    echo [build] vcvars64.bat не найден — надеемся на самостоятельную регистрацию MSVC у cargo
)

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d "%PROJECT_ROOT%"

rem Sidecar для bundle.externalBin: build.rs Tauri требует существования файла
rem уже при cargo build. Создаем заглушку, собираем реальный хост, кладем поверх.
if not exist "src-tauri\binaries" mkdir "src-tauri\binaries"
if not exist "src-tauri\binaries\mynx-native-host-x86_64-pc-windows-msvc.exe" (
    type nul > "src-tauri\binaries\mynx-native-host-x86_64-pc-windows-msvc.exe" || exit /b 1
)
cargo build --release --bin mynx-native-host || exit /b 1
copy /Y "src-tauri\target\release\mynx-native-host.exe" "src-tauri\binaries\mynx-native-host-x86_64-pc-windows-msvc.exe" >nul || exit /b 1

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
echo === Готово: %PROJECT_ROOT%\src-tauri\target\release\mynx.exe ===
endlocal
