@echo off
setlocal
cd /d "%~dp0"
echo Preparing guided setup for the Case Intake Prototype...
where dotnet >nul 2>nul
if errorlevel 1 goto missing_sdk
dotnet --list-sdks | findstr /b /c:"10." >nul
if errorlevel 1 goto missing_sdk
dotnet build implementations\dataverse\Provision\Provision.csproj --nologo
if errorlevel 1 goto build_failed
dotnet implementations\dataverse\Provision\bin\Debug\net10.0\Provision.dll setup
set "setup_exit=%errorlevel%"
pause
exit /b %setup_exit%
:missing_sdk
echo Install the .NET 10 SDK, not just the Runtime, then reopen this file.
echo Official download: https://dotnet.microsoft.com/download/dotnet/10.0
pause
exit /b 1
:build_failed
echo Could not prepare setup. Check the error above and your connection to NuGet. No deployment was started.
pause
exit /b 1
