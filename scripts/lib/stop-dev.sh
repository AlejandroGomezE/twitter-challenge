# Shared by scripts/down-be and scripts/down-fe. Sourced, not executed.
#
# stop_dev <label> <dir> <port>
#   Stops every node process whose command line points into <dir> (the dev server, its watcher,
#   nest/vite CLI wrappers) — killing each one's whole process tree — then reports whether <port>
#   is free. Anything else holding <port> is reported, never killed.

is_windows() {
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac
}

stop_dev() {
  local label="$1" dir="$2" port="$3"

  if is_windows; then
    STOP_DIR="$(cygpath -w "$dir")" STOP_PORT="$port" STOP_LABEL="$label" \
      powershell.exe -NoProfile -NonInteractive -Command '
        $dir = $env:STOP_DIR.TrimEnd("\") + "\"
        $procs = @(Get-CimInstance Win32_Process | Where-Object {
          $_.Name -eq "node.exe" -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($dir.ToLower()) })
        if ($procs.Count -eq 0) {
          Write-Output "No $($env:STOP_LABEL) processes running."
        } else {
          foreach ($p in $procs) {
            Write-Output "Stopping pid $($p.ProcessId): $($p.CommandLine)"
            & taskkill.exe /PID $p.ProcessId /T /F *> $null
          }
        }
        Start-Sleep -Milliseconds 500
        $held = Get-NetTCPConnection -LocalPort ([int]$env:STOP_PORT) -State Listen -ErrorAction SilentlyContinue
        if ($held) {
          $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($held[0].OwningProcess)"
          Write-Output "! Port $($env:STOP_PORT) is still held by pid $($owner.ProcessId) ($($owner.Name)) - not started from this repo, left alone."
          exit 1
        }
        Write-Output "Port $($env:STOP_PORT) is free."
      '
    return $?
  fi

  local pids
  pids="$(ps -eo pid=,args= | awk -v d="$dir/" 'index($0, d) && $2 ~ /(^|\/)node$/ { print $1 }')"
  if [ -z "$pids" ]; then
    echo "No $label processes running."
  else
    for pid in $pids; do echo "Stopping pid $pid: $(ps -o args= -p "$pid" 2>/dev/null)"; done
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -KILL $pids 2>/dev/null || true
  fi

  if command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "! Port $port is still held — not started from this repo, left alone:"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN
    return 1
  fi
  echo "Port $port is free."
}
