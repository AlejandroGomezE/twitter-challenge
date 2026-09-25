# Shared by scripts/down-be and scripts/down-fe. Sourced, not executed.
#
# stop_dev <label> <dir> <port>
#   Stops the dev tooling running out of <dir>: every node process whose command line points into
#   <dir>/node_modules/ (the nest/vite/npm CLI wrappers, e.g. `nest start --watch`, `vite`) —
#   killing each one's whole process tree, so the dev server it spawned (`node dist/main`, Vite's
#   esbuild) goes with it. Any other node process running out of <dir> (e.g. a `node dist/main`
#   someone started by hand) is reported, never killed. Then reports whether <port> is free;
#   whatever still holds it is reported, never killed.

is_windows() {
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac
}

stop_dev() {
  local label="$1" dir="$2" port="$3"

  if is_windows; then
    STOP_DIR="$(cygpath -w "$dir")" STOP_PORT="$port" STOP_LABEL="$label" \
      powershell.exe -NoProfile -NonInteractive -Command '
        $dir = $env:STOP_DIR.TrimEnd("\").ToLower() + "\"
        $tools = $dir + "node_modules\"
        function Get-RepoNode {
          @(Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq "node.exe" -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($dir) })
        }
        $procs = @(Get-RepoNode | Where-Object { $_.CommandLine.ToLower().Contains($tools) })
        if ($procs.Count -eq 0) {
          Write-Output "No $($env:STOP_LABEL) dev processes running."
        } else {
          foreach ($p in $procs) {
            Write-Output "Stopping pid $($p.ProcessId): $($p.CommandLine)"
            & taskkill.exe /PID $p.ProcessId /T /F *> $null
          }
        }
        Start-Sleep -Milliseconds 500
        foreach ($p in Get-RepoNode) {
          Write-Output "! Left running (not started by the dev scripts): pid $($p.ProcessId): $($p.CommandLine)"
        }
        $held = Get-NetTCPConnection -LocalPort ([int]$env:STOP_PORT) -State Listen -ErrorAction SilentlyContinue
        if ($held) {
          $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($held[0].OwningProcess)"
          Write-Output "! Port $($env:STOP_PORT) is still held by pid $($owner.ProcessId) ($($owner.Name)): $($owner.CommandLine) - left alone."
          exit 1
        }
        Write-Output "Port $($env:STOP_PORT) is free."
      '
    return $?
  fi

  # node processes whose command line points into $1 (a directory prefix ending in /).
  repo_node_pids() {
    ps -eo pid=,args= | awk -v d="$1" 'index($0, d) && $2 ~ /(^|\/)node$/ { print $1 }'
  }
  # $1 and all its descendants.
  with_descendants() {
    local child
    echo "$1"
    for child in $(pgrep -P "$1" 2>/dev/null); do with_descendants "$child"; done
  }

  local pids="" pid
  for pid in $(repo_node_pids "$dir/node_modules/"); do pids="$pids $(with_descendants "$pid")"; done
  if [ -z "${pids// /}" ]; then
    echo "No $label dev processes running."
  else
    for pid in $(repo_node_pids "$dir/node_modules/"); do echo "Stopping pid $pid: $(ps -o args= -p "$pid" 2>/dev/null)"; done
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -KILL $pids 2>/dev/null || true
  fi

  for pid in $(repo_node_pids "$dir/"); do
    echo "! Left running (not started by the dev scripts): pid $pid: $(ps -o args= -p "$pid" 2>/dev/null)"
  done

  if command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "! Port $port is still held — left alone:"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN
    return 1
  fi
  echo "Port $port is free."
}
