@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 24 or newer is required to start the Folia KTV development app.
    if /i not "%FOLIA_KTV_LAUNCH%"=="true" pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
    echo Node.js 24 or newer is required. Install or select Node.js 24, then try again.
    if /i not "%FOLIA_KTV_LAUNCH%"=="true" pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron dependencies are missing. From this folder, run npm ci and try again.
    if /i not "%FOLIA_KTV_LAUNCH%"=="true" pause
    exit /b 1
)

if not defined FOLIA_MNN_LIBRARY if exist "%~dp0build\mnn\win-x64\folia_mnn.dll" set "FOLIA_MNN_LIBRARY=%~dp0build\mnn\win-x64\folia_mnn.dll"
if defined FOLIA_MNN_LIBRARY echo CPU separation runtime: "%FOLIA_MNN_LIBRARY%"

if /i "%~1"=="--check" (
    echo Folia KTV startup checks passed.
    exit /b 0
)

echo Starting Folia KTV.
call npm run dev:electron
if errorlevel 1 (
    echo Folia KTV stopped with an error. Check the messages above.
    if /i not "%FOLIA_KTV_LAUNCH%"=="true" pause
)
