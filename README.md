# Vinay Kumar Tiwari — Engineer & Author

A single-page, motion-led personal site: who Vinay is (an engineer from
Ghazipur, working in Noida), eleven years of enterprise engineering
(SAP BTP · CAPM · Fiori/UI5 · HANA Cloud · GenAI), and the Hindi writing he
does at night. `/technical` and `/writings` no longer exist — both redirect to `/`.

Current role: **Package Consultant — SAP BTP, IBM India Pvt. Ltd.**

## Run it

```bash
npm install      # only if node_modules is missing
npm start        # http://localhost:3000
npm run build    # production bundle in /build
```

## Structure

```
src/
├─ App.js                     public site ("/") or the private area, never both
├─ admin/                     the private area: login, dashboard, settings screens
│  └─ stock/                  Stock Report: world clock + exchange holiday calendars
├─ analytics/                 Google Analytics loader (skips local runs and admins)
├─ setupProxy.js              dev only: forwards /api to the Node server
├─ pages/Home.jsx             the page: sections in order, nav links, ticker
├─ styles/site.css            design tokens & all component styles
├─ hooks/useSmoothScroll.js   dependency-free inertial scroll (Lenis-style)
├─ sections/                  one file per block of the page, top to bottom
│  ├─ Hero.jsx                name, role line, stats, portrait
│  ├─ About.jsx               the person; by day / by night
│  ├─ Journey.jsx             the path from Ghazipur to Noida
│  ├─ Stack.jsx · Experience.jsx · Projects.jsx
│  ├─ Writer.jsx              "एक लेखक के रूप में विनय" — the Hindi bio (warm band)
│  ├─ Credentials.jsx · Faq.jsx · Contact.jsx
├─ components/
│  ├─ ui/motion.jsx           Reveal · MaskLine · SplitWords · Magnetic ·
│  │                          Counter · Parallax · Tilt
│  ├─ seo/Seo.jsx             title, meta, JSON-LD for the page
│  └─ site/                   Nav · Footer · Preloader · Cursor · Marquee ·
│                             Assistant (in-browser retrieval) · Kulhad · …
└─ data/                      profile · author · experience · projects ·
                              certs · awards · seo   ← edit content here
```

## Private admin area — `/me`

The whole system in this area is called **DrishtiAI** ("DrishtiAI — the AI Trading Advisor for NSE").
How to write the name, where it comes from in code (`src/admin/brand.js`, `server/brand.js`), the one
button system (`src/admin/buttons.css`, loaded last) and the rules that keep every text readable in
the light and dark themes are in [BRAND.md](BRAND.md).

A login-protected control room that is **not linked from the public site**, is served
`noindex`, and loads none of the public site's code. It needs the small Node server in
`server/` (a static-only host cannot run it; the public site still works there).

**Who can do what**

| | Superadmin | Admin |
| --- | --- | --- |
| Sign in with Google | `vinaytiwari.iist@gmail.com` (the owner: fixed, always allowed) and anyone the owner has made a superadmin | Anyone a superadmin adds |
| Google sign-in settings, Analytics ID, dashboard | yes | yes |
| Add / remove admin users | **yes** | no |
| Make someone a superadmin, or take it away | **the owner only** | no |
| The Personal pages: the Kundali (`/me/kundali`, in Hindi) and Expenses (`/me/expenses`) | **yes** | no |

**Superadmins (2026-11-20).** The owner can add a person as a superadmin or make an admin one (`POST /api/admin/admins
{ email, role: "superadmin" }`, `PUT /api/admin/admins/:email { role }` — owner only). A superadmin is a superadmin
everywhere (`identify()` in `server/app.js` gives the role; `owner` is true for `SUPERADMIN_EMAIL` alone), the site's
own Zerodha account included; only the owner can add, change or remove one, and the owner cannot be removed.

**The Kundali (2026-11-20; `server/kundali.js`, `src/admin/kundali/`).** The owner's birth chart, its reading in Hindi
and the papers behind it, for superadmins only. The chart is one private record (`kundali/record.json`), the papers are
files under `server/data/media/`; neither is in this repository or in the client bundle. The page draws the charts,
works the Vimshottari dasha out for today (`jyotish.js`, checked against the printed tables), and reads, downloads,
adds and removes the papers. A chart is carried to another server with Export / Import on the page.
Since 2026-11-21 a chart may also carry `doshas`, `gochar` (transit rows with date `spans`; today's is marked),
`sadhana`, `dasha.detail` / `dasha.pd`, and per-yoga `strength` / `detail` / `when` / `do` and per-remedy method fields
— the page shows each only when present, behind "read more" folds that open for printing.

**Expenses (2026-11-20; `server/expenses.js`, `src/admin/expenses/`).** The owner's expense tracker, under Personal on
/me, superadmins only (one shared ledger). An entry is a day, an amount, one of 52 categories in 8 groups, a few words,
a way of paying and a note; routes `GET|POST /api/admin/expenses`, `PUT|DELETE /api/admin/expenses/:id`; one record per
entry in collection `expenses`. The page filters by period, words, group and way of paying, and everything under the
filter row — figures, the stacked chart (a bar a day, month or year), the split by group and category, the sortable list
— describes the same entries; the whole ledger is also tabled month by month and year by year, and what is shown can be
exported as CSV. The arithmetic is `ledger.js` (pure, tested); the group colours were validated for colour-blind
separation on the private area's surfaces.
**Since 2026-11-21:** a **Stock Market** group of trading-desk costs (Kite API, ChatGPT, Claude, AI API tokens, charting
data, broadband, mobile, IT hardware, office rent and setup, Demat AMC, courses, CA and more), Health merged into
"Health & lifestyle" so the groups stay eight colours; category ids never change, so old entries keep theirs. The page
was redesigned as an analytics dashboard — scorecards with change and sparkline, a trend line against the period before,
a ring chart with a figure legend, top categories, Stock Market costs, weekdays and ways of paying — drawn in plain SVG
and HTML by `src/admin/expenses/charts.jsx` (no chart library).

**No text spills or is cut off (2026-11-21).** `src/admin/fit.css`, loaded last in the private area, keeps long words
wrapping, pins screen-reader-only labels so they cannot widen a phone page, and turns the few "…"-shortened labels into
wrapping ones. Every page (/me, all Stock Report views, Expenses, Kundali, TradeAI, Social, settings pages, the chart and
the public site) was checked at 390, 768, 1024 and 1440 px for sideways scroll, spilled, cut or "…"-shortened text.

**The main page's path (2026-11-20).** `JOURNEY` in `src/data/profile.js` is one stop per city with its years —
Ghazipur, Indore, Pune, Bengaluru, Noida (the owner's own list); the hero line, the portrait tag, the scrolling strip,
the author's bio and the search-engine text name the same cities.

**Two palettes.** The public site wears the owner's own colours — sandal ivory, ruby maroon, copper and a line of gold —
chosen from his chart (2026-11-20). The private area (/me and everything under it) wears **Zerodha's theme** since
2026-11-21: Kite's own light and dark values (from Kite's published stylesheet) and Console's primary blue, with text
shades darkened just enough to read; the flat Kite look is `src/admin/kite.css`, loaded last. The private area states
its light colours itself (`.adm[data-theme="tech"]` in `analyzer.css`) because the public theme sits on the same
element. Details in `BRAND.md`.

**Zerodha's P&L words (2026-11-21).** Realised P&L, Charges & taxes, Other credits & debits, Net realised P&L and
Unrealised P&L everywhere a profit or loss is shown (Journal, its period tables and report, the Day book, the Positions
page's funds); the Journal opens with Zerodha's five-figure strip and lists P&L by symbol in Console's columns
(`src/admin/stock/trade/PnlReport.jsx`; the per-symbol quantities and buy/sell values come from `group()` in
`server/trading/journal.js`).

Having a Google account is not enough: only these addresses can sign in, and removing an
admin ends their session immediately.

**Run it locally (two terminals)**

```bash
npm run server:install   # once: installs server/ dependencies
npm run server           # API on http://localhost:5000
npm start                # site on http://localhost:3000 — /api is proxied to :5000
```

**First-time setup.** On first start the server prints a one-time *setup token*. Open
`/me`, paste the token with your Google **Client ID** and **Client Secret**
(Google Cloud Console → Credentials → OAuth client → *Web application*; add the redirect URI
shown on that screen, e.g. `http://localhost:3000/api/auth/google/callback`). After that,
Client ID / Secret / Google Analytics ID are all changed from the dashboard — no restart.

**Production.** `npm run build`, then run `node server/index.js` behind HTTPS. One process
serves the API and the built site. Register `https://<your-domain>/api/auth/google/callback`
as a redirect URI too.

| Environment variable | Purpose |
| --- | --- |
| `PORT` | Server port (default 5000) |
| `PUBLIC_ORIGIN` | e.g. `https://vinaytiwari.org` — pins the redirect URI instead of reading the `Host` header |
| `TRUST_PROXY` | `true` when behind a reverse proxy, so HTTPS and client IPs are read correctly |
| `SUPERADMIN_EMAIL` | Override the superadmin address |
| `SETUP_TOKEN` | Fix the first-run token instead of a random one |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional bootstrap; values saved in the dashboard take priority |
| `SETTINGS_KEY`, `SESSION_SECRET` | Optional 32-byte keys (hex/base64); otherwise generated into `server/data/` |
| `MONGO_URI`, `MONGO_DB` | Keep records in MongoDB (database default `stock-trading`) instead of files |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`starttls`/`ssl`/`none`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME` | Optional bootstrap for outgoing email (sign-in links and codes); the mail server saved in the dashboard takes priority |

Any of these can also go in `server/.env` (git-ignored; see `server/.env.example`), which the server reads at start.

**Signing in.** Two ways, both ending at the same person: **Google**, and **email** (a password chosen from an emailed link, or a 6-digit code sent to the inbox). Only the superadmin and the admins added under *Admin users* can sign in, by any route. The sign-in page also has **Create account**: asking never grants access — a new address becomes a request the superadmin approves (an email tells them), and an address already on the list gets its set-up link. One mailbox is one user: capitals, and for Gmail dots, `+tags` and `googlemail.com`, are folded, so the same address is never added twice and Google and email reach the same record. The owner sets the mail server (SMTP host, port, user, password, From), the site address used in emailed links, and which ways are open from **Email & sign-in** on the dashboard (superadmin); the SMTP password is stored encrypted. Protections: scrypt password hashing with a policy, a 15-minute lock after five wrong tries, one-time links and codes that expire, the same answer for unknown and unlisted addresses, links built from the configured address (never the `Host` header), signing out everywhere after a password change, a security notice by email, and an audit trail of sign-ins. Code: `server/email-auth.js`, `server/mailer.js`, `server/passwords.js`. Needs Node 20 or newer (the mail library).

**Data.** Everything lives in `server/data/` (git-ignored): `db.json` (settings, admin list;
the Client Secret is stored AES-256-GCM encrypted), plus the two key files. Back that folder
up; losing `settings.key` means re-entering the Client Secret.

**Where records live: MongoDB or files** (`server/docs.js`). With `MONGO_URI` set, the server keeps
its records in MongoDB, database `MONGO_DB` (default `stock-trading`): collection `docs` holds
settings and admins (secrets still encrypted), the watchlist, the trading switch and limits, the
AI journal, skills file, world brief, news checks, co-pilot state, debriefs, coach readings and
research reports; collection `logs` holds the trading audit log. Everything is read once at
start-up and every change is written straight through, so the server must run as **one**
process. On the first start against an empty database it imports whatever is in
`server/data/`. Without `MONGO_URI` the same records are files in `server/data/`. Either way,
caches that can be downloaded again (candles, the instrument list, the screener's data, exchange
holidays) stay as files, and so do the two encryption keys unless `SETTINGS_KEY` and
`SESSION_SECRET` are set — a key stored beside the secrets it protects would protect nothing.
`npm run db:check` connects, writes and reads back a test record, and lists what is stored.

**Deploying on the VPS (the folder the static site is served from today).** The steps, once:

1. Node 20 or newer, and pm2 (`npm i -g pm2`).
2. In the folder: `git pull`, then `npm ci` (the site), `npm run server:install` (the API), and
   `npm run build`.
3. `cp server/.env.example server/.env` and fill it in: `MONGO_URI` (the VPS's MongoDB),
   `MONGO_DB=stock-trading`, and the two keys (the file says how to make them; keep a copy
   somewhere safe). Then `npm run db:check`.
4. `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup` — one process on port 5100
   (change it in that file if the port is taken). The first start prints a one-time setup token
   (`pm2 logs vinaytiwari`); open `https://vinaytiwari.org/me` and paste it with the Google
   Client ID and Secret. Then the watchdog and log rotation: see **Staying up** below
   (`stock-deploy --keepalive` checks all of it).
5. nginx: pass `/api` and `/me` to the process (it can go on serving the built site itself).
   **The one-step way: `stock-deploy --nginx-apply`** — it writes the flood limits and the
   pass-through rules, adds the include line to the site's file if it is missing, runs `nginx -t`,
   reloads, and checks that the public `/api` answers as the app; if any step fails it puts every
   file back and nginx keeps running on the old ones. By hand instead:
   `stock-deploy --nginx | sudo tee /etc/nginx/snippets/vinaytiwari-app.conf > /dev/null`, then add the
   one line `include snippets/vinaytiwari-app.conf;` inside the site's HTTPS `server` block, above its
   `location / {` line, and `sudo nginx -t && sudo systemctl reload nginx`. `deploy/nginx.conf.example`
   shows it, and the alternative of sending everything through the app. **`stock-deploy --doctor`**
   checks the whole chain — pm2, the app's port, and whether the public address reaches the app —
   and, when nginx is the missing link, prints the exact lines to copy for the site's own nginx
   file (it keeps a copy of the file first, and says how to put it back).
   *If "Login with Google" lands on the home page, this step is missing:* nginx is answering
   `/api/…` with the site's own page. The private area now says so itself ("Can't reach the
   server") instead of showing a sign-in button that cannot work.
6. Google Cloud console: add `https://vinaytiwari.org/api/auth/google/callback` as a redirect URI.
   Kite developer console: set the redirect URL to
   `https://vinaytiwari.org/api/admin/market/kite/callback` and register **this VPS's public IP**
   as the app's static IP (Zerodha requires it for orders placed through the API).
7. Back up the database (`mongodump --db stock-trading`) and `server/.env`; never commit either.

**Updating later: one command, `stock-deploy`** (`deploy/stock-deploy.sh`). Set it up once on the
VPS — `cd ~/tcs-ai-hackathon-2025 && git pull && bash deploy/stock-deploy.sh --install` — and from then
on type `stock-deploy` from any folder. It pulls `main` from GitHub (fast-forward only: it never
merges and never discards work done on the server), installs packages only where a package file
changed, builds the site into a spare folder and swaps it in only if the build succeeded (a failed
build leaves the running site as it was), restarts the pm2 process only when server code changed,
and waits for it to answer. `stock-deploy --check` shows what is waiting without changing
anything; `stock-deploy --force` reinstalls, rebuilds and restarts regardless. It never touches
`server/.env`, the database or `server/data`. By hand, the same thing is
`git pull && npm ci && npm run server:install && npm run build && pm2 restart vinaytiwari`.

**Staying up — what restarts what.** Three layers, each catching what the one before cannot:

| Trouble | What notices | What happens |
|---|---|---|
| A crash (an exception nothing caught; a burst of 20+ unhandled promise rejections in a minute) | the process itself (`server/lifecycle.js`) | logged, written to `server/data/last-crash.json`, the database flushed (≤ 1.5 s), the process exits — pm2 starts a clean one at once |
| The process exits, or grows past 1 GB (600 MB until 2026-11-21; the heap is capped at 800 MB so Node collects garbage first) | pm2 (`deploy/ecosystem.config.cjs`) | restarted; a crash loop backs off (200 ms → 15 s) and after 15 starts that die within 30 s pm2 stops trying |
| A hang: the process is up but no longer answers | the watchdog (`deploy/watchdog.sh`, every minute) | 3 failed `GET /api/live` in a row → `pm2 restart`; pm2 gave up (errored) → restart; pm2 lost the app → `pm2 resurrect`. Never during a `stock-deploy`, never when the app was stopped on purpose |
| The machine reboots | systemd (`pm2 startup`) | pm2 starts again with the saved process list (`pm2 save`) |

A stop or restart is clean: new connections are refused, requests in flight finish, the live streams
are closed after 3 s, the database is closed, and after 8 s the process leaves regardless (pm2 waits
10 s), so a restart can never hang. pm2 counts the process as up only when it says it is listening
(`wait_ready`). A single unhandled promise rejection is logged and counted, not fatal. A blocked event
loop (2 s or more) is logged. **Site health → Server** shows the uptime, memory, pm2's restart count,
any crash in the last 24 hours with its message, event-loop stalls today and rejections logged.
`GET /api/live` (`{ ok, up, at }`, no sign-in, no database, nothing private) is the watchdog's question.
One process only (`instances: 1`): the trading guard rails and the live price stream live in its memory,
so a restart briefly drops open streams (pages reconnect by themselves) — there is no zero-downtime
reload with one process, and that is the deliberate trade.

**The 502 loop of 2026-11-21, and why it cannot come back.** The site answered 502 once a minute: `/api/live`'s
uptime climbed to ~58 s, then started again from 0. The 20 Nov change of the forecaster's model version (3 → 4) made
it retrain itself 30 s after every start; training on the stored year inside the web process (~210 MB on top of the
app, measured on a production-sized synthetic history) took it past pm2's 600 MB limit, pm2 restarted it at its next
30-second memory check, the training never finished — and "tried a moment ago" lived only in memory, so the new
process trained again. Now: (1) `server/train-guard.js` keeps in the record store when each automatic training or
evening learning (forecaster, early calls, evidence desk) began and whether it ended; nothing automatic runs in the
first 5 minutes after a start, and a run the server did not live through waits 30 min, then 1 h, 2 h … up to a day
(the owner's own click is never held back); (2) the supervisor marks a duty as running in its record and, after a
restart, counts one still marked as failed and pauses it, and it too waits 5 minutes after a start; (3) pm2's limit
is 1 GB with an 800 MB heap; (4) every stop is written to `server/data/last-stop.json` (signal, memory, uptime) and
**Site health → Server** says when the last restart was pm2's memory limit and which training is paused;
`stock-deploy --doctor` shows uptime, memory, pm2's restart count, how many of those were for memory, and the
machine's free memory. To see it from outside: `curl -s https://vinaytiwari.org/api/live` a few times a minute —
`up` should keep growing.

One-time setup on the VPS, after the next `stock-deploy` (which applies the new process file by itself).
Check what is already in place — it prints any command still needed:

```bash
stock-deploy --keepalive
```

Start pm2 again after a reboot — this prints one `sudo …` line: copy and run it, then save the list:

```bash
pm2 startup systemd -u "$USER" --hp "$HOME"
```

```bash
pm2 save
```

Run the watchdog every minute (one line; it fills in where pm2 and node live, since cron's PATH is bare):

```bash
( crontab -l 2>/dev/null | grep -v deploy/watchdog.sh; echo "* * * * * PATH=$(dirname "$(command -v pm2)"):$(dirname "$(command -v node)"):/usr/bin:/bin bash $HOME/tcs-ai-hackathon-2025/deploy/watchdog.sh >> $HOME/.pm2/logs/watchdog.log 2>&1" ) | crontab -
```

Rotate the logs so they never fill the disk:

```bash
pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 14 && pm2 set pm2-logrotate:compress true
```

See what the watchdog sees, and its log:

```bash
bash ~/tcs-ai-hackathon-2025/deploy/watchdog.sh --status; tail -n 20 ~/.pm2/logs/watchdog.log
```

**Welcome on the dashboard** was removed on 13 Nov 2026 at the owner's request (no picture, no audio).

- **The picture.** The original (`assets-src/ShriRamDarbar.png`, 3.8 MB, kept as the master copy and
  not deployed) was re-encoded with ffmpeg for the web: `public/img/shri-ram-darbar-960.avif`
  (0.32 MB, ordinary screens), `…-1672.avif` (0.67 MB, high-density screens) and
  `…-960.jpg` (a fallback for browsers without AVIF). AVIF at full colour resolution was chosen
  because the picture is dense, saturated detail: WebP halves the colour resolution and visibly
  softens it. Side-by-side crops were checked by eye; SSIM against the original is 0.98. The server
  labels `.avif` as `image/avif` itself (the static-file library predates the format).
- **The mantra.** If `public/audio/shri-ganeshay-namah.mp3` exists it is played (add your own
  recording there — one you have the right to use). Otherwise the browser speaks it, in a Hindi
  voice when the device has one (`src/admin/mantra.js`). Browsers refuse sound until the page has
  been touched, and a page that has just been opened has not been: the welcome then shows
  "Play the mantra", stays until it is answered, and plays the mantra from that one tap.

**Hover help (the whole private area).** Rest the pointer on a label, a number or a button and a
bubble says what it means; with the keyboard it appears on focus; on a phone, tap a label. One
component does it everywhere (`src/admin/help/TipLayer.jsx`, mounted in `AdminApp.jsx`):

- **The words** are in one file, `src/admin/help/glossary.js`: about 280 explanations for some 340
  labels ("VWAP", "Range used", "Go live", "After costs", …). Labels are matched by their text as
  the page draws, so a screen needs no markup to get help. A word with two meanings is told apart
  by where it is (the third item of an entry is a CSS scope).
- **To add or change help:** edit the glossary, or put `data-tip="…"` on any element (that always
  wins). An existing `title="…"` is shown in the same bubble, and a symbol-only button (×) is
  explained by its `aria-label`.
- **Switching it off:** "Hover help: on / off" in the footer of every page, remembered on the
  device. A one-time strip under the header says the help exists.

**Type (the whole private area).** `/me` and every page under it use the typeface and the text
sizes of Zerodha Kite's web app, read from its public stylesheet: Open Sans; 14px text; 12px labels,
column heads and captions; 18px section titles; 24px page titles and prices; regular weight, with
600 for emphasis; no letter-spacing; capitals only on small status tags (LONG, CLOSED, CONNECTED).
Only the type follows Kite — the colours, the layout and the name stay this site's own.

- **One ladder of sizes.** The steps are variables at the top of `src/admin/admin.css`: `--t-tag`
  10.8px, `--t-small` 12, `--t-mid` 13, `--t-base` 14, `--t-lead` 16, `--t-title` 18, `--t-large`
  24, `--t-xlarge` 32, `--t-xxlarge` 42. Text in `admin.css` and `analyzer.css` takes its size from
  them, so changing a step changes every screen. The exceptions are deliberate: the mantra on the
  welcome (Devanagari), chart labels drawn inside SVG (11px), and fields on touch screens (16px —
  under that a phone zooms the page into the field).
- **The font** is one more family on the Google Fonts link in `public/index.html`. The public page
  does not use it, and a browser downloads a face's files only on a page that does. Real code (a
  redirect address, the skills file) keeps the fixed-width face through `--f-code`.
- **When adding a screen:** take sizes from the steps (`font-size: var(--t-small)`) and leave
  `font-family`, `letter-spacing` and `text-transform` alone.

**The trading terminal (the Stock Report's layout; `src/admin/stock/StockReport.jsx`,
`src/admin/stock/terminal/`).** One screen, dark by default. A sticky top bar holds the workspaces —
**Desk · Advisor · Positions · Journal · Research · Screener · Debrief · Calendar** — and the state of everything: NSE
open or closed with the IST clock, the Zerodha connection, the trading switch, today's P&L, the
theme, shortcuts and the account menu (hover help, sign out). On the Desk the watchlist, the stock
and the verdict rail sit side by side (three columns from 1280 px), each scrolling on its own, and
your positions are docked along the bottom (open or closed, remembered; not on phones, where
Positions has its own tab). Keyboard: `/` search, `B` / `S` open the order ticket for the open
stock (only while trading is on — nothing is sent without confirming), `1`–`8` workspaces, `D`
dock, `T` theme, `?` the list, `Esc` close. Shortcuts never fire while typing in a field or with a
dialog open (`terminal/shortcuts.js`, tested). **`Ctrl K` (`⌘ K`) opens the command palette**
(`terminal/Palette.jsx`, `paletteMath.js`) from anywhere: a workspace or action, any NSE stock,
a typed trade — `buy sbin 10`, `sell infy 5 @ 1500` — which only ever opens the order ticket,
or a price alert — `alert sbin 800`. Turning trading OFF is one command; turning it ON stays a
deliberate act on the Positions page. The dashboard and settings pages share the same
theme (one switch, `analyzer/theme.js`) and a slim sticky header.

**The full chart (`src/admin/stock/chart/`, the Desk's first chart).** Drawn with TradingView's
open-source Lightweight Charts library (`lightweight-charts` 5.1.0, Apache-2.0; its attribution logo
stays on the chart). Real history from Kite at every interval it offers — 1, 3, 5, 10, 15, 30 and
60 minutes and daily (`GET /api/admin/market/candles/:symbol?interval=`, asked for in the chunks
Kite allows and cached briefly) — plus weekly and monthly bars built from the daily ones; the live
price is folded into the last bar as it trades, and intraday history is re-read every minute.
Seven chart types (candles, hollow candles, Heikin-Ashi, OHLC bars, line, area, baseline); twenty
indicators — SMA/EMA/WMA, Bollinger Bands, VWAP and Supertrend on the price; RSI, MACD,
Stochastic, CCI, Williams %R, ROC, ADX/DMI, ATR and OBV in panes of their own; volume — searchable
in one menu; drawing tools (horizontal line, trend line, Fibonacci retracement, measure; undo and
clear; kept per stock in this browser); compare with another stock or index on a percent scale;
candlestick-pattern markers; classic pivot points; auto / log / percent scales; an OHLC-change-volume
legend under the crosshair; a PNG screenshot and full screen; and a technical summary that tallies
moving averages and oscillators into a gauge. The look follows the terminal's own theme, not
Kite's branding; company financials (as some paid chart sites show) are not available from Zerodha
and are not included. The earlier 1-minute, 5-minute and daily views remain one click away.
Zoom with the floating **− / + / ⟲** buttons over the plot (or the + − 0 keys; the mouse wheel and
pinch also work), anchored on the newest bar as on Kite. **↗ opens the chart in a tab of its own**
(`/me/chart/SYMBOL`, `src/admin/stock/chart/ChartPage.jsx`): the same chart filling the window, with
its own live price, a stock search, the light/dark switch and every tool. Patterns, pivots and the
price scale sit under **View**; on a phone the intervals become one drop-down.
**The opening-price forecast (`server/open-forecast.js`, `server/market/openfc.js`, `src/admin/stock/analyzer/OpenForecast.jsx`).** For the stock open on the Desk, two blocks in the AI strip: the most probable opening price, made before the open and final at 9:00 (the opening auction), and the real opening price beside it from 9:16. Four estimates are blended — the previous close; the expected index gap (GIFT Nifty against the Nifty future and the overseas cues) × the stock's measured sensitivity; a ridge regression on yesterday's behaviour; and that plus a tilt from the chart's lean, the last AI research, the option chain's open interest and the news mood. Every forecast and result is kept (collection `open_forecasts`); after every scoring the weights, each stock's bias, the index cue's bias, the band's width and the worth of the soft evidence are learned again (`market/open-learn.json`), and the findings are written into the trading-skills file every AI feature reads. It runs by itself each trading morning (8:30–9:00 IST) for the watchlist and the index, asks no AI model, and never trades. `GET /api/admin/market/open-forecast/:symbol`.

**AI credit protection (`server/ai/spend.js`).** A request to an AI company leaves the server only when a person pressed an AI button. The check sits in the fetch every model client is built with (`AiService.fetch`), so no feature can reach a model around it: a click is a signed-in POST/PUT with the site's header and everything it starts keeps that (AsyncLocalStorage); timers, page reads and the co-pilot's automatic readings do not — they fail with `not_asked` and the feature carries on with the desk's arithmetic (the morning research writes no AI notes, the social digest uses the free rules, the after-close reviews wait for a button, Go live asks nothing until Ask now). Held answers (the AI Engine's cache) are still served free; model listing (a GET) is free; a message from the owner's own WhatsApp number counts as a click. Refusals are counted and listed, and today's use shown, on the AI page; the owner can lift the rule there (off by default). `GET/PUT /api/admin/ai/spend`.

**The Desk as a cockpit (third design, 2026-11-19: `stock/analyzer/desk3.css`, `StockView.jsx`, `Analyzer.jsx`, `VerdictPanel.jsx`, `StockReport.jsx`).** Measured on a 1440 × 900 screen before the change: the stock began 301 px down the page (a search row, then a 155 px day board), its chart 492 px down, and a positions dock that was open but empty took the last 290 px — about 118 px of chart was on screen; the forecast sat 1,440 px down; the verdict rail was a 509 px window on 3,900 px of text; the column under the watchlist was empty. Now, on screens 1280 px and wider: **(1)** the day board sits **under the watchlist** in the left column (each scrolls on its own), so nothing stands between the search row and the stock — it starts 135 px down; **(2)** one **head** spans the stock and its rail — the price bar (symbol, the live call, the forecast's 5- and 15-minute calls as chips with the check's count, price, Buy / Sell) and the day's figures as one line of label–value pairs — and it **stays on screen** while you scroll; **(3)** the **chart takes the height the screen has left**: `useCockpit` measures where the plot starts on the page and what the dock covers and hands `ProChart` its height (440 px of plot at 1440 × 900, 654 px at 1920 × 1080), re-measured when the window, the head, the dock or the market strip changes; **(4)** the **rail** starts under the head, ends at the bottom of the screen, and has a row of **jumps** (Live call, Co-pilot, Order book, Intraday, Swing, Long term, Circuits, Against, All levels — read from the panel, so only sections that exist get one) that stays at its top; **(5)** the detail tabs stay under the head while a long panel is read; **(6)** the **positions dock** opens by itself only while it holds a position — a choice you make with its bar or the D key is remembered and wins. Below 1280 px the head dissolves (`display: contents`) and the page is the single column it was; at 1000 px and below the order is watchlist → **stock** → day board (the board used to come first). The layout writes two CSS variables, `--dk-head` and `--dk-grid-top`; both have fallbacks, so it is right before the first measurement. Nothing was removed.

**Research, the Advisor, the Screener and Trade Analysis as cockpits (2026-11-19: `stock/terminal/PageJumps.jsx`, `stock/terminal/pages.css`, `StockReport.jsx`, `Research.jsx`, `TradeAnalysis.jsx`).** The same four rules as the Desk. **(1) A row of jumps under the top bar** on each of the four pages: `PageJumps` reads the page's own top-level titled sections from the DOM (every `section.an-card`, `details.an-card`, `section.ta-card`, `details.rs-ai` and anything with `data-jump`; a card inside a card belongs to its parent), follows the page as it fills in (a MutationObserver with a timer), marks the section at the top of the screen, opens a folded section it jumps to, scrolls a side rail instead of the page when the section lives in one, and goes there at once (no glide). It shows only when a page has three sections or more, stays at the top on a phone instead of following you, and writes its height to `--pj-h` so everything else that is sticky sits exactly under it. `PAGE_JUMPS` in `StockReport.jsx` only gives short names to titles whose first words are not one. A section lands where the page's `scroll-margin-top` says (under a page head and its bar too). **(2) What you work with stays in view:** on Research the rail (plan intraday, research run) now starts at the top of the page instead of 411 px down, and fills the height; on the Advisor the head (risk per trade, the filter) is sticky; on Trade Analysis the head with its eight parts is sticky and the open part's own bar (the day, the filters) is sticky right under it (`--ta-head-h`). **(3) What you act on comes first, what explains folds:** on Research the Autopilot leads the results column with its description on one line (press it for the rest), then the live scanner — both above the fold at 1440 × 900 — and the forecaster's record moved below the RSI watch; the Trade Analysis head went from 114 px to 63 px by folding its description the same way. **(4) Nothing scrolls sideways** (checked at 1440, 768 and 375 px). Nothing was removed.

**Design, second pass (2026-11-19: `src/admin/polish.css`, `stock/analyzer/desk2.css`).** `polish.css` is loaded last and gives every private page one finish: a quiet glow behind the page, glass headers like the public navbar, one family of cards (edge, radius, lift), display-face section titles with an accent mark, quiet table heads with rows that answer the pointer, focus rings on fields, thin themed scrollbars. It moves and hides nothing and uses tokens only, so dark and light both follow. **The Desk** was re-ordered so the chart is its centre: search row → day board (foldable with the *Day board* button; remembered per device) → price bar → key figures → **the chart, always in view** (it used to sit inside the Overview tab, about 1,600 px down) → the next-15-minutes forecast → the AI strip → the detail tabs (the first is now *Reading*); the verdict stays in its rail.

**Forecaster — time-of-day experts (`server/market/horizon.js`: `segOf`, `alphaEvidence`, `chooseAlpha`).** Beside the pooled model there is one model each for the opening hour, the middle of the day and from 2:00 PM. The forecast is `pooled + alpha × (expert − pooled)`; alpha (0, ¼, ½, ¾, 1 per target) is the one with the smallest squared error on sessions neither model saw, and stays 0 unless an expert cuts the error by at least 0.2%. The evidence is decayed and re-counted every evening on the day's out-of-sample rows, so the choice follows the market by itself. Research → 15-minute forecaster shows the weights in use and what they gained.

**Forecaster — more inputs, a contest, per-stock scales, and lessons written to the AI Engine (2026-11-19, model version 2).** (1) *Nine more inputs* (`FEATURES` in `server/market/horizon.js`): where the last bar and the last three closed in their own range (order-flow pressure), the rejection wick, the stretch from the 20-bar mean, the position against the opening range (first 15 minutes), a signed square of the last bar (big moves are not just bigger small ones), RSI only past 70/30, and the room to the day's high and low. (2) *They are not assumed to help*: three candidates are fitted from the same sums (`CANDIDATES`: the original 18 inputs, all 27, all 27 shrunk harder) and the one with the least squared error on unseen rows is used; the evidence fades slowly and is added to every evening, and the champion changes only when another is 0.2% ahead (`arenaEvidence`, `chooseChampion`). (3) *Each stock's own scale* (`stockScaleOf`): how much that stock really follows a call, pulled towards 1 until its record is long — used only while forecasts made with the scales miss less than without. (4) *Clean measurement*: the unseen rows are split in two; every choice is made on one half and every number shown is measured on the other. (5) *Lessons*: after training and after every evening the findings (tested hit rate, the model in use and how the others did, the experts, the six inputs that moved the next 15 minutes most with their direction, the last evenings' scores, the stocks read best and worst) are saved as a record in the database (collection `horizon_learning`) and written into the trading-skills file every AI feature reads — the section “What the desk has measured about the next 15 minutes”. A stored model of another version cannot be used (its sums do not match) and retrains itself from the stored history within minutes of the first start. Fixed on the way: the nightly boldness factor moved towards 1 instead of by the measured ratio.

**The automation supervisor (`server/supervisor.js`, `src/admin/AutomationCard.jsx`; /me → Automation).** Every learner and forecaster already had its own clock, but a clock only fires if the server is up and Zerodha is connected at that moment; anything missed waited a day, and the screener's Nifty 500 history downloaded only when its page was opened. The supervisor closes that: every minute it asks each *duty* whether it is behind (`due()` returns a plain reason) and runs the first that is — one at a time, heavy ones only in quiet hours (outside 8:30–15:35 on a trading day, by the exchange calendar), with growing pauses (30 min … 24 h) after a failure or a run that could not clear its reason. Duties: the NIFTY 100 5-minute history, the forecaster's training and its evening learning (`Horizon.pending()`), unscored opening forecasts (`OpenForecast.overdue()`), the set-up lab (`SetupLab.behind()`), the level learner (`LearnWatch.behind()`), the screener history, the recorder's evening learning (`Recorder.behind()`) and, last, the day's backup (`Vault.due()`). What ran, why and how it ended is kept in `automation/supervisor.json`. `GET /api/admin/automation` returns the duties, the last events and a roster of every automatic system with their schedules in words and their state; the owner's `POST /api/admin/automation/run` looks now. It calls the services' own methods only: no order, no AI model (the AI stays click-only). **What cannot be automatic:** the Zerodha login each trading morning (Zerodha does not let software renew a session) — the roster says so, and everything that needs live prices shows *Waits for Zerodha* until then.

**Researched set-ups, the 5-minute call and the check (2026-11-19; `server/market/setups.js`, `server/market/horizon.js`, `server/horizon.js`, `HorizonCard.jsx`).** Nothing was removed; three things were added on top.
*1 · Set-ups from published research*, as code beside the nine classic ones, so the evening lab measures them on the NIFTY 100 after costs and the live scanner weighs them by that record exactly like the rest: **`orb5`** — the first 5-minute bar of a stock "in play" (≥1.5× its usual opening volume) broken in that candle's own direction before 10:30 (Zarattini, Barbon & Aziz 2024: of the ranges tested the 5-minute one did best, and the edge came from the unusual volume); **`noise-break`** — at a half-hour mark, beyond the open or yesterday's close by more than the stock's own usual distance from its open at that time of day (14 sessions), on VWAP's side (Zarattini, Aziz & Barbon 2024, intraday momentum out of the "noise area"); **`cpr-break`** — India's narrow central pivot range cleared together with the opening range (a trader's rule with no published test: the lab's numbers are its only evidence). The two researched ones let a winner run (3R or the 3:15 PM exit). `orb5` is the only set-up read before 9:30. All were tested on US data: on NSE they count only as far as the lab's own record says.
*2 · The same research as forecaster inputs (model version 3, 41 inputs)*: `orb5`, `noise`, `mom30` (the first half-hour's move, counted from 2:30 PM — Gao, Han, Li & Zhou, JFE 2018), `tod1`/`tod3` (what the stock did at this time of day on its last five sessions — Heston, Korajczyk & Sadka 2010), `rs` (relative strength against the market), `ema`, `er` (how straight the last hour's path was), `pivot`/`pdx`/`cpr` (yesterday's levels), `gapGo`, `vwSide`, `sqz`. They are read from the sessions **before** a day only (`dayStat`, `priorContext`; a test replaces the day and everything after it and the context does not change). They are *not assumed to help*: two new contestants (`setups`, `setups-shrunk`) compete with the three older models on sessions none has seen, and the champion changes only when clearly beaten. A stored version-2 model retrains itself on the first start (a few minutes; the supervisor's `forecaster-train` duty).
*3 · A 5-minute call, and a check on every forecast*: the card now shows **Next 5 and 15 minutes** — the 5-minute call is for the first bar end at least 2½ minutes away (always 2½–7½ minutes ahead), with its own band and chance. Every forecast kept is **checked** when its time comes, at 5 and at 15 minutes, by one rule stated on the screen (`verdictOf`): a call that *leans* (55%+ one way) is **correct** when the price went that way; a call with no lean is correct when the price ended inside its band. The card shows the last verdict for each horizon (what was said, what happened), the count of the last twenty and the count over every stock followed. **Right or wrong, each check is learned from at once**: the stock's own correction is re-estimated for 5 minutes and for 15 minutes separately (`live.bias[symbol].b1` / `.bias`, shrunk, capped at ±0.4σ) and the change is shown ("moved −0.020σ → −0.031σ"); after the close the whole model learns every NIFTY 100 bar of the day again. Also corrected: the *Why* line used to pick its words by which way an input pushed, so a price above VWAP that pushed the forecast down was described as "below VWAP"; it now states the fact and marks the push with ↑/↓. **What this cannot be:** a forecast that is never wrong. Five- and fifteen-minute moves are mostly noise; the check exists so the real hit rate is always in front of you.

**The market recorder (`server/recorder.js`, `server/market/tapeflow.js`; /me → Data & backups).** Learning used to rest on price bars alone, and the live record on the stocks someone had open. The recorder reads *everything, by itself*: once a minute from 9:15 to 15:30 on a trading day, in one Zerodha quote request, every NIFTY 100 stock and every watchlist stock (price, the day's volume, the average price, the quantity waiting to buy and to sell), each one's near-month future (price, volume, **open interest**) and NIFTY 50, BANK NIFTY and India VIX — no page open, no stock selected, no AI credit. A session is one record (columns, compressed, about a megabyte) on the store's **cold shelf** (`docs.coldPut/coldGet/coldList`: in the database but *not* in memory, so years of sessions cost nothing to hold; MongoDB collection `cold_market_tape`, files under `data/cold/` otherwise); `market/tape-index.json` says what is stored. It saves every five minutes and at the close, reads the morning back after a restart, and is saved on shutdown (`index.js`). **What is learned:** each evening (supervisor duty `flow-learner`) the forecaster makes its own call for every stock and 5-minute bar of the recorded session (`Horizon.replay`); what it *missed* is set against ten readings of that minute (book imbalance now / its change / its 15-minute average / against the market's, open interest over 15 minutes and on the day, long and short build-up, covering and unwinding, the future's premium). Before a session is learned the weights as they stood are scored on it, so the gain shown is out of sample; the readings enter the live forecast (`forecastFrom(..., { tilts })`, a correction held to ±0.5σ) **only** while they cut the squared miss at 15 minutes by ≥0.2% over ≥20,000 scored forecasts — until then the Desk shows them as "shown only: not yet proven". A session is never passed over because the forecaster had no model at that moment (`Horizon.ready()`); it waits. Each run is kept in `tape_learning` and written into the trading-skills file. **What it cannot do:** read the minutes before the day's Zerodha login, or the past (no archive of order books exists) — so the proof takes a few sessions to arrive, and it may honestly conclude that these readings add nothing.

**The vault (`server/vault.js`, `server/restore.js`; /me → Data & backups, owner only).** *Downloads:* every dataset in the database has a link — the recorded tape (a spreadsheet per session, or all sessions in one compressed file), the NIFTY 100's 5-minute history (per stock, or all), every list as CSV or JSON (`/api/admin/vault/collection/:name`), every record as stored (`/vault/doc?name=`; the accounts-and-settings record is never served one by one). The two large ones are streamed through gzip, never built in memory. *Backups:* one file of everything the store holds (`docs.dump`: every document, the whole of each log, every list, every recorded session) as compressed JSON lines, written to `data/backups/` once a day after the close (the supervisor's last duty, so it follows the evening's learning), on a click, pruned to the newest N (default 5), each downloadable. A backup contains the settings and accounts (secrets inside stay encrypted; the two key files are **not** in it); caches that download again and the temple's audio are left out. *Restore:* deliberately not a button — services hold their own copies of records in memory and would write them back — so it is done with the server stopped: `node server/restore.js data/backups/<file> --dry-run`, then `--yes` (optionally `--only=doc,item,cold,log`). The file is read through first (a file cut short changes nothing), records are replaced one by one, and a log is restored only into an empty log.

**The live channel (`server/live.js`, `src/admin/live.js`, `visible.js`, `LiveBadge.jsx`).** Every page of the private area updates the moment something changes, with no refresh. One Server-Sent Events connection per *browser* (`GET /api/admin/live`; the tabs elect a leader with the Web Locks API and the leader relays events to the other tabs over a BroadcastChannel, so many tabs never exhaust the browser's connection limit). It carries only "topic X changed" — never data: a page re-reads what it shows through its normal, permission-checked API. Events come from (1) every successful state-changing request under `/api/admin` (`ROUTE_TOPICS`: the trading switch, a setting, a proposal, a research run…) and (2) 13 *watchers* that fingerprint the server's own state every 2.5 s (Zerodha session, trading book, paper robot, research runs, alerts, forecasters, autopilot, AI credit, messaging, health) and publish only what changed — so a forecast scored by the clock, a position closed by the exit coach or an expired session also reach every page at once. Each event is numbered; a page that reconnects says the last number it saw and is sent what it missed (300 kept), or told to *resync* (re-read everything) when more was missed or the server restarted (new boot id); a heartbeat every 15 s keeps proxies open. Pollers (`everyVisible(fn, ms, { topics })`) run at once on their topics (at most about once a second; a burst is one refresh; a hidden tab refreshes when shown) and keep their timers as a safety net; they also catch up on tab focus and when the network returns. A header badge shows *Live / Reconnecting / Offline*. `GET /api/admin/live/status` (owner) shows clients and counters.

**The 15-minute forecast (`server/horizon.js`, `server/market/horizon.js`).** For the stock on the Desk (and folded in each Research card) the price, a 70% band, the expected high and low, the chance it is higher, and the chance of touching key levels, 5/10/15/20/30 minutes ahead; the headline is always at least 15 minutes away. One pooled ridge model over every NIFTY 100 stock, every input in the stock's own units (price moves, volume against usual for the time, RSI, VWAP, range position, time of day, the market's move × beta, the previous day). It trains on the whole stored 5-minute history (the paper robot's `robot_history`), holding the newest quarter back to measure direction, miss, band and stated-probability reliability out of sample; every evening at 3:40 PM it forecasts the whole day of all 100 stocks with the morning's model, is scored on that (`horizon_days`), then learns the day (sufficient statistics add, old days fade), and corrects its confidence, slopes and band width; live forecasts are kept and scored (`horizon_forecasts`) and teach each stock's bias and the worth of the news mood and the AI's last live read. No AI call is ever made. It never claims 100%: the measured record is shown beside every forecast. `GET /api/admin/market/horizon[/:symbol]`, owner-only `POST .../horizon/train` and `.../learn`.

**Early calls — trend, reversal, momentum, 5 and 15 minutes ahead (`server/ahead.js`, `server/market/ahead.js`; `src/admin/stock/analyzer/AheadCard.jsx`; Desk under the forecast, Research).** Beside the forecaster's trend call the desk says, before it happens, whether the move that is on will **turn** (give back ≥ ½ a usual move) or **carry on** (add ≥ ½), and whether a **large move** (≥ 1 usual move) or a **quiet stretch** (≤ 0.4) is coming — for 5, 10, 15 and 20 minutes from the last finished 5-minute bar (the screen shows the bar end ≥ 2½ minutes away and the one ≥ 15). The forecaster's inputs are *aligned* to the move's direction (`inputsOf`: stretched from VWAP the move's way, RSI with it, the last bar closing against it, bars in a row, the move slowing, the day's extreme ahead…), so up- and down-moves teach one lesson. Two families of yes/no outcomes (`SETS`: `run` = turn/go on bars where a move is on; `all` = big/calm on every bar), ridge on sufficient statistics (`Sums`), learned through `horizon.replay(dates, each, { needAll: false })` so both read the same rows. The raw score is **calibrated** on unseen rows (`calCurve`: bin rates pulled to the usual rate, pooled so the curve never falls) and the shown probability is that measured frequency; a call is *named* (`tierOf`: likely ≥ 50%, raised, low) only while `provenOf` holds (≥ 5,000 unseen examples and Brier skill ≥ 0.4% over “always the usual rate”) — in a market with nothing to find it proves and calls nothing (tested). First training: newest quarter held back, half of it sets the calibration, the other half gives the numbers shown. Every evening from 3:45 PM (after the forecaster): each new session is called with the model as it stood, checked (`ahead_days`), then learned; calibration and evidence fade 1.5% a session. Live: one set of calls per followed stock per bar is kept (`ahead_calls`), checked 5 and 15 minutes later (`settle`; a warning is right when it happened, an *unlikely* when it did not), and each stock's own correction is learned from the checks (`market/ahead-live.json`, shrunk, ±8 points at most). Supervisor duties `early-calls-train` and `early-calls-learn`; roster entry *Early calls*. No AI call, no order. `GET /api/admin/market/ahead[/:symbol]`, owner-only `POST .../ahead/train` and `.../learn`. **It does not and cannot promise the next 15 minutes**: the usual rate is beside every number and the check counts every warning that did not come.

**The evidence desk — every technique, the order book and the world, weighed (`server/evidence.js`, `server/market/evidence.js`; `src/admin/stock/analyzer/EvidenceCard.jsx`; Desk under the early calls, Research, Positions, the Live board, the AI page).** One call for the next 5 and 15 minutes (up, down or no clear lean, with the chance of a rise and of a fall beside their usual rates) from two kinds of reading. *Bar witnesses*: 35 day-trading techniques, each a fixed rule on the 5-minute bars (`WITS` in `market/evidence.js`: opening-range break and failure, first-hour break, VWAP trend/pullback/cross/band, EMA pullback and cross, Supertrend, MACD, ADX, CPR, Camarilla, yesterday's high/low, gaps, NR7, inside bar, Bollinger squeeze and fade, RSI(2), RSI divergence, volume climax, liquidity sweep, pin, engulfing, three pushes, up/down volume, new high on heavy/thin volume, the market's push, relative strength). Each one's record is measured on the whole stored history through the forecaster's `replay()` (which now also hands the session's bars and context to its callback) and shown beside it: works, works the other way, no edge, too few cases. *Live witnesses* (`LIVE`): the order book price by price on NSE and BSE (the Kite quote's `depth`, now kept by `market/kite.js` `quotes()`), all pending orders, order-flow pressure, futures open interest (the recorder's reading), the option chain, the NIFTY tide, the stock's sector index, India VIX, GIFT NIFTY, the SENSEX, Wall Street and Asia. The call is a stacked ridge model — the forecaster's own call plus every bar witness, on “it rose” / “it fell” by 0.3 of a usual move — calibrated on unseen sessions; it uses the techniques only where they cut the miss against the forecaster alone (`techniquesOn`), and a live reading moves it only after its own live record is proven (`_liveTilt`). **Every test of “is this real?” counts sessions, not bars** (the stocks of a session move together; `evClose`, `ledgerFold`, `recordOf`, `provenOf`): the honesty test in `server/test/evidence.test.js` fails without it. Calls are kept (`evidence_calls`) and checked 5 and 15 minutes later; each evening at 3:50 PM the new session is called as it stood, checked (`evidence_days`), then learned. Model `market/evidence-model.json`, live record and AI settings `market/evidence-live.json`. Routes under `/api/admin/market/evidence` (board, `:symbol`, `positions?list=`, `:symbol/open`, `:symbol/ai`, `ai`, `train`, `learn`); live topic `evidence`; supervisor duties `evidence-train`, `evidence-learn`. The same board in brief (`evidence.brief`) is handed to the AI briefs (`ai.deskEvidence`: the strategist's brief, AI Live, TradeAI's snapshot) and to the flight deck (`flight.evidence`: the exit advisor's snapshot, and one more reason for the exit coach when a lean is proven — the signal itself is not changed). **The AI on opening a stock:** the Desk POSTs `…/evidence/:symbol/open`; the click middleware marks it `opened` (not a click), and `SpendGuard.allowed()` lets it through only while `guard.openAllowed()` says the switch is on. `Evidence.opened()` then applies the owner-only rule, market hours, the gap per stock, the daily limit and the need test (`_aiNeed`) before one request to the default model; reads are kept, shown and checked. This is the single exception to “AI only on a click”, made at the owner's instruction on 2026-11-20; the switch is on the AI page (`AiSpend.jsx`). No order is placed anywhere here.

**The expiry calendar (`server/market/expiry.js`, `server/expiry.js`; `src/admin/stock/ExpiryCalendar.jsx` on the Calendar; 2026-11-20).** Every weekly and monthly derivatives expiry on NSE and BSE. Source: the exchanges' contract lists as Zerodha republishes them publicly — `https://api.kite.trade/instruments/NFO` and `/BFO`, plain GETs with no key, no login and no AI. `parseList(csv)` → each underlying's option and future expiry dates; `readList` → the monthly dates (futures' dates, else a month's last option date), the weeklies of the main index (NIFTY / SENSEX) and **the expiry weekday read from the list itself** (so a change of rule needs no code); `build` → one row per week of the year: the listed date where the exchange lists the contract, else the weekday's date moved back to the last trading day (`market/nse-holidays.js`), with `status` listed / scheduled / passed, `moved` + `why`, and `uncertain` where the desk holds no holiday list for that year. `horizon(today)`: to 31 December, and from 24 December to the end of the next year. The service reads the lists ~20 s after start, daily at 8:00 AM IST, every 12 h, and 30 min after a failure (`_due`); keeps the last good list; remembers each week's listed date (`seen`) so a passed week keeps its real date; and after each read compares the calendar with the previous one (`changes`) — a moved date or a changed weekday is kept (last 40), logged and published on the live topic `expiry`. Record: `market/expiry.json`. Routes: `GET /api/admin/market/expiries`, `POST …/expiries/refresh`. Supervisor duty `expiry-calendar`, roster entry `expiry`. Under test the network is not touched unless `opts.expiryFetch` is given.

**NSE's day by date (`server/market/session.js`; 2026-11-20).** One table (`REGIMES`) of when continuous trading ends and when Zerodha squares off MIS positions: 3:30 / the desk's 3:15 until July 2026; from 2026-08-03 (closing auction, phase 1) F&O stocks stop at 3:15 PM and are squared off at 3:12 PM, other stocks 3:30 / 3:25 PM; from 2026-12-07 continuous trading to 3:30 PM for all, with 3:12 PM kept for closing-auction stocks because Zerodha had not published its times (`unconfirmed` says so — update that row when it does). `sessionFor(date, { cas })`, `squareOffAt(ms, { cas })`, `liveCloseSlot(priorSlot, priorDate, today)`, `squareOffNote(date)`. `cas` (the stock has a closing auction = it is in the F&O list) defaults to true: the earlier time. Used by the exit coach (`squareOffOf(ms, cas)`, `opts.cas`, the clock in its reasons), the level map (`opts.cas`), the flight deck (`_cas(symbol)` from `market.derivatives()`), the live call's `sessionAt(now, { cas })`, and the forecaster: `ctx.closeSlot` (data-driven from the stock's previous session, the table on the first day of new rules) now sets `tClose`, `mom30` and the bars left in `market/horizon.js` (`closeOf`), so `MODEL_VERSION` is 4 and the forecaster, the early calls and the evidence desk retrain by themselves. Simulated trades use it too: `exitMinFor` / `exitHmFor` / `exitAt` give the last 5-minute bar at or before the square-off (15:10 since August 2026, 15:15 on earlier sessions, so older results are unchanged) for `market/replay.js`, `market/intraplan.js` (its checklist says the time for the plan's day), `market/setups.js`, `robot/levels.js` and the scoring of AI intraday plans in `ai/service.js`; the paper robot (`robot/engine.js` `squareOf`), the autopilot's grading and `analysis/lab.js` leave at the square-off minute itself; the order ticket's late-day warning reads the same table.

**The evidence desk, model version 2, and the Now screen (2026-11-20; `server/market/evidence.js` `MODEL_VERSION = 2`, so it retrains by itself).** From a web search of published research, what had evidence and could be computed from our data was added, each as a measured witness: `eodMkt`, `eodLoser`, `eodWinner` (the last half-hour: Baltussen-Da-Lammers-Martens 2021; Soebhag-Baltussen-Da 2025 — they count back from `ctx.closeSlot`, the slot after the previous session's last bar, which `server/horizon.js` now puts in the forecaster's context, so a change in the exchange's closing time is followed), `jumpDown`, `jumpUp` (no-news jumps reverse: Xiao-Yin-Zhao 2020), and two live readings: `ofi` (order-flow imbalance over the 5 levels, Cont-Kukanov-Stoikov 2014, computed tick by tick in `market/flow.js` `FlowEngine` as `ofi60` / `ofi300`, in "average levels") and `pin` (expiry afternoon, the strike with the most open interest within 1%). **Regimes:** every bar witness has two inputs and two weights, in a trend and in a range (`trendAt`: efficiency ratio of the last 12 bars ≥ 0.4; `inputsOf(f, w, trend)`, `weightAt`), and its ledger is kept apart for each (ids with `@t` / `@r`); the card shows the record for the regime the stock is in. **Which comes first** (`KEYS = [1, 3, "tb"]`): a third question fitted like the two horizons — within 6 bars, does the high reach one usual 15-minute move above the close before the low reaches the same move below (`firstBarrier`; a bar holding both, or a session ending first, is not a label). "Usual" is `sloc`: the stock's long-run 5-minute move blended half and half with the last half-hour's realised moves. Shown on the card (`first`), kept and checked 30 minutes later (`actual.tb`), and turned to face a position's side in `forPositions` (`first.favour` / `first.against`). Not added, because the search found no evidence: the market-profile "80% rule", daily-range exhaustion as a reversal signal, round-number effects, VPIN. **Now** (`src/admin/stock/now/NowView.jsx`, tab id `now`, `GET /api/admin/market/now`): one live page — the market in tiles, the owner's positions with the evidence for or against each, every followed stock with its ticking price and its 5 and 15 minute calls (`Evidence.nowBoard`: one shared quote request for all their order books, kept 10 s), the checks so far and every automatic system's state. **Live everywhere:** `useTopics(topics, fn)` in `src/admin/live.js` re-reads a screen the moment the server publishes one of its topics; it now drives the screens that used to read once (Trade Analysis day lab / day book / snapshots, Indices, journal files, the automatic research card, the list of admins).

**The brand: the DrishtiAI logo (`public/drishti-logo.svg`, `src/admin/DrishtiLogo.jsx`, `src/admin/BrandMark.jsx`; BRAND.md).** One SVG — an eye whose pupil is a rising price line — is the mark of the whole trading area: page headers and the terminal's top bar (logo, “DrishtiAI”, “AI Trading Advisor”), the dashboard's side column, TradeAI's avatar, the private area's tab icons (`drishti-*.png`) and the link-preview pictures (`scripts/og-images.js`). The public site keeps the owner's photo.

**Per-person Zerodha accounts (`server/accounts.js`, `src/admin/ZerodhaAccounts.jsx`; /me → Zerodha accounts).** The owner switches on, per admin, trading on that person's **own** Kite ID. Zerodha ties a Kite Connect app to one client ID, so each person brings their own app (key + secret, redirect URL `<origin>/api/admin/accounts/kite/callback`) and logs in daily on Zerodha's page. Each allowed person gets their own `TradingService` (the same class) over a facade market (their Kite session, the site's prices), their own settings and a namespaced record store (`accounts/<slug>/…`): own funds, positions, orders, trading switch (off by default), limits, risk guard and audit. The account is chosen from the session only (`requireTrader` sets `req.trading`); the owner sees connected/not, never keys or positions, and cannot trade another's account; revoke or admin removal cuts access at once. Journal, Trade Analysis, the AI coach and the streamed live book stay owner-only. Secrets are encrypted with the settings key (`accounts/secrets.json`, excluded from downloads). The site's own Kite credentials and disconnect are owner-only. `GET /api/admin/accounts`, `PUT /api/admin/accounts/people/:email`, `GET|PUT|DELETE /api/admin/accounts/me[/kite]`, `GET /api/admin/accounts/kite/login|callback`.

**Preferences and the /me control panel (`server/prefs.js`, `src/admin/prefs.js`, `src/admin/CustomizeCard.jsx`, `src/admin/Dashboard.jsx`).** /me is a control panel: a sticky side column (logo, greeting and role, the way in, the list of sections via `PageJumps side`) and the sections Today · Workspaces · Tools · Zerodha accounts · Customize · Settings & system. **Customize** keeps each person's own choices on the server (`prefs/<slug>.json`, validated by `clean`): theme, accent, text size, density, motion, which workspaces show and in what order, where the terminal opens, the Desk's start (day board, dock, chart) and which blocks /me shows. `PrefsProvider` applies them (`data-accent`, `data-density`, `data-motion` on `.adm`; root font size); `arrangeViews` orders and hides the terminal's tabs **after** the role filter, so a preference can never widen what a role allows. `GET|PUT|DELETE /api/admin/prefs`.

**The file store on Windows (`server/docs.js`).** `FileDocs.write` retries the final rename for about 1.5 s when Windows refuses it with EPERM / EBUSY / EACCES (a virus scanner or the indexer holding the file): a refused write used to leave the request that made it unanswered.

**The autopilot (`server/autopilot.js`; `server/market/{scenarios,events,calibrate,nse-holidays,sectors}.js`; `server/risk-gate.js`; `src/admin/stock/autopilot/`).** The research desk that works by itself: before the open it builds each followed stock's **playbook** — the regime (trending, range, squeeze, volatile), the day by time window with the stock's own measured habits, and scenarios with machine-checkable triggers (break of the previous high/low that holds two closed minutes after 9:30; break of the 9:15–9:30 range) plus advice scenarios (gaps, option walls, events, the market turning); from 9:30 it **watches** prices and 1-minute bars every 30 seconds; a fired scenario passes the **risk gate** (risk guard lock, capital, risk % per trade, reward-to-risk, position/sector/total exposure, correlation, announcement windows, daily quota) and becomes an **order proposal** — never an order: *Review the order* opens the ordinary ticket pre-filled. Every proposal is **graded** on the minute bars to stop/target/3:15 in R after costs (a setup whose last 12 lost money is paused), and after each close the outlook is **calibrated** on a year of history (hit rate by score and by voice). The event calendar adds F&O expiries (from the NFO list), NSE holidays (server copy of the Calendar table — update both each December) and the owner's own events (results, RBI, Fed, Budget). Collection `autopilot_proposals`; `GET /api/admin/autopilot`, `/playbook/:symbol`.

**Licence:** Lightweight Charts is Apache-2.0 (free, including commercial use). It asks for
TradingView's attribution notice and a link to tradingview.com on the page: the logo on the chart
links there, and the notice ("TradingView Lightweight Charts™, Copyright © 2025 TradingView, Inc.")
is printed under every chart. Its one dependency, `fancy-canvas`, is MIT. No map, map tiles or other
paid data are used, and nothing of Kite's own chart (TradingView's licensed library) is copied.

**Sign-in page and dashboard (`src/admin/Login.jsx`, `Dashboard.jsx`, `home.css`, sign-in styles in `hub.css`).** The sign-in page
says, politely and in justified text, that this is Vinay Kumar Tiwari's personal workspace and not
for visitors; no email address appears anywhere on it (nor in the signed-in headers). The dashboard
opens straight away — the welcome picture and the mantra audio are gone — as a command centre (redesigned 2026-11-18): a
welcome with the three main ways in; a live status row (NSE session with the time to the next change, Zerodha, trading
switch, today's P&L, Advisor A/B, the 15-minute forecaster's tested hit rate, AI-credit protection — re-read every 30
seconds and the moment the tab is shown again); the owner's *Today* cards (paper robot, month, autopilot proposals
waiting, likely trenders); the workspaces in three groups with a finder (press `/`); TradeAI, paper trading and Social
Media side by side; and settings and system health below. Every part wraps: nothing scrolls sideways.

**Research direction and automatic runs (`server/market/direction.js`, `server/research-auto.js`).**
Every research report now gives each stock a **direction** — Buy / Watch for entry / No trade /
Caution / Avoid — with a confidence, the plan (entry, stop, targets, reward-to-risk, what cancels it)
and the lenses behind it, each with its evidence: long-term owner, trend follower, momentum,
measured odds, habits, market backdrop and risk. A value-investor lens would need company
financials, which Zerodha does not provide; it is shown as not available rather than guessed.
Only the measured odds are tested forward, so without them a "Buy" is held to "Watch"; a first
target under 1.5× the risk also holds it back. Research also **runs by itself** on weekdays at
08:45 (pre-market) and 16:00 IST (post-market) while Zerodha is connected — data and direction at
no cost, or with AI notes, company news and the world brief when switched on (that uses Anthropic
tokens). It is a summary of evidence, not a forecast and not advice.

**Trade Analysis — the Execution Lab (the last workspace on the terminal bar; `server/analysis/lab.js`,
`src/admin/stock/analysis/TradeAnalysis.jsx`; superadmin only; 2026-11-15).** Every closed intraday trade replayed
on that day's 1-minute bars (`minuteBarsBetween`): MFE / MAE, the share of the move kept, what ran on after the exit,
the entry context (VWAP, the opening range, place in the day's range), the same entries with other exits (0.5% stop
/ 1% target, 0.5% trail, break-even stop, hold to 3:15; stop first when a minute touches both), habits (revenge,
after the daily stop / target, over-trading, held loser, cut winner, first 5 / last 30 minutes, against VWAP,
chased, costs) and an execution score; a period adds them up with plain-word lessons. No AI. One replay per day
in `analysis/lab`, worked out by the hourly sweep (`labBackfill`, last 60 days) or on opening a day; routes
`GET /api/admin/analysis/lab/:date` (`?refresh=1`) and `GET /api/admin/analysis/lab?from&to`.

**The Lab's Live board, exit coach and flight recorder (2026-11-15; `server/flight.js`, `server/trading/exitcoach.js`,
`server/trading/exitlevels.js`, `server/ai/exitadvisor.js`, `server/analysis/compare.js`; `LiveBoard.jsx`, `LabExtras.jsx`,
`flight.css`).** The Lab has four parts: **Live board** (opens here in NSE hours), **A day**, **Coach**, **A period**.
- **Flight deck** (`FlightDeck`, started in `app.js`, outside `server/ai`): reads positions every 10 s in NSE hours; an open
  NSE/BSE cash position becomes a *flight*, its instrument is followed on the ticker with depth (`market.followBook`), and on
  every tick (at most 4 looks a second) the **exit coach** answers HOLD / TIGHTEN / BOOK PART / EXIT NOW with an exit pressure
  0–100, the exit price, its own stop (first stop → break-even → trailing, only ever towards the price), the next target and the
  reasons — from the position, the tape, the order-flow engine, the ladder, the Live Pulse, the tide, the NSE forecast from the
  world, the news and the day's goal. Pure arithmetic; hysteresis keeps the word steady. EXIT NOW goes to the phone once per
  10 minutes. It reads only: the board's Exit button opens the order ticket for the trader to confirm.
- **Stream:** `GET /api/admin/flight/stream` (Server-Sent Events: `board` on connect and every 15 s, `pos` per look); the page
  falls back to `GET /api/admin/flight` every 2 s. Also `POST /flight/sync`, `POST /flight/ai`, `POST /flight/levels`,
  `GET|PUT /flight/settings`, `GET /flight/days`, `GET /flight/day/:date` — all superadmin.
- **AI on the board, sparingly** (one daily limit, default 30; `aiMode` change / ask / off): a **second opinion**
  (`ExitAdvisor.advise`) when the word steps up to BOOK PART or EXIT NOW (5 min per position) or on request (30 s); and
  **exit levels** (`ExitAdvisor.research`) when a position comes onto the board, when its targets are reached or its stop
  broken, when the set is an hour old and the price has moved, or on request (60 s).
- **Accuracy of the AI's levels is enforced, not hoped for.** `levelMap` works out every level from the desk's own data (day and
  previous-day highs/lows/close, opening range, VWAP, pivots, 5/20-day extremes, 5-minute swings, the busiest price, round
  numbers, the order wall, the pulse window, the ladder, the entry, the peak), merges those that sit together and gives each an
  id (A1… above, B1… below) and a no-trend touch-odds figure. The model may only choose **by id**; `verify` throws out unknown
  ids and misquoted prices (the desk's price is always the one shown), targets that are not ahead, not worth the costs or out of
  reach (< 8% odds), and clamps a stop to the coach's own when the AI's is further away; R and the take-profit limit are computed
  by the desk. Rejections are shown with their reason. `track` marks a level the moment the price reaches it (event + phone
  reminder); after the close `settleLevels` scores each set on the day's 1-minute bars (first target before the stop? a tie
  counts as stopped) into `flight/ai-levels.json` — that record is shown on the board and fed back to the model.
- **Recorder:** `flight/DATE.json` (180 days): a frame every 15 s per position and every event (entry, each change of the
  word, AI levels and opinions, levels reached, alerts, exit).
- **A day** adds, per trade, the best moment to have left with its time (least loss when it never paid), the gap to the
  trader's exit, exit efficiency, the best up to 3:15, and the coach replayed on the bars (`replay`; a square-off exit is not
  reported as the coach having said EXIT). `LAB_VER = 2`.
- **Coach** (`GET /api/admin/analysis/compare/:date`, `compareDay`): the day against the replays of the 60 days before it (at
  least three): what to prevent (again / new / keeps coming back, with its cost and one rule), what to keep, similar days and trades.
- Tests: `server/test/flight.test.js` (18), `src/admin/stock/analysis/TradeAnalysis.test.js` (6).

**TradeAI's agent, shared research and the level learner (2026-11-16; `server/ai/agent.js`, `server/ai/shared.js`,
`server/desk-readers.js`, `server/market/tape.js`, `server/trading/levellearn.js`, `server/learn.js`;
`src/admin/stock/terminal/ResearchPanel.jsx`, `TradeAI.jsx`).** Added on top of the existing engines; nothing was removed.
- **Agent** (`DeskAgent`): after the keyword plan, a free *seed* (for a held stock the question names: the exit coach's
  reading, the tape, the level map; for any stock: the shared research), then the model names more *readers* from a list of 18
  (`READERS`; up to four a step) and the desk runs them — `tradeai.desk` is `makeDeskReaders({ market, flight, analysis, learn })`,
  built in `app.js` because `server/ai` cannot load the broker or anything with a timer. Paid readers (`news`, `web`) only when
  the level allows, one per question.
- **Thinking level and model** (owner only; `effort` and `model` on `POST /api/admin/tradeai/ask`, saved default in
  `PUT /api/admin/tradeai/settings`): `_level` — low: 0 agent steps; medium: 1 + web; high: 3 with the data + web, effort high,
  16k output; auto: fast 0 / advice 1 / deep 2. `_pick` accepts only a model the saved key lists. Each answer's `meta` carries
  `effort`, `agent.steps`, `usage` (planning + answer), `picked`.
- **Instant exit answer:** intent `exit` in `route.js` (“when should I exit…”, “should I book…”, “trail my stop…”) is answered
  from the coach's reading with no model; Medium/High or Deep sends it to the model with the same reading.
- **Shared research** (`SharedResearch`, doc `ai/shared-research.json`, newest 400): the Engine's `wrap().ask` calls
  `shared.capture(feature, sent, result, subject)` for strategist / copilot / decision / research / ensemble-live /
  ensemble-research / coach / tradeai / exit; the flight deck publishes `exit-levels` itself, after `verify`. TTL per feature;
  `moved` when the price is 0.6% away; findings about the owner's positions are owner-only (`PRIVATE`). Read by the agent
  (`shared` reader, seeded), the exit advisor's snapshot (`otherAiFindings`) and `GET /api/admin/ai/shared[?symbol=]` (the lamp
  button in the terminal's top bar, every workspace).
- **Level learner** (`LearnWatch`, timer outside `server/ai`, no AI): from 15:40 IST studies today plus up to three unseen
  earlier days (traded + filmed + watchlist stocks, 30 max): `studyDay` counts every test of a level as held / broke / none
  with its context (time bucket, volume, RSI stretch, Bollinger band, order book from the recorder's frames) — no look-ahead.
  Docs `learn/levels/DATE.json`, `learn/levels-summary.json` (60 days), `learn/index.json`, `learn/runs.json`. `holdOf` feeds
  `levelMap({ learned })` → `anchor.held` (Live board ladder, the AI's level map, TradeAI); `lessons` are written into the
  skills file section “What the desk has measured” via `playbook.setSection`. Routes `GET /api/admin/learn`,
  `POST /api/admin/learn/run` (super).
- **Activity log:** `ai/tradeai-activity.json` (500 newest) — how each question was answered, what was read, agent steps,
  model, level, tokens, ms; `GET /api/admin/tradeai/activity` (super); today's totals in `status().today`.
- Tests: `server/test/learn.test.js` (9), `server/test/tradeai.test.js` (+4), `server/test/route.test.js`.
- **Class prefixes:** the shared-research panel uses `shr-` (`.tm-alerts.shr`). `rs-` belongs to the Research page
  (`trade.css`); the panel was first written with `rs` and its width rule squeezed that page to 520px (fixed 2026-11-16,
  guarded by `ResearchPanel.test.js`). Grep a prefix before using it for new styles.
- **Research page layout** (`Research.jsx`, `IntradayResearch.jsx`, `trade.css` `.rs--panes`): from 1180px two panes — the
  controls rail (`.rs-side`, 340–440px, sticky under the top bar) and the results pane (`.rs-main`): the intraday plans
  (rendered there through a portal, `slot`), the report's summary and the stock notes; below 1180px they stack.

**Indices — NIFTY 50 and SENSEX (2026-11-16; `server/market/indices.js`, `server/index-history.js`, `server/ai/indexai.js`,
`src/admin/stock/indices/`; view `indices` after Trade Analysis, tile on /me; not superadmin-only, the AI button is).**
- **Data:** `MarketService.indexDaily(id)` — Kite daily candles, NIFTY 50 token from the NSE list (fallback 256265), SENSEX
  token 265 (BSE), from 1995 in 1800-day chunks (`_download`); saved as `indices/candles-ID.json` ([d,o,h,l,c]) and topped up
  from ten days before the last saved day (20 min in market hours, once after the close). Demo mode: `demo.demoIndexHistory`
  (2005–, named “Demo index A/B”, never in the ledger).
- **Analysis** (`analyze`): `monthsOf`/`yearsOf` (move from the previous close, best/worst point inside, ranges, deepest fall),
  `monthStats` (seasonality), `heat`, `seasonalPath`, `dayOfWeek`, `turnOfMonth`, `afterMonths`, `streaks`, `drawdowns`,
  `elections` (Lok Sabha years), `compare` (side by side).
- **Projection** (`projectMonth`/`projectYear`, model `desk-v1`): long-run mean + shrunk adjustments (calendar month k=12,
  regime above/below the 10-month average k=40, after an extreme period k=20; yearly: regime/extreme/election k=8/8/6), capped
  at ±1σ; band = ½ recent daily vol × √sessions + ½ σ of past periods → 68/90/98%; inside the period carried forward from
  today's close with P(end above start). `walkForward` runs it on every past month/year with no look-ahead (tested).
- **Ledger** (`indices/ledger.json`, 800 newest): desk start-of-period projections frozen on first sight, AI projections frozen
  when made; `_settle` adds actual, dirHit (vs the start level), in68/in90, error. AI answers are checked (`_check`): close
  beyond the desk's 98% band or range not containing its close → refused; too wide → cut; < ½ the desk's 68% width →
  “overconfident”. Auto AI: first week of the month / first ten days of January from 08:45, once per index and period,
  never on demo; manual: 3 h gap per index+horizon, 12/day.
- **Routes:** `GET /api/admin/indices?index=NIFTY|SENSEX`, `GET /api/admin/indices/compare`, `POST /api/admin/indices/refresh`,
  `POST /api/admin/indices/ai {index, horizon}` (super), `PUT /api/admin/indices/settings {aiAuto}` (super). TradeAI's agent
  reader `indices` → `IndexHistory.brief`.
- **Page colours:** the two series are the dataviz reference blue/orange (`--ix-a`/`--ix-b`, validated for both themes), up/down
  tokens for diverging cells and bars. Tests: `server/test/indices.test.js` (10), `src/admin/stock/indices/Indices.test.js` (3).

**Research: the Top 10 and the RSI watch (2026-11-16; `server/market/picks.js`, `server/picks.js`, `server/ai/picksai.js`,
`src/admin/stock/trade/TopPicks.jsx`).** Added at the top of Research's results pane (first below 1180px); nothing removed.
- **Schedule** (`TopPicks.tick`, outside `server/ai`): pre 08:35–09:14 (once, for today), live 09:16–15:25 every 5 min, post
  from 15:45 (once, for the next weekday). Universe: `indexList.list("nifty100")` + watchlist + `social.signal().stocks`;
  sector from the sectoral index lists. Daily features once a day (`market.daily`, completed bars only in the session) and the
  NIFTY's 20-session move cached; live = one batch of quotes (≤100 per call) + verdict/edge/pulse for the shortlist; the
  intraday plan (`ensemble.intraday`) once a day per name.
- **Scoring** (`score` → `deepen` → `rank`): points per side with the reason text; exclusions: two-sided (margin < 8), ATR < 0.6%,
  turnover < ₹20 cr, plan says avoid; max 3 per sector (stocks with no known sector are not capped). Live plan status:
  waiting / triggered / target / stop.
- **AI on need** (`_aiNeed`): pre/post once per phase, the first live list, then only after ≥3 names changed since the last
  live review (60 min apart) or the world/tide sign flipped; `aiDailyCap` 6, `aiMode` need|off, never on demo. `_review` keeps
  only candidate symbols, AI order first then the desk's; notes carried through re-ranks. Feature `picks` in brains; each name
  is published to the shared research (`feature: "picks"`); TradeAI reader `picks` (list + RSI extremes).
- **Record** (`picks/record.json`): the pre list and the previous evening's list for each session, scored after the close
  (`scoreList`: open→close in direction, best/worst, vs the universe with the same side mix; `record`: overall, longs/shorts,
  by reason); ≥10 sessions → skills-file section “What the desk's daily Top 10 has done”. Docs: `picks/latest.json`,
  `picks/day-DATE.json` (snapshots, pre/post lists), `picks/settings.json`.
- **RSI watch** (`rsiExtremes`, `GET /api/admin/picks/rsi`): `screenerRsi` with max 15 and min 80, period 14, minTurnover 100;
  starts the NIFTY 500 history download (`screenerStart`) by itself once a day when it is missing; 30 s cache. The Screener's
  RSI search now defaults to ₹100 crore a day.
- **Routes:** `GET /api/admin/picks`, `POST /api/admin/picks/refresh` (super), `PUT /api/admin/picks/settings` (super),
  `GET /api/admin/picks/rsi`. Tests: `server/test/picks.test.js` (11), `src/admin/stock/trade/TopPicks.test.js` (2).

**The Journal's Day book (Journal → Day book; `src/admin/stock/analysis/DayBook.jsx`, `server/analysis/`).** One
report per trading day, kept in its own record (`analysis/days` — a collection of its own in MongoDB, a file otherwise).
**Nothing is saved by hand** (the "Save this day" / "Save today now" buttons and `POST /api/admin/analysis/day/:date`
were removed; the auto switch is always on).
- **Saved by itself at 3:45 PM IST** on trading days (`DayAnalysis.tick`, once a minute, outside `server/ai`
  because that folder holds no timers): the day's closed round trips from the journal, the margin that
  is left, any position still open, and the Nifty's move. It tries again every ten minutes (four times)
  if the broker cannot be read, and saves nothing for a day with no trades. An **hourly sweep** (`backfill`)
  saves every day of the last 400 with closed trades and no report (newest first, 20 a sweep, no AI), so a day
  the server missed or an imported Console period appears by itself. A deleted day is rebuilt by the sweep. **Figures are never typed in** (removed
  2026-11-16): `edit()` takes notes only and refuses `overrides`; `buildDay` has no overrides; days edited by hand
  earlier are rebuilt once at start (`dropHandFigures`, old figures kept as `formerOverrides`).
- **Profit, loss and taxes are separate everywhere** — the cards, the table, the charts: *profit* is the sum of
  trades that closed above zero, *loss* the sum of those below zero (both before charges), and *charges &
  taxes* are brokerage, STT, exchange fee, SEBI fee, GST, stamp duty and DP charge, each shown on its own
  and grouped (government taxes & statutory = STT + GST + stamp + SEBI). Net = profit − loss − charges. The charges
  are an estimate from Zerodha's published equity rates (`chargeParts` in `journal.js`).
- **Good and bad practices from the trades themselves**, each with its figures and what it cost: overtrading
  against your usual count, winners smaller than losers, one loss outweighing the winners, losers held longer than
  winners, entries before 9:30 or after 2:45, revenge trades, trading on after two losses in a row, oversized
  positions, charges that turn a profit into a loss, piling into one stock, an intraday position left open, a
  heavy loss day. They come with advice and a process score; they describe the day, they do not predict the next.
- **The AI's "why"** is optional (the model chosen on the AI page; `server/ai/dayreview.js`): written with the
  automatic report when switched on, or on a press of a button; without it the page shows the desk's own
  arithmetic, and a failing model never loses the report.
- **Analytics** over any period (7 days … all, or custom dates), with the previous period for comparison:
  scorecards with sparklines, cumulative net and gross curves, daily profit/loss bars with the net, where the
  money went, charges by kind, weekday and hour tables, rolling win rate and process score, drawdown, a calendar
  of every day, stocks that made and cost money, and how often each habit recurs and what those days netted. The
  charts are plain SVG (no library), keyboard-reachable, with a read-out on hover.

**Journal — P&L for any period, only from Zerodha (`server/trading/journal.js`, `server/journal-capture.js`,
`src/admin/stock/trade/Journal.jsx`, `JournalPeriods.jsx`).** Kite Connect returns only the current day's trades (no endpoint
for past trades or P&L), so `JournalCapture` reads `trading.trades()` every 5 minutes on weekdays 09:10–23:59 IST while Kite
is connected (no page needed), ingests new fills, `markCaptured(day)` and saves `snapshot()`; the history comes from Console
tradebook CSVs (multi-file import; each import records its first/last trade day). Manual add/remove was removed: old
`source: "manual"` fills stay stored but are excluded from `trips()`. A closed trip now counts on its **exit** day.
`periodRange(id, now, { from, to, firstAt })`: today, yesterday (previous weekday), week, month, quarter, 6m/9m/12m, fy,
`fy-YYYY`, all, custom. `periods(now)` returns every period's `summarize()` (trades, win rate, gross, brokerage, taxes,
charges, net, profit factor, expectancy, avg win/loss, drawdown, best/worst day, charges % of gross), every past FY since
`accountSince` (optional, set on the page) or the first fill, all months (heatmap), sources, gaps (10+ weekdays with no fill,
capture or import range) and saved views. `analytics(filters)` adds month-by-month and best/worst month. Saved views
(`saveView`/`removeView`, in the journal record) and daily snapshots (`trading/pnl-snapshots.json`: latest in full plus one
compact row per period per day, 800 days, written only on change). Routes (superadmin): `GET /api/admin/trading/journal?period=&from=&to=&kind=&side=&setup=`,
`GET …/journal/periods`, `POST …/journal/capture`, `GET …/journal/snapshots`, `PUT …/journal/account-since`,
`POST|DELETE …/journal/views[/:id]`, `POST …/journal/import`. **Tradebook files** (`server/trading/xlsx.js`: a dependency-free
.xlsx reader on node:zlib; `readTradebook`/`fromRows` in journal.js: header row found in the first 40 rows, Excel serial dates,
day-first dates, ; or tab separators, UTF-16, segments → NFO/BFO/CDS/MCX, ISIN/segment/series/auction/tradeDate/file kept on each
fill) are uploaded in 2 MB parts (`POST …/journal/upload` → `PUT …/upload/:id/:index` → `POST …/upload/:id/finish`) and kept as
they came by `server/trading/uploads.js` (MongoDB collection `journal_files`, or `data/journal-files/`; id = SHA-256 of the
bytes): `GET …/journal/files`, `GET …/files/:id` (download), `POST …/files/:id/reimport`, `DELETE …/files/:id`. Fills now live
one record each (`docs.items/putItems/removeItems` in `server/docs.js`; MongoDB collection `journal_fills`, read once at start)
because a single MongoDB record caps at 16 MB; the old in-record fills migrate once; up to 300,000 fills; round trips are memoised
until something changes. **Analytics and the Retrospective** (2026-11-16): `analytics()` adds `retro.deeper()` (days, curve with
drawdown, costs by kind, holding buckets, P&L-size buckets, rolling 20-trade win rate, trade mix, sides), `retro.health()` (0–100
from six parts) and `prev` (the same-length period before); `retrospective()` (`server/trading/retro.js`) ranks findings by money
into wentWell / wentWrong / keepDoing / stopDoing / tryNext with a verdict and headline, saved in the journal record (last 30):
`POST …/journal/retro`, `GET …/journal/retros[/:id]`, `DELETE …/journal/retros/:id`. The page's charts are in
`JournalCharts.jsx` (SVG, no library; categorical palette validated with the dataviz checker). **Date pickers** everywhere are
`src/admin/DatePicker.jsx` (Material-style DateField / DateRangeField / TimeField; keyboard; a portal sheet on phones) — no native
date inputs remain. The page: period chips + past-FY select + custom range + saved
views, the period table, an FY bar chart, a month heatmap (FY × Apr–Mar), month-by-month and day-by-day tables, CSV downloads
(periods, months, days, trades, snapshot history), and "Where the history comes from". The P&L calendar shows the period's
months (from the first with a trade, up to 12) and Profit / loss, Taxes and Brokerage + taxes per day.

**AI Engine and AI brains (the workspace before Document; a tile on `/me`; `src/admin/stock/engine/`, `server/ai/brains.js`).**
Every AI feature, rule and condition in plain English (the AI chapters of the Document plus two of its own), and — for the
superadmin only — **AI brains**: standing instructions added to the system prompt of every AI feature in their scope, from the
next request on. Each AI file registers its system prompt(s) with `brains.register(feature, SYSTEM)`; the clients from
`ai._client()` and the AI Live / AI Research analyst are wrapped (`brains.wrap`) so `ask()` appends the brains of that feature.
Saving with "Let the AI refine it" has the default model (fallbacks in turn when it fails) write the final version and choose
the scopes, counted as one of the AI Live daily runs; the owner's wording is kept ("Use my wording").
The page also shows each feature's real instructions word for word and edits the trading-skills file (now superadmin-only), and
downloads everything as a real .docx made in the browser (`docs/docx.js`: a stored ZIP, no library). The Document has the
same Word download.

**The Mandir (`server/temple.js`, `src/admin/temple/`).** Shri Hanuman Chalisa as background audio only (no video, no
floating window) at 5% on every private page, controlled from the Mandir card under Settings and an ॐ button in every
header (one tab plays at a time; browsers need a first tap). Sources: an uploaded audio file (chunked upload, kept in
`server/data/media`, served to signed-in people with a week of browser caching) or an https audio link. A YouTube source is
kept as a link only: YouTube's terms allow neither audio without its player nor downloading, so it never plays in the
background. The brand in every private header is the public site's (`src/admin/BrandMark.jsx`): Vinay's photo in a circle, his name, and “DrishtiAI · AI Trading Advisor” under it; the favicon and the link previews use his photo too. The Panchmukhi Hanuman picture (`public/logo/PanchmukhiHanuman_logo.png`, `-192.png`) stays on the Mandir card only.

**WhatsApp Trading (`server/whatsapp.js`, `server/ai/whatsapp-ai.js`, `src/admin/WhatsAppCard.jsx`; superadmin).** The
official WhatsApp Business Cloud API (Graph v21.0). The webhook `GET|POST /api/whatsapp/webhook` is mounted before
`express.json` so the raw body can be checked against `X-Hub-Signature-256` (HMAC-SHA256 with the app secret); only the
owner's number is answered and each message id is handled once. The server sends a 9:20 AM status, an update every N minutes
(10–120, default 30) in market hours while positions are open (price, P&L, volume, buyers vs sellers, 5-minute RSI, VWAP, the
live call, levels, plus the default model's action and note per position) and the 3:35 PM P&L; alerts, the risk-guard lock and the
3:45 PM report fan out from `notify.js`. Commands: HELP, STATUS, POS, PNL [YESTERDAY|WEEK|MONTH], QUOTE, CALL, ASK, ALERTS,
ALERT, UPDATES ON|OFF, EVERY n, TRADING ON|OFF, BUY/SELL qty SYM [@ price] [MIS|CNC], EXIT SYM, EXIT ALL, NO. Money-moving
commands (and TRADING ON) need "Allow trading from WhatsApp", then `YES <6-digit code> <PIN>` within 2 minutes; 3 wrong PINs
lock it for 30 minutes; orders go through `TradingService` (switch, limits, risk guard, duplicate guard) audited as
`whatsapp`. Token, app secret and verify token are encrypted; the PIN is a scrypt hash. Outside the 24-hour customer window
it needs an approved template (one body parameter) or the owner sends HI.

**TradeAI (`server/ai/tradeai.js`, `server/ai/mixture.js`, `src/admin/tradeai/`; `/me/tradeai`, opened from a `/me` card in
a new tab).** An agentic chat: a plan picks the stocks named (positions, watchlist, NSE list) and the tools needed
(positions/funds, P&L history, snapshot, market, outlook, news via a web search when asked, alerts); the snapshot reads
the live call, verdict, levels, indicators, patterns, setups, habits, odds and the quote's buyers/sellers and circuits. The answer
comes from `askOne` over `ai.modelChain()`: the default model, then (fallback on) each other company with a saved key, one at a
time, then `fallbackAnswer` (the desk's arithmetic, with the reason) — it always answers. Account data is injected by
`app.js` (`ai.tradeai.account`: positions, funds, history, pending orders, today's trips) for the owner only; TradeAI cannot
trade. The page (`src/admin/tradeai/`, a modern AI-chat layout fixed under the site header) has grouped/searchable chats with
rename/pin/delete, `?c=<id>` in the address, a safe Markdown renderer (`markdown.jsx`: headings, lists, tables with coloured
signed figures, no HTML), a timed typewriter reveal, edit/retry/stop/copy, `GET /api/admin/tradeai/suggest` (deterministic
suggestions ranked from positions — losers first —, pending orders, today's trips, watchlist movers, alerts within 1%, time of
day) and `reply.related` after each answer. Routes: `POST …/ask` (`{ conv, text, from }` — `from` rewinds to that question for
edit/retry), `GET …/job/:id`, `POST …/job/:id/stop`, `GET …/convs?q=`, `GET|PUT|DELETE …/convs/:id`, `PUT …/convs/:id/pin`.
Chats are kept by `server/ai/chats.js`: one document per chat in MongoDB's `tradeai_chats` collection (or one record per chat
plus an index in the file store); delete removes the document. The old single `ai/tradeai.json` record is migrated once.

**The AI Engine as one door (`server/ai/engine.js`).** Every feature's model client comes from `ai.engine.client(spec)`
(`ai._client()`, the AI Live / AI Research analyst, `askOne` / `askDefault`, the brains' refine): brains are composed on the way
out, calls on one key share a lane (6 in flight for Anthropic, 6 for others; a promise queue, no timers), and a live board
(`GET /api/admin/ai/engine/live`, the "Live engine" tab) shows running/waiting calls, lanes and today's per-feature counts
(kept in `ai/engine.json`). Web-search prompts are named on the board with `tag()` and take no brains.

**Site health (`server/health.js`, `src/admin/HealthCard.jsx`; `GET /api/admin/health`).** Every part of the site checked
independently (server, database write/read, disk, HTTPS, sign-in, Zerodha, stream, universe, alerts, holidays, AI, the
default model & fallbacks, brains, research, trading, analysis, paper, Telegram, WhatsApp, Mandir) as ok / warn / error / off with a sentence
and a hint; the card under Settings re-checks every minute.

**Advisor tools from the comparison with other products (2026-11-15).** Price alerts checked on the server every 15 s in
market hours (`server/alert-watch.js`) with Telegram messages (`server/notify.js`; token encrypted; also the risk-guard lock
and the 3:45 PM report); a custom scanner over the Nifty 500 (`server/market/scanner.js`, saved scans in `market/scans.json`);
up to 10 named watchlists (the open one is "the watchlist"); a heatmap view of the market board; seasonality on the History
tab (`server/market/seasonality.js`); and nudges on the order ticket (breakeven after charges, circuits, far limits, the entry
window, the live call, revenge re-entries) from `TradingService._nudges`.

**Document (the workspace after Trade Analysis; a tile in the Stock Report section of `/me`; `src/admin/stock/docs/`).**
The manual of the whole advisor in plain English — "the bible": what DrishtiAI is, a map of every part with its name, a
day with the advisor, then every engine and business rule (what it does, how and when) for the market readings,
the live day, trading and risk, records and paper trading, the AI, and the platform, ending in a glossary,
questions and answers and every honest limit in one place. It is plain data (`chapters.js` and `content/*.js`;
blocks of headings, paragraphs, lists, tables, notes and "how it works" cards) shown by `Document.jsx` with a
contents list (folds into a bar on a phone), search that filters the passages and marks the words, justified text,
tables that become cards on a phone, back-to-top and a clean print. It was written from the code itself; when a rule
changes, change the chapter in the same commit (`Document.test.js` only keeps the data well-formed).

**AI Live and AI Research (the "AI Brain" card on the Desk, above the chart; `server/ai/ensemble.js`,
`server/market/pulse.js`, `server/market/outlook.js`).** Two buttons that bring every analyst to one stock,
added on top of everything that already existed — no earlier logic was removed or replaced.
- **The floor needs no AI.** Under the buttons the desk's own arithmetic is always shown and refreshes
  itself (every 20 s in market hours): the **Live Pulse** (next 15–30 minutes) weighs the desk's live call
  together with momentum over 15 and 30 minutes, VWAP side and cross, 1-minute structure, volume and who
  carries it, 5-minute RSI (stretched counts against the move), candle patterns, the opening range and the
  order book; the **Next-Session Outlook** weighs the research direction and the measured odds together
  with trend, momentum, how the last session closed, three-day drift, candles and stretch, and adds the
  expected range, the gap habit, tomorrow's pivots and if-then scenarios. Each piece of evidence votes
  −1…+1 with a fixed weight; the lean is the weighted sum and the confidence is how much of the weight
  agrees. Plans for **both** a long and a short are always shown, and the trader's own position and
  available margin (read-only) shape the advice and the size by risk. Weak or split evidence reads "wait".
- **The Intraday Plan (`server/market/intraplan.js`, `GET /api/admin/ai/intraday/:symbol`)** is the card's
  third view and the one it opens on while the market is shut. On top of the Next-Session Outlook it
  measures how the stock trades inside a day (normal range, the 9:15–9:30 opening range and how often its
  first break holds, when the high and low come, trend days, VWAP, gap fills — from ~150 days of 5-minute
  bars), replays its own plan rules on every past session with no look-ahead (in R, after costs), gives the
  share of past sessions that closed up after a chart that read the same way, and estimates tomorrow's open
  from GIFT Nifty × the stock's measured sensitivity to the Nifty's gaps. It ends in LONG / SHORT on a
  trigger, the opening-range break, WAIT or AVOID, with reasons for and against and a checklist. The same
  plan, for the watchlist plus any typed NSE symbols, is **Research → Intraday research**
  (`src/admin/stock/trade/IntradayResearch.jsx`). Arithmetic only: no AI, no tokens, no orders.
- **The option chain (`server/market/options.js`, `GET /api/admin/market/options/:symbol`)** — the card's
  **Options** view for any stock or index with options: from Zerodha's quotes on the NFO contracts (the NFO
  list downloaded once a day; NSE's website is not read), every strike around the money with OI, OI change
  since the previous session's last saved reading, volume, IV and delta (Black-76 on the futures price), and
  PCR, max pain, the call and put walls, fresh writing, futures build-up, the expected move, skew and a bias
  with its reasons. The Intraday Plan and TradeAI use the bias as one factor.

**The NSE forecast from the world (`server/market/premarket.js`, `server/market/global.js`,
`GET /api/admin/ai/forecast`, `src/admin/stock/analyzer/GlobalMarkets.jsx`).** Before the open: the expected
Nifty open (GIFT Nifty — the successor of SGX Nifty — else the S&P 500 × the Nifty's measured sensitivity)
and the day's lean from GIFT Nifty, the US close and futures, Asia (Nikkei, Straits Times, Hang Seng, KOSPI),
Europe, US and India VIX, crude, the rupee, FII flows, the Nifty option chain and the world-news brief;
during the session, the lean for the rest of the day (GIFT left out, the Nifty's own tide leads). Overseas
indices come from the owner's own Financial Modeling Prep key (encrypted; calls capped at 240 a day);
Zerodha supplies GIFT Nifty, USD/INR, crude, gold and India VIX; the paid model's web search supplies news,
futures and flows. A chip in the market strip, the full reading under Market & world, the expected open of
every Intraday plan, and instant answers in TradeAI.

**Daily goal and profit protection (`server/trading/discipline.js`, `server/discipline-watch.js`,
`src/admin/stock/trade/DailyGoal.jsx`).** Target = 3% and daily stop = 1.5% of the morning's available
margin (fixed for the day). Once the day has been up 1%, at least half of the day's best must be kept;
giving it back, a green day turning red, the target, the stop, and any open position that gave back half its
best gain raise reminders — a banner and sound in the terminal, a desktop notification, and Telegram /
WhatsApp — repeated every 10 minutes while they hold, checked every 15 s in market hours with no page
open. Always visible as the Goal pill in the top bar and a chip on TradeAI; full card and settings on
Positions. Reminders only; an optional switch copies the target and stop into the risk guard.

**Social Media (`server/social/`, `server/ai/social.js`, `server/social-watch.js`, `src/admin/social/`;
`/me/social`, opened from a `/me` card in a new tab).** An aggregator of the owner's sources — news sites'
RSS, Google News searches, X accounts (API v2 with the owner's Bearer Token, encrypted, never read back),
YouTube channels, Reddit communities and NSE's announcements. **Software first, AI only when needed:** a
watcher every 30 s reads due sources (3 min news / 5 Google News & Reddit / 15 X) with conditional
requests (ETag / If-Modified-Since, so an unchanged feed costs nothing), keeps each story once (≤ 800
items, 4 days), and the rules (`extract.js`) give every item its stocks, sectors, event, tone (phrases,
negation, stated % moves), certainty, impact and relevance, and group the same story across sources. The
default model reads an item only in mode "smart" (default) when it matters (open positions via
`social.focusSymbols`, tracked stocks, high impact) AND the rules cannot settle it (unclear tone, an
unnamed market-wide event, a social post about a stock), within "batches an hour" (default 4). The Desk
brief (`deskBrief`) is written by the rules, always; the AI brief on request (or every half hour when
`aiBriefAuto`). `SocialService` is an EventEmitter: on "items", app.js pushes to the page's SSE stream
`/api/admin/social/stream` (with `X-Accel-Buffering: no`) and sends news alerts to Telegram / WhatsApp
(high impact on tracked stocks / open positions; ≤ 1 per stock per 30 min, 12 a day; "Alert me").
Its signal is a vote in the NSE forecast, a reason in each Intraday plan, part of the AI Live / AI
Research brief, and TradeAI's instant "latest news / any news on X / trending" answers. Official access
only: no username/password logins, no posting, no orders. Routes under `/api/admin/social` (reads for
admins, changes for the superadmin).

**AI credits: never spent twice, never for what the desk already knows.** The AI Engine (`engine.js`)
reuses any identical request (model, instructions with brains, data, schema) within 15 minutes and
shares identical in-flight requests; "Reused today" on the Live engine tab; reused answers do not count
against daily AI-run limits; Retry / Refresh / Rewrite pass `{ fresh: true }`. TradeAI reuses an
answer for the same question, stocks, earlier turn and models on unchanged data (or within 3 minutes),
and answers more questions instantly from the desk: levels, the desk's reading (live call, VWAP, RSI,
MACD…), next-session outlook, the market today, the owner's results — unless a judgement is asked.

**GIFT Nifty for the expected open.** Measured against the close of the NSE near-month Nifty future
(`MarketService._giftGap`, one NFO quote), so the futures premium cancels out; a settled 0.00% (every
weekend) is never read as a flat open — the forecast says so and leaves GIFT out.

**TradeAI routing (`server/ai/route.js`).** Data questions (positions, today vs the goal, margin, a price, the
option chain, the intraday plan, orders, alerts) are answered instantly from the desk with no model; every
other question by the default model (Claude Sonnet 5.5 unless another is picked) — Fast: a brief answer
from less data; Advice: the full data; Deep (research, compare, the week ahead): longer thinking (effort
medium); the fallbacks one at a time; "Model answers a day" (150) and "Use the AI model" on TradeAI's ⚙.
Auto / Fast / Deep in the composer; @ suggests
stocks; voice input; export to Markdown.
- **The buttons bring the analyst.** AI Live / AI Research start a run for the open stock: the **default
  model** (Claude Sonnet 5.5 unless another is picked on the AI page) first does the web search when its
  company can — company news and world markets, kept 30 minutes so credits are not spent twice — then
  reads the brief. When it fails, the AI page's fallback models (the other companies with a saved key)
  are tried one at a time.
- **The weighing is arithmetic too.** Votes (the desk's own included) carry weights, adjusted by each
  model's own scored record once it has 20 decided calls (0.4–1.6×); a long or short is called only when
  the lean is clear, at least 60% of the weight agrees, the desk's engine does not oppose, no gate is shut
  (entry window, thin volume, spread, a stale quote) and the plan passes the same `checkPlan` arithmetic as
  every other plan. Otherwise: wait. AI is optional — with no key, or if every model fails, the answer is
  the desk's arithmetic in full, with the same plans.
- **Only on a press.** Nothing in `server/ai/` has a timer. "AI runs a day" (default 40) and the wait for
  the model (default 90 s) are on the ⚙ panel, which also lists each model's track record. Live calls are scored against the price
  30 minutes later, next-session calls against that session's close.
- **Screener and Research.** The board's "AI, one by one" runs the top 3 / 5 / 10 stocks shown through the
  default model one after another — each stock is one of today's AI runs — with a chip per stock (the
  server also accepts `engineOnly` for an arithmetic-only run); each Research
  stock card has its own AI Research. No AI run can place an order; the web context is untrusted text, and the
  plan checks and the lack of any order code bound what it could do.

**Paper trading (the "Paper" workspace; card on `/me`; `server/paper/`).** The desk's own live call
followed with play money — never real money. Rules are the Debrief's day replay (`server/market/replay.js`):
a fresh "Long / Short — in play" call at a 5-minute close is entered at that close with the call's stop
and first target, and closed on the opposite call or at the 3:15 PM square-off; size comes from a paper
capital and a risk per trade (₹10 lakh and 1% to start), results after an assumed cost per round trip.
- **Live market:** today's calls for up to 15 stocks (the watchlist, or a list typed on the page), as
  they happen; open trades marked to the latest 5-minute close.
- **History:** the same engine over the last N finished sessions (`market.replayHistory`), each session
  judged only on what was known before it; totals, per stock, per session.
- **Auto mode:** switched on, it paper-trades the market every five minutes in market hours, makes the
  day final after the close and then re-tests the setup on history — every weekday, by itself. The
  counts are kept per **setup** (a fingerprint of the rule files and the cost), so a deploy that changes
  the engine starts a fresh count.
- **Separate from real trading:** paper trading never places an order and is not connected to the
  trading service or its switch in any way — it reads prices only. Real Buy and Sell on the desk work
  exactly as before, whether auto mode is on or off. Nothing in `server/paper/` can reach the broker
  or the trading service (a test checks).
- **Learning:** finished paper trades are split a few fixed ways (long/short, with/against the daily
  trend, entry time); a slice becomes a finding only with 30+ trades and |t| ≥ 2. Findings are written
  into the trading-skills file as their own section ("Paper-test findings"), rewritten after each test —
  never piled up — so every AI answer reads the latest measured evidence. Paper results leave out
  slippage and partial fills; they are evidence, not a promise.

**Market board (top of the Screener).** Any NSE index, chosen from a drop-down grouped as NSE groups
them — indices eligible in derivatives (NIFTY 50, NIFTY BANK, NIFTY FINANCIAL SERVICES, NIFTY MIDCAP
SELECT, NIFTY NEXT 50), broad market (NIFTY 100 / 200 / 500, MIDCAP 100 / 150, SMALLCAP 100 / 250) and
sectoral (auto, consumer durables, energy, FMCG, healthcare, IT, media, metal, oil & gas, pharma,
private bank, PSU bank, realty). Each list is NSE's published constituents file
(`server/market/indexlist.js`, re-read weekly; copies of 14 Nov 2026 in `index-snapshots.json`). NIFTY
INDIA FPI 150 is not offered: NSE publishes no constituents file for it. The table follows NSE's live
equity market page — the index's own row on top, then symbol, open, high, low, previous close, LTP,
change, % change, volume, value, 52-week high and low — plus RSI, VWAP, "× usual" and the day range. The
**RSI search** below covers the **Nifty 500**; the history download covers the Nifty 500 and every
index on the board (about 500 stocks, about three minutes once). Like NSE's top gainers / losers page, it is live while
the market trades (refreshed every 15 s) and the last session's figures when it is closed: LTP, change,
% change, previous close, open, high, low, day range, volume, value traded, "× usual" (today's value
against the 20-day average day), VWAP (the exchange's average traded price) and distance from it, daily
RSI with today's price as the newest bar (with its direction since yesterday), and the 52-week range.
Boards: top gainers, top losers, most active, volume surge, RSI overbought (≥ 70), RSI oversold (≤ 30),
above / below VWAP, near the 52-week high / low, all 100; any column sorts, a filter box narrows it, a
row opens the stock on the desk. Market breadth (advances / declines) and the Nifty sit on top.
`GET /api/admin/market/screener/board`. RSI and the 52-week range need the screener's one-time history
download (under a minute); prices work before it.

**Screener = NSE top 100.** The screener covers the Nifty 100 only. Its list is read once a week
from NSE's own published file (`nsearchives.nseindia.com/content/indices/ind_nifty100list.csv`,
asked for with an honest User-Agent; `server/market/indexlist.js`), with a copy of 13 Nov 2026
used until the first read.

**Calendar.** A time zone converter with every zone the browser knows. BSE/NSE holidays stay
hand-checked: NSE publishes them only through pages that refuse plainly-identified automated
requests, and the terminal does not pretend to be a browser. NASDAQ holidays sync automatically.

**Security.** Flood control on every `/api` request per visitor address (a small budget for anyone
not signed in, `RATE_ANON_PER_MIN`, default 90; a large one for a signed-in session,
`RATE_USER_PER_MIN`, default 1500), answered with 429 and Retry-After; nginx limits on top
(`stock-deploy --nginx-limits`, a file for `/etc/nginx/conf.d`); HSTS, COOP and a tighter
Permissions-Policy; the app listens on 127.0.0.1 only in production (`HOST` in the pm2 file), so
nginx cannot be bypassed; request text is stripped of CR/LF and control characters before it is
logged; the OAuth callback is rate-limited. A single server cannot absorb a large distributed
attack by itself — a front service such as Cloudflare does that.

**Compact on every screen (`terminal/compact.css`, `terminal/BottomNav.jsx`, `terminal/useMedia.js`).**
One slim row on top at every width; nothing is capped at a centre column, so a 1920 or 2560 px
monitor is used edge to edge.
- **Phones and tablets (up to 1100 px):** the workspaces move to a bar along the bottom edge — the
  first four on a phone with the rest under **More** (which also holds the market clock, the
  Zerodha connection and the theme), all of them on a tablet. The top bar keeps the search, the
  trading switch's state, the day's P&L, alerts and the account menu. Tall stacks become one-row
  strips that scroll sideways (tiles, the day's stats, months, breakdowns); the verdict's reference
  blocks and the order book fold under their titles; dialogs rise from the bottom edge; fields keep
  16 px text so a phone does not zoom into them; a wide table keeps its name column in view. A phone
  held sideways gets a shorter bar.
- **Laptops:** all eight workspaces fit in the top bar without scrolling; the words inside the
  status pills drop away before anything is clipped. On the Desk the connection line and the
  search share one row.
- **Wide monitors (1600 px and up):** the Advisor keeps its board on the left and the selected
  stock's full reading open beside it (three columns from 2300 px); Positions puts the switch beside
  the risk guard and the table beside the coach; the Journal puts the breakdowns and the review
  beside the trade list; the Calendar's clocks and two holiday lists sit side by side.
- **Advisor on a phone:** a card per stock instead of a table. Everywhere, the stock ticker carries
  the Advisor's grade for the open stock ("Odds: Swing long · A"), which opens the full reading.
- A card's description and the long footnotes show one or two lines and open on a click or tap;
  the Journal lists the latest 25 round trips with a button for the rest (its figures always cover
  every trade).

**Stock Report — `/me/stock-report`.** Opens in its own tab from the dashboard (the session
cookie is shared, so you stay signed in). It shows a world clock for India, USA (New York),
Singapore, UK, Japan and China with each city's offset from a reference city (daylight saving
included; click a city to compare against it), plus exchange holiday calendars.

**Trading desk (the first view of the Stock Report; uses the whole window).** A read-only study tool for NSE
stocks: a watchlist with live quotes; for each stock a candle chart (EMA 20/50/200, Bollinger,
Supertrend, volume, RSI), a transparent −100…+100 technical reading, seven rule-based long setups
with every condition ticked off plus stop-loss and R-multiple levels, pivots/CPR, support and
resistance, 52-week range, ATR, intraday VWAP and opening range, a position-size calculator,
~10-year backtests of every setup on that stock (next-open fills, gap-aware stops, costs), and
return/drawdown history.

- **Data: Zerodha Kite Connect**, with your own API key (`server/market/kite.js`). It needs the paid
  *Connect* app (the free *Personal* app has no market data). Setup steps are on the page under
  "Zerodha setup"; the redirect URL to register is `<your-origin>/api/admin/market/kite/callback`.
  Kite sessions end at 6 AM IST every day (exchange rule), so one "Log in to Kite" click is needed
  each trading morning.
- **The desk itself is read-only.** `server/market/` calls only `/quote`, `/instruments` and
  `/instruments/historical` — no order, GTT, portfolio or funds code, and a test fails if any
  appears. Trading lives apart, in `server/trading/`, behind its own switch (see *Positions &
  orders* below).
- **Fails safe, not silent.** Daily candles are cached in `server/data/market/`; if Kite is down or
  the token has expired the last good data is shown and labelled *Not live*. A split/bonus
  re-adjustment triggers a full re-download. Requests are throttled to Kite's limits.
- **Demo data** ("Explore with demo data") uses made-up `DEMO-…` series, clearly labelled, so the
  tool can be explored before connecting. Real tickers are impossible in demo mode.
- **What it is not.** It is arithmetic on prices — no fundamentals, news, results dates or advice,
  and it cannot guarantee a profitable trade. Add or change setups in `server/market/strategies.js`
  (each is a list of explicit conditions, used identically by today's reading and the backtest).

`npm run dev` starts the API with `node --watch`, so it restarts itself whenever server code
changes; the page also checks for fields an older API would not send and says "restart" instead
of failing.

**Desk verdict (the trading desk's right-hand column; a "Verdict" tab below 1500 px).** Pick any NSE
symbol in the search box at the top — it does not have to be on the watchlist, and `?s=SYMBOL`
keeps it across a refresh. `server/market/verdict.js` then gives one mechanical reading:

- **Live intraday call (first on the panel, refreshed every 2 seconds in market hours)** —
  `server/market/intraday.js`. From the live quote, today's 5-minute bars and the IST clock it gives
  one of: *Long in play*, *Short in play*, *Wait — long/short only at ₹X*, *Wait — no edge*, or
  *No trade*. The tape score (−100…+100) is the sum of seven visible factors: price vs VWAP (the
  exchange's average traded price), opening range, 5-minute EMA trend, last-30-minute momentum,
  place in the day's range, move since the open, and volume behind the move. Time of day changes
  the rules: nothing in the first 15 minutes, a higher bar at midday (11:30–1:30), no fresh entries
  after 2:45 PM, flat before the ~3:15 PM square-off. It also refuses near or at a circuit limit,
  when the last trade is over five minutes old, and tells you to wait for a pullback rather than
  chase a move whose stop would be wider than 0.8 ATR. Entries come with a stop (VWAP / opening
  range, 0.2–0.8 ATR away), 1R and 2R targets and the next levels.
  A breakout is only "in play" after a full 5-minute bar has **closed** beyond the opening range —
  a single tick through the level reads "not yet confirmed".
- **On screen:** a sticky ticker (symbol, live call, price flashing on each tick); an intraday
  chart — **1-minute or 5-minute** candles — on a fixed 9:15–3:30 axis with VWAP, the opening range,
  the no-entry times shaded and the call's entry / stop / targets as lines (`IntradayChart.jsx`;
  "Daily" switches back to the daily chart, and the choice is remembered on the device); a log of every change of the call since the stock was opened, with an optional
  sound/notification ("Alert me on a change"); a light/dark theme toggle for the desk; and on
  phones the watchlist collapses to one swipeable row and the verdict becomes the first tab.
- **Long term (months to years)** — `server/market/longterm.js`: a checklist (price vs 200-day
  average, 50 vs 200, slope of the 200, 10 vs 30-week, distance from the 52-week high, 12-month
  return, relative strength vs Nifty), the weekly line that ends the trend, 1/3/5-year returns per
  year, worst drawdown and volatility. Price history only — no fundamentals.
- **Swing stance** — Bullish, Bearish or Neutral, from three time frames: weekly trend (10/30-week EMAs),
  the daily score, and during market hours the intraday picture (VWAP, first-15-minute range,
  5-minute EMAs). The daily chart decides: other time frames can strengthen or weaken its reading
  but never create a direction on a flat daily chart (`DAILY_MIN`).
- **Conviction** — how far the evidence agrees (0–100). It drops for disagreeing time frames, a
  trendless chart (low ADX), stale data and a price near a circuit limit. It is not a probability.
- **Delivery plan (long only)** — entry, stop, 1R/2R/3R targets, reward to first resistance, a
  pullback zone when price is stretched, and the level that ends the bullish case. A bearish
  verdict says "stay out / follow your exit", never "short delivery".
- **Intraday plan** — a long trigger and a short trigger (today's opening range once the market is
  open, otherwise the previous session's high/low), half-ATR stops, pivot targets, and which side
  is preferred. Cash-market shorts must be closed the same day.
- **Circuit limits** — upper and lower circuit from the live quote, how far away each is, and
  targets beyond a limit are removed.
- **Every level, top to bottom** — circuits, pivots/CPR, support/resistance, 52-week range,
  previous-day range, VWAP, moving averages, with the current price in its place.
- **What argues against it** — always shown.

Built to refuse rather than guess: with too little history, or a live price more than 30% away
from the saved history (an unprocessed split or bonus), it gives no verdict and says why. During
market hours pivots use the last *completed* session, never today's unfinished bar. Without a live
quote or intraday bars it still answers, and states what is missing. `server/test/verdict.test.js`
checks the rules, including 300 randomly generated markets for consistent plans (stop on the right
side of entry, targets in order and inside the circuit band, no NaN anywhere).

It remains a rule-based reading of price and volume. It is wrong some of the time, cannot see
news or results, and is not investment advice.

**Live prices — streamed, not polled.** While Zerodha is connected the server keeps one WebSocket
to Kite's streaming endpoint (`server/market/ticker.js`, the documented KiteTicker binary format,
"full" mode) and forwards ticks to the page as Server-Sent Events
(`GET /api/admin/market/stream`). Each price label subscribes to its own symbol
(`src/admin/stock/analyzer/liveTicks.js`), so a tick redraws that label at once; the header also
shows best bid and ask. The live call is recomputed every 2 seconds from the streamed price.

- It reads only: the socket sends nothing but subscribe / unsubscribe / mode, and ignores every
  text frame. Subscriptions are reference-counted across open pages (Kite allows 3,000
  instruments on a connection).
- It heals itself: reconnect with back-off, a watchdog for a connection that goes silent, and no
  retry storm when Zerodha refuses an expired session. A streamed price is served only while the
  stream is live — if it drops, the page says so and falls back to polling every 5 seconds.
- Circuit limits are not on the stream, so quotes are still polled, but only every 30 seconds for
  a streamed symbol. The stream sets `Cache-Control: no-transform` so the development proxy and
  any compression layer pass it through unbuffered.

**The market around the stock** (`server/market/context.js`, the strip under the connection bar).
From the same Zerodha feed: Nifty 50, Bank Nifty and India VIX (streamed), ten sector indices,
GIFT Nifty (`NSEIX:GIFT NIFTY`), the front-month USD/INR, crude and gold futures, and the
**tide** — a −100…+100 reading of which way the Nifty is moving (vs yesterday's close, since the
open, place in the day's range, 5-minute trend, Bank Nifty, sector breadth).

- The live call adds two visible lines to its score: the tide (±8) and the stock's move since the
  open against the Nifty's (±7). The stock's own tape score is shown separately, so the market's
  effect is never hidden. A rising VIX and a trade against a strong tide are stated as notes.
- The watchlist ranks every stock live against the index ("Strongest" / "Weakest") — where to
  look for a long, where for a short. It is worked out in the browser from the streamed quotes
  (`radar.js`).
- **World brief** (needs the AI key; on request only): Claude gathers US, Asian and European
  markets, crude, the dollar, yields, FII/DII flows and the day's events with Anthropic's web
  search tool, then a second request puts the text into a fixed shape. It is stored with its
  sources and shown as background. Because those figures come from a web search and can be stale
  or wrong, they are **never** used in a score or a trigger — the live call only mentions the
  brief when it argues against the trade.

**Screener — every NSE stock by RSI** (the "Screener" view; `server/market/universe.js`). Type an
RSI value, choose "about / at most / at least / between", and search: the list is every main-board
NSE stock whose **daily RSI, with its live price as the newest bar**, is there at that moment.
Selecting a row opens the stock on the trading desk.

- **One-time download.** The first use fetches about a year of daily closes for each stock (one
  request per stock at Zerodha's three-a-second limit: roughly 12 minutes for ~2,000 stocks), in
  the background, into `server/data/market/universe.json`. It resumes if interrupted.
- **Then it keeps itself current.** Every quote carries the previous session's close, so one batch
  of quotes (400 stocks per request) rolls every series forward — no further downloads.
- **Refuses rather than guesses.** A series that no longer matches the exchange (a split or bonus)
  is left out of the results and downloaded again in the background.
- It is the daily RSI only: an exchange-wide 5-minute RSI is not possible at this speed through
  the Kite API. SME / trade-to-trade series, bonds and gilts are excluded; ETFs are optional.

**Reacting on the tick** (`tripwires.js`, `useTripwires.js`, the "Live events" list). Every streamed
tick for the open stock is checked against the call's levels — VWAP, the two triggers, the previous
day's high and low, and in a trade the stop and targets. A break is listed the instant it happens
(with a sound if alerts are on) and the call is re-read at once instead of waiting for the next
2-second poll; closing in on the stop or a trigger gets a word in advance. The live call also
carries **early warnings** (`early` in `intraday.js`): a failed breakout, a break of the last
5-minute swing low/high, a new extreme on weaker RSI, a rush in the last minute read from the tick
stream, the order book tilting hard against the trade (pressure beyond ±50), a turn of the
1-minute tape (its averages, its swing structure and the last five minutes must all agree), and
price sitting on VWAP. They mark an open trade as "weakening" but never start or flip a trade by
themselves — fast to warn, slow to commit.

**The 1-minute tape** (`fastRead` in `intraday.js`, `GET /api/admin/market/tape/:symbol?interval=1|5`,
`useTape.js`, `FastRead.jsx`). "Intraday · 1 min" on the Overview tab draws today's 1-minute
candles with the same VWAP, opening range, shaded no-entry times and plan levels as the 5-minute
view, plus the last 1-minute swing high and low. It can show the last hour, the last two hours or
the whole day; the candle still forming follows the live price, and the bars refresh every ten
seconds. Under the chart — and in short form in the verdict panel — is the **1-minute read**: the
9/21-minute EMA trend, 1-minute RSI, the last 1 / 5 / 15 minutes, the swing structure and the last
five minutes' volume against the session's average minute. One-minute bars turn first and mislead
most, so the live call itself still waits for a 5-minute close.

**Order book and order flow** (`server/market/flow.js`, `OrderBook.jsx`). For the one stock that is
open ("in focus"), every streamed tick also carries Zerodha's market depth — the **five best bids
and offers, each with its quantity and the number of orders behind it** — and the desk's reading of
it:

- **The book in numbers:** spread in rupees and ticks, quantity near the price (nearer levels weigh
  more), every pending buy against every pending sell, the average order size on each side, and any
  single level several times larger than its neighbours (a "wall").
- **Signed trade flow:** each burst of volume is signed by where it traded — at the offer is buying,
  at the bid is selling — and summed over 30 seconds, a minute and five minutes.
- **Pressure (−100…+100):** one number from the book and the trades together, with a three-minute
  line. Beyond ±50 against an open trade it becomes an early warning.
- **The 30-second lean — the desk's own small model.** An online logistic regression that learns,
  on this stock, today, how those readings relate to where the mid price is thirty seconds later.
  Every prediction is scored *before* the model learns from that example, so the hit rate printed
  beside the lean is honest; until 60 examples are scored it says "learning", and when the recent
  hit rate is not clearly above half it says so and should be ignored. A new day, or closing the
  page, starts a new model.
- **What it cannot be.** Five levels are not the whole book, the stream is a few snapshots a second
  rather than every order, resting quantity can be placed to mislead and cancelled, and a
  thirty-second lean is too short to trade on once costs are counted. It helps time what the call
  already says; it does not make the call. Nothing here can place or modify an order.

**AI strategist (optional; the "AI strategist" tab on the desk, settings at `/me/ai`).** With an
API key for any of five AI companies, the default model (Claude Sonnet 5.5 unless another is picked) builds a strategy for the open stock **on
request** — never on a timer, so nothing is spent in the background. Without a key the tab says it
is off and every other feature works unchanged. Code: `server/ai/`.

- **Companies** (`server/ai/providers.js`): **Anthropic** (Claude, official `@anthropic-ai/sdk`),
  **OpenAI** (GPT; chat completions with schema-held answers, web search through the Responses
  API), **Google Gemini** (`generateContent`, JSON output, web search by Google Search grounding),
  **DeepSeek** and **Moonshot AI** (Kimi) — the last two over their OpenAI-style chat APIs with the schema in the prompt
  and the answer read leniently. At `/me/ai` (the **AI model** page) pick the default model: the company, then one of its models; the list is
  read live from the company with the saved key (**↻ Refresh models**, no tokens), so new model names
  appear without code changes — the catalogue in `providers.js` is only the starting list.
- **One key per company, kept.** Each company has its own encrypted key, chosen model and last
  test (`settings.aiKeys`, `aiModels`, `aiTests`, `aiModelLists`; the older single Anthropic key is
  read and moved over on the next save). Switching back to a company never asks for its key again —
  only when its test fails. A new key is saved, tested, and its model list read in one step.
- **Applies everywhere at once.** Every request builds its client from the settings at that moment,
  so a change applies to the next request. The pages share one copy of the settings
  (`src/admin/aiStatus.js`): a change is pushed to every open component and, through a
  BroadcastChannel, to other open tabs — no refresh.
- **One logic for every model.** The company only changes who answers. Every feature sends the
  same instructions, the same trading-skills file and the same market brief, with the same JSON
  schema; Anthropic holds its answer to the schema, every other company's answer is checked against
  it (`server/ai/contract.js`: one correction request, then a clear failure, never a malformed plan).
  Then the same arithmetic checks (`checkPlan`) and the same scoring on real prices apply to all. The
  record is also kept **by model** ("By model" on the strategist tab), so models are compared on
  their finished plans, not on claims. A test sends one plan through every company and checks
  that each got identical instructions and brief and that the plan was judged identically.
- **One default model for every feature** (`ai.defaultModel()`, `ai.modelChain()` in
  `server/ai/service.js`): Claude Sonnet 5.5 ($2 / $10 per million input / output tokens) unless the
  owner picks another; "Back to Claude Sonnet 5.5" on the page. Anthropic models offered: Sonnet 5.5
  (default), Opus 5.5 ($4 / $20), Fable 5.2 ($8 / $40), Haiku 5.5 ($0.10 / $0.50). **Fallback**
  (`settings.aiFallback`, on by default): when the default fails, each other company with a saved key
  is tried in turn on its own chosen model. The free NVIDIA-hosted models were removed: a one-time
  migration (`aiDefaultModelV2`) moves an older free setup to Anthropic + Sonnet 5.5 and deletes the
  NVIDIA key; an `nvapi-` key is refused.
- **Web search** (world brief, news check) runs on the default model's company when it has search
  (Anthropic, OpenAI, Gemini); with DeepSeek or Kimi it borrows another company whose key is saved, and
  says so on the settings page.

- **Keys** are encrypted with the same key as the other secrets, are write-only (set / replace /
  remove; only a short hint is ever returned) and go only to their own company. With Anthropic,
  requests use structured output (`output_config.format`), adaptive thinking with an effort setting, and —
  where the model supports it — Anthropic's server-side refusal fallback (`fallbacks: "default"`).
- **What is sent:** one stock's market data from Zerodha (quote, today's 5-minute bars, the last
  30 daily bars, indicators, levels, circuit limits, the rule engine's reading on all three
  horizons, the seven backtests) plus the trading-skills file. Nothing personal.
- **Every plan is checked by arithmetic** (`checkPlan`): stop on the losing side, targets in
  order, all levels inside the circuit limits, a stop distance that is sane for the horizon
  (0.1–1.2 ATR intraday, 0.3–3 ATR swing), reward at least equal to risk, entry consistent with its
  type and within reach, swing plans long-only, intraday entries only inside the entry window. A
  plan that fails is shown as **rejected**, with the failed checks. "No trade" is a valid answer.
- **Journal and scoring.** Every plan is saved (`server/data/ai/journal.json`). "Score outcomes &
  learn" scores unresolved plans against the bars that followed — intraday plans on that day's
  5-minute bars up to 3:15 PM, swing plans on up to 20 later sessions. A bar that touches both stop
  and target counts as a stop; a gap through the stop is filled at the open.
- **Trading-skills file** (`server/data/ai/trading-skills.md`, editable on the page): the rules the
  model follows. When at least three newly finished plans exist, the model is shown their scored
  outcomes and may append up to five lessons; the rules above the lessons are never overwritten,
  and only the newest 60 lessons are kept.
- **Live co-pilot** (`server/ai/copilot.js`, the card under the live call, `useCopilot.js`). The
  AI, live on the one stock that is open — but event-driven, not a loop. With "Go live" on, the
  page asks for a short reading when the engine's call changes, when the price breaks one of the
  call's levels, when an early warning appears against the trade, and (optionally) after a set
  number of quiet minutes; "Ask now" asks once. The server has the last word: never sooner than
  the minimum gap for one stock (default 120 s), never more than the daily limit across all stocks
  (default 80), and only while the live call exists. Nothing runs on the server by itself, nothing
  is asked while the tab is in the background, and the switch is off again in a new browser tab.
  The model is shown the engine's call and score, its early warnings, the 1-minute tape, the order
  book and flow, the market's direction and one-line world and news summaries. It answers with a
  bias for the next ten to fifteen minutes (up / down / **unclear**), whether it agrees with the
  engine, what to watch and why it could be wrong — and **never with prices of its own**. Every
  "up" or "down" is scored by arithmetic against the price ten minutes later (right / wrong / flat
  at ±0.05%), and that record is printed under the card. Model, gap, daily limit and the quiet-time
  refresh are set at `/me/ai`.
- **"Why is it moving?" — news check** (the AI tab; `news()` in `server/ai/service.js`). On
  request, a web search on the one company — results, contracts, rating changes, block deals, what
  is scheduled — put into a fixed shape with its sources. Only the symbol, the company's name and
  today's change are sent. For six hours the strategist and the co-pilot are shown its summary,
  labelled as web-search material that can be stale or wrong.
- **Day debrief** (the "Day debrief" view of the Stock Report; `server/market/replay.js`,
  `server/ai/debrief.js`, `Debrief.jsx`). Two layers, and the first needs no AI:
  - **The scorecard — arithmetic only.** For up to 15 watchlist stocks the live call is *replayed*
    over the session's 5-minute bars: at each bar's close the engine is asked for its call with only
    what was known then (bars so far, a quote built from them, the daily picture as of the previous
    close). Each change to "in play" opens one imaginary trade at that close — stop first (a bar
    that touches both stop and target counts as a stop; a gap through the stop fills at the open),
    then the 1R target, otherwise out at the open of the 3:15 PM bar; one trade at a time per stock.
    Results are in **R** (multiples of the risk taken), before and after an assumed round-trip cost
    (0.1% of the position's value by default; 0 / 0.05 / 0.1 / 0.2% on the page). The page shows
    the day's totals, a running-total line of every finished call, a bar per stock, and for each
    stock its price with the side the engine was on and every call in a table. A test proves the
    replay never looks ahead: replaying the morning alone gives exactly the morning of the full day.
    `GET /api/admin/market/scorecard`, `GET /api/admin/market/replay/:symbol`.
  - **The written debrief — on request, with a key.** The model is shown only those numbers, plus
    the co-pilot's scored readings and the strategist's plans from the same session, and writes
    what worked, what did not, a note per stock, what to have in mind at the next open, and at most
    three lessons. **A lesson is saved to the trading-skills file only when you press "Add" on
    it.** One debrief is kept per session (the last 30); yesterday's can still be written the next
    morning.
  - **What it is not.** Not a record of trades taken. The live call is read every two seconds and
    also weighs the market's direction, the tick stream and the order book; the replay reads it
    every five minutes without them, so the two can differ. Real fills slip, the cost is an
    assumption, and one day proves nothing either way.
- **What it is not.** It has no order, basket or portfolio code (a test fails if any appears in
  `server/ai/`), and nothing in that folder runs on a timer. Beyond the two web-search summaries it
  cannot see news or results. No model and no method is profitable on every trade — the track
  records on the page are the measure, and they say when the sample is too small to mean anything.

- **NASDAQ — synced automatically from the official source.** The server reads Nasdaq Trader's
  published schedule (`nasdaqtrader.com/trader.aspx?id=Calendar`) at start-up and every 6 hours,
  parses it strictly, and stores the last good copy in `server/data/holidays.json`. If the exchange
  changes its list, the page follows on the next check (the server log prints what changed). A failed
  fetch, an outage or a page that no longer parses never overwrites good data; the page says so. Years
  the exchange has not published yet are calculated from its holiday rules until it does. "Check now"
  on the page asks the server to look again (at most once a minute).
- **BSE / NSE — checked by hand, not synced.** NSE's holiday feed only answers requests that pretend
  to be a browser, and BSE's page returns 403 to automated requests; there is no permitted way to
  sync them. The 2026 list in `src/admin/stock/holidays.js` (`INDIA`) was compared with NSE's own
  published list on 12 Nov 2026 (identical). The page shows that date, and warns from 1 December if
  next year's list is missing. **Each December: compare with the exchange's list, add the new year to
  `INDIA`, and bump `INDIA_META.verifiedOn`.**

**Positions & orders (the account owner only; `server/trading/`, `src/admin/stock/trade/`).** Your
Zerodha account on this site, built as a fallback for days when the Kite app or website is down but
Zerodha's API still answers: positions with live P&L, holdings, the order book and trades, funds and
margins (all read always) — and, while the **trading switch** is ON, Buy / Sell (market, limit, SL,
SL-M; MIS / CNC / NRML; AMO), modify and cancel, exit a position (all or part), sell holdings, and
**Exit all positions** (optionally cancelling every pending order first). Order updates arrive live
from Zerodha's stream; the page also re-reads the book every 5 seconds.

- **The switch.** OFF by default. While it is off, every Buy, Sell, Exit, Modify and Cancel button
  is greyed out — and the server refuses those requests (HTTP 423) whatever is sent. Only the
  superadmin can turn it on; turning it on asks first. The other admins never see this view.
- **Guard rails, on the server.** Every order needs an explicit confirmation and a fresh reference,
  so a double click or a retried request cannot place it twice. Per-order limits on quantity and
  value (set on the page) stop a fat finger; an order that only closes something you already hold
  is never stopped by them. Market and SL-M orders always carry Zerodha's market protection.
  "Exit all" needs EXIT ALL typed. Every switch change and every order — and Zerodha's refusals —
  go to `server/data/trading/audit.jsonl`, shown under "Activity on this site".
- **Only one file can send an order**: `server/trading/broker.js`. The market folder and the AI
  folder cannot load it, and a test checks that.
- **Before you rely on it.** Since 1 April 2026 Zerodha accepts API orders only from the **static
  IP registered on your Kite Connect app** (SEBI's retail-algo rules; reads work from anywhere) — the
  server must run on that IP. Selling delivery shares needs **DDPI** (or the day's CDSL TPIN
  authorisation). The day's Kite login is still needed. It helps when the Kite app is down, not
  when Zerodha's own order system is; then call Zerodha's dealing desk.
- **AI position coach** (`server/ai/coach.js`, the Positions tab). On request, the model reads
  your positions and holdings — quantity, average, live price, P&L, product, funds, open orders —
  next to the desk's live call, levels and early warnings for each stock, and suggests hold /
  tighten stop / trim / exit / wait with levels taken from the desk. It advises only: the trading
  routes hand it the figures as plain data, it cannot reach the broker, and a stop on the wrong
  side of the price is flagged and dropped.

**Advisor: measured odds (the "Advisor" workspace and the "Measured odds" card on each stock;
`server/market/edge.js`, `src/admin/stock/advisor/`).** The engine answers one question per stock:
*on the past days that looked most like today, what happened next — and when this method said
"favourable" in the past, was it right?*
1. Every completed daily bar is described by twelve numbers known at its close (distance from the
   20- and 50-day averages in ATRs, the 50-day's slope, RSI, the 5-day move, place in the 20-day and
   52-week ranges, volume against normal, volatility against its own year, where the bar closed,
   the Nifty's trend, strength against the Nifty); the day reading adds the next morning's gap.
2. Every past day has an outcome by fixed rules, after costs, in R (multiples of the risk).
   **Swing**: in at the next open, stop 1.5 ATR, target 2.25 ATR, out after 10 sessions, a gap
   through the stop fills at the open, stop and target in one bar counts as the stop, 0.25% costs.
   **Day**: in at the open, stop 0.6 ATR, out at the close, 0.1% costs. Long and short are measured.
3. Today's odds come from the 50 most similar past days (kept a few sessions apart): the share that
   made money with a cautious lower bound, and the average result minus one standard error.
4. **The walk-forward test decides.** The same question is asked for every past day using only what
   was known before it, and each favourable call is traded on paper, one at a time. Grade **A** needs
   40+ such trades with t ≥ 2.5 and a positive last two years; **B** 25+ with t ≥ 1.5; **C** means
   today looks favourable but the test does not back it — treat as noise. Tests check that a
   planted pattern is found, that pure noise yields nothing above C, and that no reading uses a bar
   from its own future (`server/test/edge.test.js`).
The Advisor ranks the watchlist by grade, shows the similar-day odds, the forward test, a plan priced
at the latest price and the quantity for your **risk per trade**, and opens a pre-filled order ticket
for A and B readings (a swing short is shown as a downside warning, not a trade). Two records keep it
honest: the method **pooled across the watchlist**, and the **forward record** — every favourable
call is written down the day it is made (`market/signals.json`) and scored later against real bars
by the engine's own rules, so hindsight cannot improve it. Readings are stored
(`market/edge.json`), good for one part of the trading day, and rebuilt in the background. The AI
decision receives the odds as a third input, as past frequencies with sample sizes. It is
arithmetic on past prices: a proven record can stop working, and nothing here is a probability of
profit or advice.

**Plan-aware order ticket and pre-trade check (`trade/OrderTicket.jsx`, `POST
/api/admin/trading/preview`).** "Plan the exit" adds a stop, a target and the money you accept
losing: the ticket shows the rupees at risk, the reward, their ratio, and the quantity that fits the
risk. The stop is not sent with the entry; when the entry fills (seen on Zerodha's order stream) the
terminal *offers* the stop-loss order as a ticket to confirm — it never sends one by itself. The
pre-trade check shows the margin and charges from Zerodha's own calculator (`POST /margins/orders`,
a calculation that places nothing), what is available, and whether the per-order limits and the
risk guard would let the order through. It works with the trading switch OFF.

**Price alerts (the bell in the top bar; `terminal/AlertsContext.jsx`).** "Tell me when SBIN reaches
800". Alerts live in the database (`market/alerts.json`); the open terminal watches live ticks (or a
15-second check when the stream is off) and reports a crossing to the server, so an alert fires once
whichever tab saw it: a tone, a note, and a browser notification if allowed. An alert never trades.

**One live connection, and screens that come back at once.** Every part of the page that wants live
prices shares a single stream (`analyzer/liveTicks.js`); each used to open its own, and with the
order stream that left few of the browser's ~6 connections per site for everything else. The last
good answer to each market read is kept for the visit (`api.js` `peek`), so a stock or workspace
you return to is drawn immediately and refreshed behind. If the site is served over HTTP/1.1,
enabling HTTP/2 in nginx (`listen 443 ssl http2;`) removes the connection limit altogether.

**Behaviour memory and the AI decision (the "Behaviour & AI" tab on each stock;
`server/market/profile.js`, `server/ai/decision.js`).** For each stock the server measures how it
has behaved over the past year of daily bars: trend phases (by the 50-day average and its slope),
swing structure, volatility against its own normal, gaps and their same-day fill rate, what
followed big up and down days, how 20-day breakouts and breakdowns followed through, how it
reacted at its 50-day average in uptrends, levels from clustered swings, weekday tendencies,
volume on up versus down days, drawdowns, plain-language "habits" (only with enough samples), and
a dated log of notable days. It is stored in the database (`market/behaviour.json`), rebuilt at
most once a day with one snapshot per day, so the record grows; the watchlist refreshes itself
once a day while the desk is in use, or on "Learn whole watchlist". **AI decision**: the model gets
the full live brief (price, volume, 5- and 1-minute tape, indicators, levels, the rule engine, the
market, news) AND the behaviour profile, and returns buy / sell (intraday short) / hold / wait /
avoid with where it is heading, the evidence from each source, where they disagree, and — for buy
or sell — entry, stop and targets that go through the strategist's mechanical checks. Decisions are
stored with the price at the time (`ai/decisions.json`). This is additional: no existing reading
changed. Concurrent reads of one stock's daily bars now share a single download.

**Risk guard (Positions; `server/trading/risk.js`).** Prop-desk limits on your own account, enforced
by the server: a **daily loss limit** (on today's mark-to-market), an optional **profit lock**, a
cap on **orders a day** and on **open positions**. A breach **locks the day**: new trades are refused
(HTTP 423) until the end of the IST day, while exits, sells of holdings, cancels and changes to
orders that close a position always go through. While locked, limits can be tightened but not
loosened or switched off. The top bar shows "Risk locked"; gauges on Positions show the room left.
It never places an order by itself — there is no auto-liquidation (a deliberate choice: a closing
order sent without you is a decision this tool does not take). Off by default.

**Journal (the "Journal" workspace; `server/trading/journal.js`, `src/admin/stock/trade/Journal.jsx`).**
Every fill is kept: today's come in from Zerodha by themselves whenever the account is read (its
API only returns the current day), and history comes from a **Zerodha Console tradebook CSV**
(Reports → Tradebook → download; repeats are ignored). Fills are paired into round trips, flat to
flat (a fill that flips the position is split). Charges are **estimated** from Zerodha's published
equity rates. It shows net P&L, win rate, profit factor, payoff, expectancy, max drawdown,
streaks, green days, an equity curve and a P&L calendar, breakdowns by stock, hour of entry,
weekday, side, intraday/delivery, setup tag and mistake tag (groups under 8 trades are greyed),
**MAE / MFE** per trade from 1-minute bars (about the last 60 days) with the share of the best move
kept, and tags (setup, mistakes, note, execution rating) on each trip. **AI review** (`server/ai/review.js`):
the model reads the journal's figures (never the broker) and names where money is made and lost;
rules it suggests go into the skills file only when added. Stored as `trading/journal.json` and
`ai/reviews.json` (MongoDB or files, like every record).

**Research — pre-market and post-market (`server/ai/research.js`, the "Research" view).** Pick
stocks from the watchlist and a phase (mornings default to pre-market, afternoons to
post-market). Each stock gets a data sheet from the desk — daily indicators (RSI, MACD, ADX,
stochastic, Bollinger %B, Supertrend, relative volume), pivots and levels, the seven setups and
their backtests on that stock, the weekly / daily / intraday verdict, the long-term view and the
news check. With an Anthropic key the model writes a note per stock (bias, conviction, key levels,
if-then scenarios for the session, long and short triggers, what cancels the idea, when to stand
aside, a checklist for the open) and a summary across the list (clearest set-ups, ones to leave
alone, the first 30 minutes). Optional: a fresh news check per stock and a fresh world brief. It
runs as a job the page follows; reports are kept in `server/data/ai/research.json`. Without a key
you get the data sheets alone.

**Holiday lists show only what is to come.** Holidays already past are hidden (the summary says how
many), past years are not offered, and when a year has no closures left the page points to the
next one.

**Analytics.** The GA4 ID is set in the dashboard and fetched at runtime. It is never loaded
on a local run (`localhost`, `127.0.0.1`, LAN addresses, `npm start`), in the admin area, or
for a signed-in admin browsing the live site.

**Tests.** `npm run server:test` (API, roles, sessions, secret handling, indicators, setups, backtester, desk verdict, the live
call, streaming and market depth, order flow, the screener, the Kite data layer, and the AI strategist, co-pilot and news check
against a fake Anthropic API, and the day replay and debrief, and trading: the switch, limits, double-click protection, exits, the audit log, and that only
`server/trading/broker.js` can send an order; the position coach and research) and `CI=true npm test -- --watchAll=false`
(analytics loader, tripwires, chart axis, co-pilot triggers, debrief chart arithmetic, P&L and order-ticket checks).

## SEO and link previews

- `src/data/seo.js` holds every title, description, keyword and JSON-LD entity;
  `components/seo/Seo.jsx` renders them as meta tags. `public/index.html` carries
  the same tags statically for crawlers that never run JavaScript.
- `npm run build` prerenders the page to static HTML and **writes
  `build/sitemap.xml`** from the route list in `scripts/prerender.js`
  (`lastmod` = date of the last commit touching `src/` or `public/`).
- The link-preview card (WhatsApp, LinkedIn, X, Facebook) is
  `public/og-image.jpg`, 1200×630: portrait, name, the opening line and the
  Hindi motto. Regenerate it if the photo or tagline changes.
- **The private area previews page by page** (`server/previews.js`): every
  `/me` address — the dashboard, Stock Report and each workspace
  (`?view=journal`, `analysis`, `engine`…), TradeAI, Social Media, the AI model,
  the Pro Chart (`/me/chart/SBIN`), the settings pages — gets its own title,
  description, canonical, Open Graph and large X card, written by the server into
  the bare admin shell (crawlers do not run JavaScript; `prerender.js` bakes the
  dashboard's tags between `<!--preview-->` markers and `app.js` swaps the block
  per request, escaped, with the public origin — `PUBLIC_ORIGIN`, else the
  request's host over https). Unknown addresses preview as the dashboard; only the
  desk's `view` is taken from the query. The area stays `noindex`; previews name
  a page and what it is for — never an account, price or person.
- Its pictures are `public/img/og/<page>.png` (1200×630, 256 colours, under
  300 KB): the Panchmukhi Hanuman logo (`public/logo/PanchmukhiHanuman_logo.png`) beside the page name and two lines. After adding
  or renaming a page in `server/previews.js`, redraw them with
  `node scripts/og-images.js` (needs ffmpeg — `FFMPEG=` its path — and Segoe UI,
  or `OG_FONT` / `OG_FONT_BOLD`).

## Editing content

Everything readable lives in `src/data/`. The Hindi author bio, the motto and
the author's contact links are in `src/data/author.js`; the path from Ghazipur
to Noida is `JOURNEY` in `src/data/profile.js`. Nothing in `components/` or
`sections/` needs to change to update copy.

## Images

All generated from a single source photo into `public/`:

| File | Used for |
| --- | --- |
| `vinay-portrait.jpg` / `-sm.jpg` | Intro section portrait (responsive `srcSet`), hero background motif |
| `vinay-avatar.jpg` | Nav brand mark, signature, contact block |
| `favicon.ico`, `favicon-512.png` | Browser tab — circular crop with an amber ring |
| `apple-touch-icon.png`, `logo192/512.png` | iOS home screen + PWA manifest |
| `og-image.jpg` | Link previews on social / WhatsApp / LinkedIn |

To swap the photo, replace these files keeping the same names and dimensions.

## Motion notes

- **Smooth scroll** keeps native scroll as the source of truth and lerps toward
  a target each frame, so `position: sticky`, anchors and scroll-linked
  animations all keep working. Disabled on touch devices and when the visitor
  prefers reduced motion.
- Two things will silently kill the wheel if reintroduced:
  1. `html { scroll-behavior: smooth }` — the browser then animates toward
     every `scrollTo()` the engine issues, so `scrollY` lags the target.
     The engine forces `scroll-behavior: auto` while it is active.
  2. Resyncing the target on every `scroll` event. Those events are
     asynchronous echoes of the engine's own writes; treating them as user
     input collapses the target onto the current position and eats all
     momentum. The engine ignores them while its loop is running.
- `MotionConfig reducedMotion="user"` collapses every animation to a cross-fade
  for visitors with the OS setting enabled.
- Add `data-lenis-prevent` to any inner scrollable element to opt it out.
- Add `data-cursor="Label"` to any element to show a label inside the cursor ring.

## Performance & mobile

- Images ship as WebP with JPEG fallback via `components/ui/Picture.jsx`; the
  nav/signature/contact avatars use a 200px variant (5 KB) instead of the
  1024px original (170 KB).
- Google Fonts request only the weights actually used.
- Hover styles are gated behind `@media (hover: hover)` so they don't stick
  after a tap; `:active` gives press feedback instead.
- Tap targets are ≥42px under `@media (pointer: coarse)`; the assistant input
  is pinned to 16px on small screens so iOS doesn't zoom on focus.
- Grain, heavy shadows and the hero portrait are dropped on small screens and
  under `prefers-reduced-data`.
- Safe-area insets are respected for notched devices.
