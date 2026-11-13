#!/usr/bin/env bash
# stock-deploy — bring this server's copy of the site up to date, in one command.
#
#   stock-deploy            pull the latest code from GitHub and deploy whatever changed
#   stock-deploy --check    show what is waiting to be deployed; change nothing
#   stock-deploy --force    reinstall, rebuild and restart even if nothing changed
#   stock-deploy --doctor   check the wiring: pm2, the app's port, and whether the public address reaches the app
#   stock-deploy --nginx    print the nginx rules that pass /api and /me to the app
#   stock-deploy --help     this text
#
# What it does, in order, stopping at the first thing that fails:
#   1. pulls the branch from GitHub (fast-forward only: it never merges and never discards
#      work done on this server; npm's own rewrites of a lock file are put back)
#   2. installs packages, but only where a package file changed (or a folder is missing)
#   3. builds the site into a spare folder and swaps it in only when the build succeeded,
#      so a failed build leaves the running site exactly as it was
#   4. restarts the server (pm2) only when server code changed, then waits for it to answer
#
# One-time setup on the server (afterwards just type  stock-deploy  from anywhere):
#   cd ~/tcs-ai-hackathon-2025 && git pull && bash deploy/stock-deploy.sh --install
#
# It never touches server/.env, the database or server/data.

set -euo pipefail

main() {
  local self app_dir branch mode
  self="$(readlink -f "${BASH_SOURCE[0]}")"
  app_dir="$(dirname "$(dirname "$self")")"
  branch="${STOCK_DEPLOY_BRANCH:-main}"
  mode="deploy"

  local B="" G="" R="" Y="" N=""
  if [ -t 1 ]; then
    B=$'\033[1m' G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' N=$'\033[0m'
  fi
  say() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
  note() { printf '    %s\n' "$1"; }
  die() {
    printf '\n%sstock-deploy stopped:%s %b\n' "$R" "$N" "$1" >&2
    exit 1
  }

  case "${1:-}" in
    "") ;;
    --check) mode="check" ;;
    --force) mode="force" ;;
    --install) mode="install" ;;
    --doctor) mode="doctor" ;;
    --nginx) mode="nginx" ;;
    -h | --help)
      sed -n '2,22p' "$self" | sed 's/^# \{0,1\}//'
      return 0
      ;;
    *) die "unknown option '$1'. Try: stock-deploy --help" ;;
  esac

  # ---- one-time: make "stock-deploy" a command. A small launcher is written (not a link), so
  # it works whatever file permissions git gave this script.
  if [ "$mode" = "install" ]; then
    local dir launcher=""
    for dir in "$HOME/.local/bin" "$HOME/bin"; do
      case ":$PATH:" in
        *":$dir:"*) if [ -d "$dir" ] && [ -w "$dir" ]; then launcher="$dir/stock-deploy"; break; fi ;;
      esac
    done
    local body
    body="$(printf '#!/bin/sh\n# written by: bash %s --install\nexec bash "%s" "$@"\n' "$self" "$self")"
    if [ -n "$launcher" ]; then
      printf '%s\n' "$body" > "$launcher"
      chmod 755 "$launcher"
    else
      launcher="/usr/local/bin/stock-deploy"
      if [ -w "/usr/local/bin" ]; then
        printf '%s\n' "$body" > "$launcher"
        chmod 755 "$launcher"
      else
        note "Writing $launcher needs administrator rights (sudo will ask for your password)."
        printf '%s\n' "$body" | sudo tee "$launcher" > /dev/null || die "could not write $launcher. Instead, add this line to ~/.bashrc:\n    alias stock-deploy='bash $self'"
        sudo chmod 755 "$launcher"
      fi
    fi
    printf '%sInstalled:%s %s\n' "$G" "$N" "$launcher"
    note "From now on, deploy with:  stock-deploy"
    return 0
  fi

  cd "$app_dir"
  [ -d .git ] || die "$app_dir is not a git checkout."
  local need
  for need in git node npm; do
    command -v "$need" > /dev/null || die "'$need' is not installed or not on the PATH."
  done

  # ---- names and addresses come from the pm2 process file, so there is one place to change them
  local app port origin host
  read_config() {
    app="$(node -p "require('./deploy/ecosystem.config.cjs').apps[0].name" 2> /dev/null || echo vinaytiwari)"
    port="$(node -p "require('./deploy/ecosystem.config.cjs').apps[0].env.PORT" 2> /dev/null || echo 5100)"
    origin="$(node -p "require('./deploy/ecosystem.config.cjs').apps[0].env.PUBLIC_ORIGIN" 2> /dev/null || echo "")"
    host="${origin#*://}"
    host="${host%%/*}"
  }
  read_config

  # What answers at an address: "json" (the app), "html" (a page — so not the app), "down"
  # (nothing answered) or "other". An API address that comes back as a page is the tell-tale of
  # a web server handing out the site's files instead of passing the request to the app.
  probe() {
    node -e '
      const u = process.argv[1];
      const lib = u.startsWith("https:") ? require("https") : require("http");
      const done = (x) => { console.log(x); process.exit(0); };
      const req = lib.get(u, { timeout: 8000, headers: { accept: "application/json" } }, (r) => {
        const t = String(r.headers["content-type"] || "");
        r.resume();
        done(/json/i.test(t) ? "json" : /html/i.test(t) ? "html" : "other");
      });
      req.on("timeout", () => { req.destroy(); done("down"); });
      req.on("error", () => done("down"));
    ' "$1" 2> /dev/null || echo down
  }

  # The lines nginx needs so that /api and /me reach the app while it goes on serving the
  # site's files itself. Printed, never written: you decide where they go.
  nginx_rules() {
    sed "s/__PORT__/$port/g; s/__APP__/$app/g; s/__HOST__/${host:-your-domain}/g" << 'NGINX'
# __HOST__ — the private area (/me) and everything under /api run in the Node app
# (pm2: __APP__, port __PORT__). nginx keeps serving the site's own files.
# Printed by:  stock-deploy --nginx
#
# Use: save this as /etc/nginx/snippets/__APP__-app.conf, then inside the site's
# "server { … listen 443 ssl … }" block add, above its "location / {" line:
#     include snippets/__APP__-app.conf;
#
# The proxy_pass lines have NO path after the port: the address is passed on unchanged.
# (With a trailing slash nginx would strip "/api/" and the app would not recognise it.)

location ^~ /api/ {
    proxy_pass http://127.0.0.1:__PORT__;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;      # live prices and order updates are streams: pass them on at once
    proxy_read_timeout 1h;    # a stream stays open; research and AI answers can take minutes
    client_max_body_size 8m;  # a tradebook CSV for the journal can be a few megabytes
}
location = /me {
    proxy_pass http://127.0.0.1:__PORT__;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ^~ /me/ {
    proxy_pass http://127.0.0.1:__PORT__;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
NGINX
  }
  if [ "$mode" = "nginx" ]; then
    nginx_rules
    return 0
  fi

  # What to do when the public address does not reach the app: said once, in one place.
  nginx_help() {
    local files
    files="$(grep -Rls "$host" /etc/nginx/sites-enabled /etc/nginx/conf.d 2> /dev/null | tr '\n' ' ' || true)"
    note "nginx is serving this site's files itself and answers /api with the site's own page,"
    note "so nothing under /api (sign-in included) reaches the app. The fix is in nginx:"
    note ""
    note "  1. Write the pass-through rules:"
    note "       stock-deploy --nginx | sudo tee /etc/nginx/snippets/${app}-app.conf > /dev/null"
    note "  2. Open the site's nginx file${files:+ ($files)}:"
    if [ -z "$files" ]; then note "       find it with:  sudo grep -Rl \"$host\" /etc/nginx/sites-enabled /etc/nginx/conf.d"; fi
    note "     In the block that has \"listen 443\" and \"server_name $host\", add this line"
    note "     just above its \"location / {\" line:"
    note "       include snippets/${app}-app.conf;"
    note "  3. sudo nginx -t && sudo systemctl reload nginx"
    note "  4. stock-deploy --doctor"
  }

  # After a deploy: does the address people use actually reach the app?
  public_check() {
    [ -n "$origin" ] || return 0
    case "$(probe "$origin/api/auth/status")" in
      json) note "$origin reaches the app" ;;
      html)
        printf '\n%s    Careful: %s/api does NOT reach the app.%s\n' "$Y" "$origin" "$N"
        note "Signing in will bounce to the home page until this is fixed. Run:  stock-deploy --doctor"
        ;;
      *) note "(could not check $origin from this machine; open it in a browser)" ;;
    esac
  }

  # ---- stock-deploy --doctor: read-only checks, in the order a request travels backwards
  if [ "$mode" = "doctor" ]; then
    say "Checking how the site is wired up"
    local bad=0 seen
    if ! command -v pm2 > /dev/null; then
      note "1. pm2 ................................ ${R}not installed${N}  (npm i -g pm2)"
      bad=1
    elif pm2 describe "$app" > /dev/null 2>&1; then
      note "1. The app is registered with pm2 ..... ${G}yes${N} ($app)"
    else
      note "1. The app is registered with pm2 ..... ${R}NO${N}"
      note "   Start it:  stock-deploy --force"
      bad=1
    fi
    seen="$(probe "http://127.0.0.1:${port}/api/auth/status")"
    if [ "$seen" = "json" ]; then
      note "2. The app answers on port $port ....... ${G}yes${N}"
    else
      note "2. The app answers on port $port ....... ${R}NO${N} ($seen)"
      note "   See why:  pm2 logs $app --lines 50"
      bad=1
    fi
    if [ -z "$origin" ]; then
      note "3. No public address is set in deploy/ecosystem.config.cjs: skipped."
    else
      seen="$(probe "$origin/api/auth/status")"
      case "$seen" in
        json) note "3. $origin/api reaches the app ... ${G}yes${N}" ;;
        html)
          note "3. $origin/api reaches the app ... ${R}NO${N}"
          note ""
          nginx_help
          bad=1
          ;;
        *)
          note "3. $origin/api ... ${Y}no answer from this machine${N} ($seen)"
          note "   If the site opens in a browser, check there:  $origin/api/auth/status  should show JSON, not a page."
          ;;
      esac
    fi
    if [ "$bad" = 0 ]; then
      printf '\n%s    Everything is wired up.%s\n' "$G" "$N"
      return 0
    fi
    return 1
  fi

  # ---- one deploy at a time
  local lock="$app_dir/.git/stock-deploy.lock"
  if ! mkdir "$lock" 2> /dev/null; then
    die "another stock-deploy is running. If none is (one was cut off), remove the marker:\n    rmdir '$lock'"
  fi
  # shellcheck disable=SC2064
  trap "rmdir '$lock' 2> /dev/null || true" EXIT
  trap 'exit 130' INT TERM

  local started=$SECONDS
  local record="$app_dir/.git/stock-deploy-last" # the commit the last successful run deployed

  # ---- 1. the code
  say "Checking GitHub ($branch)"
  local cur
  cur="$(git rev-parse --abbrev-ref HEAD)"
  [ "$cur" = "$branch" ] || die "this folder is on branch '$cur', not '$branch'. Switch back with:\n    git checkout $branch"
  git fetch --quiet origin "$branch" || die "GitHub could not be reached (git fetch failed). Nothing was changed."

  local before remote last
  before="$(git rev-parse HEAD)"
  remote="$(git rev-parse "origin/$branch")"
  last="$(cat "$record" 2> /dev/null || true)"
  if [ -n "$last" ] && ! git cat-file -e "${last}^{commit}" 2> /dev/null; then last=""; fi

  local waiting
  waiting="$(git log --oneline "${before}..${remote}" 2> /dev/null || true)"

  if [ "$mode" = "check" ]; then
    note "On this server:  $(git log -1 --format='%h %s' "$before")"
    if [ -n "$last" ]; then note "Last deployed:   $(git log -1 --format='%h %s' "$last")"; else note "Last deployed:   not yet by this command — the first run does everything once"; fi
    if [ -n "$waiting" ]; then
      note "Waiting on GitHub:"
      printf '%s\n' "$waiting" | sed 's/^/      /'
    else
      note "Nothing new on GitHub."
    fi
    local held
    held="$(git status --porcelain --untracked-files=no)"
    if [ -n "$held" ]; then
      note "Files changed on this server (lock files are put back by a deploy; anything else stops it):"
      printf '%s\n' "$held" | sed 's/^/      /'
    fi
    note "Nothing was changed. Deploy with:  stock-deploy"
    return 0
  fi

  # files changed on this server: npm's rewrites of a lock file are put back; anything else is yours
  local dirty line file other=""
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ -n "$dirty" ]; then
    while IFS= read -r line; do
      file="${line:3}"
      case "$file" in
        package-lock.json | server/package-lock.json)
          git checkout -- "$file"
          note "put back $file (npm had rewritten it)"
          ;;
        *) other+="      $line"$'\n' ;;
      esac
    done <<< "$dirty"
    if [ -n "$other" ]; then
      die "these files were changed on this server, and the update would run into them:\n${other}    Keep the changes aside:  git stash\n    Or drop them:            git checkout -- <file>\n    Then run stock-deploy again. Nothing was changed."
    fi
  fi

  if [ "$before" != "$remote" ]; then
    git merge --quiet --ff-only "origin/$branch" || die "this server has commits that are not on GitHub, so the update cannot simply be added on top.\n    See them with:  git log origin/$branch..HEAD --oneline"
    note "updated $(git rev-parse --short "$before") → $(git rev-parse --short HEAD)"
  else
    note "the code is already the latest ($(git rev-parse --short HEAD))"
  fi
  local head
  head="$(git rev-parse HEAD)"

  # this script itself changed: hand over to the new one, which carries on from here
  if [ "$before" != "$head" ] && [ -z "${STOCK_DEPLOY_HANDOVER:-}" ] && ! git diff --quiet "$before" "$head" -- deploy/stock-deploy.sh; then
    note "stock-deploy itself was updated — continuing with the new version"
    rmdir "$lock" 2> /dev/null || true
    trap - EXIT
    STOCK_DEPLOY_HANDOVER=1 exec bash "$self" "$@"
  fi

  # ---- what this update needs
  local changed="" full=0
  if [ "$mode" = "force" ] || [ -z "$last" ]; then
    full=1
  else
    changed="$(git diff --name-only "$last" "$head")"
  fi
  has() { printf '%s\n' "$changed" | grep -Eq "$1"; }

  local site_pkgs=0 api_pkgs=0 build=0 restart=0 fresh_config=0
  if [ "$full" = 1 ]; then
    site_pkgs=1 api_pkgs=1 build=1 restart=1
  else
    if has '^(package\.json|package-lock\.json|\.npmrc)$'; then site_pkgs=1; fi
    if has '^server/package(-lock)?\.json$'; then api_pkgs=1; fi
    if has '^(src/|public/|scripts/|package\.json$|package-lock\.json$|\.npmrc$|\.env)'; then build=1; fi
    if printf '%s\n' "$changed" | grep -E '^server/' | grep -Evq '^server/(test/|\.env\.example$)'; then restart=1; fi
    if has '^deploy/ecosystem\.config\.cjs$'; then restart=1 fresh_config=1; fi
  fi
  # whatever is simply missing is put right, changed or not
  if [ ! -f build/index.html ]; then build=1 restart=1; fi # the server only serves a site that existed when it started
  if [ "$build" = 1 ] && [ ! -e node_modules/.bin/react-scripts ]; then site_pkgs=1; fi
  if [ ! -d server/node_modules ]; then api_pkgs=1; fi
  if [ "$api_pkgs" = 1 ]; then restart=1; fi

  read_config

  if [ "$site_pkgs$api_pkgs$build$restart" = "0000" ]; then
    printf '%s\n' "$head" > "$record"
    say "Nothing to rebuild"
    if [ -n "$last" ] && [ "$last" != "$head" ]; then
      note "The update changed only files the running site does not use (docs, tests)."
    else
      note "This server already runs the latest code: $(git log -1 --format='%h %s' "$head")"
    fi
    note "To rebuild and restart anyway:  stock-deploy --force"
    public_check
    return 0
  fi

  # ---- 2. packages
  if [ "$site_pkgs" = 1 ]; then
    say "Installing the site's packages"
    npm ci --no-audit --no-fund || die "npm ci failed. The running site was not touched."
  fi
  if [ "$api_pkgs" = 1 ]; then
    say "Installing the server's packages"
    npm run server:install || die "installing the server's packages failed. The server was not restarted."
  fi
  git checkout -- package-lock.json server/package-lock.json 2> /dev/null || true # leave the checkout clean

  # ---- 3. the site, built aside and swapped in whole
  if [ "$build" = 1 ]; then
    say "Building the site"
    rm -rf build.next
    if ! CI=false BUILD_PATH=build.next npm run build; then
      rm -rf build.next
      die "the build failed (see above). The running site was not touched, and the server was not restarted."
    fi
    [ -f build.next/index.html ] || die "the build ended without an index.html. The running site was not touched."
    rm -rf build.old
    if [ -d build ]; then mv build build.old; fi
    mv build.next build
    rm -rf build.old
    note "the new site is in place"
  fi

  # ---- 4. the server
  if [ "$restart" = 1 ]; then
    say "Restarting the server (pm2: $app)"
    command -v pm2 > /dev/null || die "pm2 is not installed or not on the PATH (npm i -g pm2). The new code is in place but the old server is still running."
    if pm2 describe "$app" > /dev/null 2>&1; then
      if [ "$fresh_config" = 1 ]; then
        # the process file changed: start it afresh so its settings apply
        pm2 delete "$app" > /dev/null
        pm2 start deploy/ecosystem.config.cjs > /dev/null || die "pm2 could not start $app. See:  pm2 logs $app --lines 50"
      else
        pm2 restart "$app" > /dev/null || die "pm2 could not restart $app. See:  pm2 logs $app --lines 50"
      fi
    else
      pm2 start deploy/ecosystem.config.cjs > /dev/null || die "pm2 could not start $app. See:  pm2 logs $app --lines 50"
    fi
    pm2 save > /dev/null 2>&1 || true

    local up=0 try
    for try in $(seq 1 30); do
      if node -e "require('http').get('http://127.0.0.1:${port}/', (r) => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))" 2> /dev/null; then
        up=1
        break
      fi
      sleep 1
    done
    [ "$up" = 1 ] || die "the server did not answer on port $port within 30 seconds.\n    See why:  pm2 logs $app --lines 50"
    note "the server is answering on port $port (after ${try}s)"
  else
    note "The server was not restarted: only the site's files changed, and it serves them from disk."
  fi

  # ---- done
  printf '%s\n' "$head" > "$record"
  say "${G}Deployed${N}${B} $(git log -1 --format='%h %s' "$head")"
  if [ -n "$last" ] && [ "$last" != "$head" ]; then
    git log --oneline "${last}..${head}" | head -n 12 | sed 's/^/      /'
  fi
  local did=""
  [ "$site_pkgs" = 1 ] && did+="site packages · "
  [ "$api_pkgs" = 1 ] && did+="server packages · "
  [ "$build" = 1 ] && did+="site built · "
  [ "$restart" = 1 ] && did+="server restarted · "
  note "${did}$((SECONDS - started)) seconds${origin:+ · $origin}"
  if [ "$restart" = 1 ]; then note "${Y}The Zerodha live stream reconnects by itself; an open terminal page may need a refresh.${N}"; fi
  public_check
}

main "$@"; exit
