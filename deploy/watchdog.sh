#!/usr/bin/env bash
# watchdog — restart the app when it is up but no longer answering (a hang pm2 cannot see), and bring
# it back when pm2 has given up on it. Run every minute by cron (README → "Staying up"):
#
#   * * * * * PATH=<pm2 and node folders>:/usr/bin:/bin bash ~/tcs-ai-hackathon-2025/deploy/watchdog.sh >> ~/.pm2/logs/watchdog.log 2>&1
#
# Each run asks http://127.0.0.1:<port>/api/live (10-second limit):
#   - it answers ............... all well (a recovery after failures is logged)
#   - no answer, 3 runs in a row  pm2 restart <app>   (then 2 minutes' grace while it starts)
#   - pm2 shows "errored" ....... pm2 gave up after too many crashes: restart it
#   - pm2 shows "stopped" ....... someone stopped it on purpose: left alone
#   - pm2 does not know the app . pm2 resurrect (the list saved by pm2 save), else start the process file
# It never acts while stock-deploy is running (its lock: .git/stock-deploy.lock).
#   bash deploy/watchdog.sh --status   prints what it sees, changes nothing

set -uo pipefail

self="$(readlink -f "${BASH_SOURCE[0]}")"
app_dir="$(dirname "$(dirname "$self")")"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/stock-watchdog"
mkdir -p "$state_dir"
fails_file="$state_dir/fails"
grace_file="$state_dir/restarted-at"
LIMIT="${WATCHDOG_FAILS:-3}"  # consecutive failed checks before a restart
GRACE="${WATCHDOG_GRACE:-120}" # seconds left alone after a restart

ts() { date '+%Y-%m-%d %H:%M:%S %z'; }
log() { printf '%s [watchdog] %s\n' "$(ts)" "$1"; }

cd "$app_dir" || exit 0
app="$(node -p "require('./deploy/ecosystem.config.cjs').apps[0].name" 2> /dev/null || echo vinaytiwari)"
port="$(node -p "require('./deploy/ecosystem.config.cjs').apps[0].env.PORT" 2> /dev/null || echo 5100)"
status_only=0
[ "${1:-}" = "--status" ] && status_only=1

if ! command -v pm2 > /dev/null; then
  log "pm2 is not on the PATH: nothing can be restarted (set PATH in the cron line)"
  exit 0
fi

# a deploy is running: it restarts the app itself
if [ -d "$app_dir/.git/stock-deploy.lock" ]; then
  [ "$status_only" = 1 ] && log "a deploy is running: the watchdog waits"
  exit 0
fi

# the app's state as pm2 sees it: online, stopped, errored, launching… or missing
pm2_state() {
  pm2 jlist 2> /dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s.slice(s.indexOf("[")));
        const a = j.find((p) => p.name === process.argv[1]);
        console.log(a ? a.pm2_env.status : "missing");
      } catch (_) {
        console.log("unknown");
      }
    });
  ' "$app" 2> /dev/null || echo unknown
}

# does it answer? curl when there is one, else node
alive() {
  local url="http://127.0.0.1:${port}/api/live"
  if command -v curl > /dev/null; then
    curl -fsS --max-time 10 -o /dev/null "$url" 2> /dev/null
  else
    node -e "const r=require('http').get('$url',{timeout:10000},(x)=>process.exit(x.statusCode===200?0:1));r.on('timeout',()=>{r.destroy();process.exit(1)});r.on('error',()=>process.exit(1))" 2> /dev/null
  fi
}

state="$(pm2_state)"
fails="$(cat "$fails_file" 2> /dev/null || echo 0)"
case "$fails" in '' | *[!0-9]*) fails=0 ;; esac

if [ "$status_only" = 1 ]; then
  if alive; then answer="answers"; else answer="does NOT answer"; fi
  log "app $app (port $port): pm2 says $state; /api/live $answer; failed checks in a row: $fails"
  exit 0
fi

case "$state" in
  stopped)
    # stopped on purpose (pm2 stop): not the watchdog's business
    echo 0 > "$fails_file"
    exit 0
    ;;
  missing)
    log "pm2 does not know $app: restoring the saved process list"
    pm2 resurrect > /dev/null 2>&1 || true
    if [ "$(pm2_state)" = "missing" ]; then
      log "still missing: starting deploy/ecosystem.config.cjs"
      pm2 start deploy/ecosystem.config.cjs > /dev/null 2>&1 && pm2 save > /dev/null 2>&1
    fi
    date +%s > "$grace_file"
    echo 0 > "$fails_file"
    exit 0
    ;;
  errored)
    log "pm2 gave up on $app after repeated crashes: restarting it (see: pm2 logs $app --err --lines 100)"
    pm2 restart "$app" > /dev/null 2>&1 || log "pm2 restart failed"
    date +%s > "$grace_file"
    echo 0 > "$fails_file"
    exit 0
    ;;
esac

# just restarted: give it time to start
last="$(cat "$grace_file" 2> /dev/null || echo 0)"
case "$last" in '' | *[!0-9]*) last=0 ;; esac
if [ $(($(date +%s) - last)) -lt "$GRACE" ]; then
  exit 0
fi

if alive; then
  if [ "$fails" -gt 0 ]; then log "$app answers again (after $fails failed check(s))"; fi
  echo 0 > "$fails_file"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$fails_file"
log "$app (pm2: $state) did not answer /api/live within 10 s — $fails of $LIMIT"
if [ "$fails" -ge "$LIMIT" ]; then
  log "restarting $app: it has not answered for $fails checks in a row"
  pm2 restart "$app" > /dev/null 2>&1 || log "pm2 restart failed"
  date +%s > "$grace_file"
  echo 0 > "$fails_file"
fi
exit 0
