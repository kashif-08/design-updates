#!/bin/sh
# Installs the morning job on this Mac: 07:00 every day, with retries at 09:00, 12:00 and 16:00.
# Re-run after changing the times below. Remove with scripts/uninstall-mac.sh.
# Usage: sh scripts/install-mac.sh [--run-now]

set -e
cd "$(dirname "$0")/.."
REPO=$(pwd)
LABEL=com.kashif.design-updates
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOURS="7 9 12 16"   # change these to move the run time (24-hour clock, this Mac's time zone)
NODE=$(command -v node)
[ -n "$NODE" ] || { echo "node not found. Install Node 24 first."; exit 1; }

times=""
for h in $HOURS; do
  times="$times
    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>"
done

mkdir -p "$HOME/Library/LaunchAgents" "$REPO/.cache"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$REPO/scripts/daily.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RADAR_NODE</key><string>$NODE</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>$times
  </array>
  <key>StandardOutPath</key><string>$REPO/.cache/launchd.log</string>
  <key>StandardErrorPath</key><string>$REPO/.cache/launchd.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed: runs at $(echo $HOURS | sed 's/ /:00, /g'):00 (stops after the first success each day)."
echo "Log: $REPO/.cache/daily.log"

if [ "$1" = "--run-now" ]; then
  echo "Starting a test run now..."
  launchctl kickstart "gui/$(id -u)/$LABEL"
fi
