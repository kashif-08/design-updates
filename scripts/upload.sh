# Uploads committed changes to GitHub, retrying on network trouble. Used by scripts/daily.sh.
# Returns 0 when uploaded, 2 when GitHub rejected the login (retrying won't help), 1 when it never got through.
# RADAR_UPLOAD_WAITS sets the pauses between tries in seconds (tests set it to zeros).

upload() {
  # $(echo ...) so the list splits into numbers in zsh too, not only in sh.
  for wait in $(echo "${RADAR_UPLOAD_WAITS:-0 15 30 60 120}"); do
    if [ "$wait" -gt 0 ]; then
      echo "Upload failed, trying again in ${wait}s."
      sleep "$wait"
    fi
    out=$(git push -q 2>&1) && return 0
    echo "$out"
    case "$out" in
      *"Authentication failed"* | *"Invalid username or token"* | *"Permission"*"denied"* | *" 401"* | *" 403"*)
        return 2
        ;;
      # GitHub has a newer commit (an edit made on the website): take it, then try again.
      *"fetch first"* | *"non-fast-forward"* | *"rejected"*)
        git pull --rebase -q || return 1
        ;;
    esac
  done
  return 1
}
