#!/bin/sh
# The morning job, run by macOS (launchd) at 07:00, with retries later in the day.
# Collects today's changes with the company Claude, then uploads data/ to GitHub, which republishes the page.
# Runs once per day: after a successful run, later retries that day do nothing. If the news was collected but
# the upload failed, a later retry only uploads, so it doesn't spend company credits collecting again.
# Log: .cache/daily.log   Installed by: scripts/install-mac.sh

cd "$(dirname "$0")/.." || exit 1
. scripts/upload.sh
mkdir -p .cache
LOG=.cache/daily.log
STAMP=.cache/last-success
COLLECTED=.cache/last-collected
NODE="${RADAR_NODE:-node}"
TODAY=$(date +%F)

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Pixel Post\"" >/dev/null 2>&1
}

exec >>"$LOG" 2>&1
echo
echo "=== $(date '+%F %T') daily run"

if [ "$(cat "$STAMP" 2>/dev/null)" = "$TODAY" ] && [ -z "$RADAR_FORCE" ]; then
  echo "Already ran successfully today. Nothing to do."
  exit 0
fi

if [ "$(cat "$COLLECTED" 2>/dev/null)" = "$TODAY" ]; then
  echo "Already collected today; only the upload is left."
else
  # Pick up any edits made on GitHub (for example to watchlist.yaml). Not fatal if offline.
  git pull --ff-only -q || echo "git pull failed (offline?). Continuing with the local copy."

  "$NODE" src/collect.ts >.cache/last-run.txt 2>&1
  code=$?
  cat .cache/last-run.txt
  if [ $code -ne 0 ]; then
    echo "Collect failed with exit $code. A later retry today will try again."
    if grep -q "company login has expired" .cache/last-run.txt; then
      notify "The company login has expired. Open Terminal and run: ada refresh"
    else
      notify "Today's run failed (see .cache/daily.log). It will retry later today."
    fi
    exit $code
  fi

  git add data/
  if git diff --cached --quiet; then
    echo "No changes to upload."
  else
    git commit -qm "radar: $TODAY" && echo "Committed."
  fi
  # Same 06:00 rule as below: a run just after midnight doesn't count as today's collection.
  [ "$(date +%H)" -ge 6 ] && echo "$TODAY" >"$COLLECTED"
fi

upload
up=$?
if [ $up -eq 0 ]; then
  echo "Uploaded. GitHub will republish the page in a minute or two."
elif [ $up -eq 2 ]; then
  echo "GitHub rejected the login. The token has probably expired."
  notify "GitHub rejected the upload: the token has probably expired. Make a new one and run git push once in Terminal."
  exit 1
else
  echo "Could not reach GitHub after 5 tries. The next run today will upload it without collecting again."
  notify "Collected today's news but could not reach GitHub. The next run today will try the upload again."
  exit 1
fi

# Only a run from 06:00 on counts as "today's edition"; one just after midnight still lets 07:00 run.
[ "$(date +%H)" -ge 6 ] && echo "$TODAY" >"$STAMP"
tail -n 3000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
