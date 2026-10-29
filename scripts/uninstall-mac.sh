#!/bin/sh
# Stops the morning job and removes it from this Mac. The project and its data are left alone.
LABEL=com.kashif.design-updates
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "Stopped." || echo "It was not running."
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" && echo "Removed $LABEL."
