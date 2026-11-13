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

A login-protected control room that is **not linked from the public site**, is served
`noindex`, and loads none of the public site's code. It needs the small Node server in
`server/` (a static-only host cannot run it; the public site still works there).

**Who can do what**

| | Superadmin | Admin |
| --- | --- | --- |
| Sign in with Google | `vinaytiwari.iist@gmail.com` (fixed, always allowed) | Anyone the superadmin adds |
| Google sign-in settings, Analytics ID, dashboard | yes | yes |
| Add / remove admin users | **yes** | no |

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

**Data.** Everything lives in `server/data/` (git-ignored): `db.json` (settings, admin list;
the Client Secret is stored AES-256-GCM encrypted), plus the two key files. Back that folder
up; losing `settings.key` means re-entering the Client Secret.

**Welcome on the dashboard.** Every time `/me` opens — after signing in, on a refresh, in a new tab,
and on coming back to the dashboard from a settings page — it first shows the Shri Ram Darbar
(`src/admin/Welcome.jsx`) and sounds the mantra "ॐ श्री गणेशाय नमः" one time. It closes by itself
after about eight seconds, or at once with Enter or Esc. The small ॐ under the greeting shows it
again without reloading; "Sound on / off" on the welcome is remembered. (It belongs to the
dashboard only: the Stock Report and the settings pages open without it.)

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
Anthropic API key set, Claude builds a strategy for the open stock **on request** — never on a
timer, so nothing is spent in the background. Without a key the tab says it is off and every other
feature works unchanged. Code: `server/ai/` (official `@anthropic-ai/sdk`).

- **Key and model** are set at `/me/ai`. The key is encrypted with the same key as the other
  secrets, is write-only (set / replace / remove; only a short hint is ever returned), and is used
  for calls to Anthropic's API only. Models offered: Claude Opus 5.5 (default), Fable 5.2,
  Sonnet 5.5, Haiku 5.5 — edit `MODELS` in `server/ai/client.js`. Requests use structured output
  (`output_config.format`), adaptive thinking at `high` effort, and — where the model supports it —
  Anthropic's server-side refusal fallback (`fallbacks: "default"`).
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
