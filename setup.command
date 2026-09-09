#!/bin/sh
# Double-click on macOS, or run with sh on Linux.
cd "$(dirname "$0")" || exit 1
printf '\nPreparing guided setup for the Case Intake Prototype...\n'
setup_dotnet=$(command -v dotnet 2>/dev/null)
if [ -z "$setup_dotnet" ]; then
  for candidate in /opt/homebrew/bin/dotnet /usr/local/share/dotnet/dotnet "$HOME/.dotnet/dotnet"; do
    if [ -x "$candidate" ]; then setup_dotnet=$candidate; break; fi
  done
fi
setup_exit=1
if [ -z "$setup_dotnet" ] || ! "$setup_dotnet" --list-sdks 2>/dev/null | grep -q '^10\.'; then
  printf '\nInstall the .NET 10 SDK (not just the Runtime), then reopen this file.\n'
  printf 'Official download: https://dotnet.microsoft.com/download/dotnet/10.0\n'
  printf 'Choose your operating system; on a Mac with an M-series chip, choose Arm64.\n'
elif "$setup_dotnet" build implementations/dataverse/Provision/Provision.csproj --nologo; then
  "$setup_dotnet" implementations/dataverse/Provision/bin/Debug/net10.0/Provision.dll setup
  setup_exit=$?
else
  printf '\nCould not prepare setup. Check the error above and your connection to NuGet. No deployment was started.\n'
fi
printf '\nPress Enter to close...'
read -r setup_close
exit "$setup_exit"
