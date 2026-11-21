# DrishtiAI — the name, and how to write it

The whole system built in this repository — the private area at `/me`, the trading terminal (Stock
Report), the AI Engine and its brains, TradeAI, Social Media, the Journal and its analytics, WhatsApp
Trading, Telegram alerts, the Mandir, the Document — is called **DrishtiAI**.

| What | How it is written |
|---|---|
| The name | **DrishtiAI** — one word, capital D, capital A and I, no space or hyphen |
| With its line | **DrishtiAI — the AI Trading Advisor for NSE** (an em dash with a space on each side) |
| Short header (narrow screens) | **DrishtiAI — AI Trading Advisor**, then **DrishtiAI** |
| Meaning | Drishti (दृष्टि) means “sight” |
| Logo | An eye (drishti = sight) whose pupil is a rising price line, on its own dark-blue round badge: `public/drishti-logo.svg` — ONE drawing, used everywhere in the trading area through `src/admin/DrishtiLogo.jsx`. Since 20 Nov 2026 it replaces the owner's photo there |
| Brand in a header | the logo, **DrishtiAI** (the “AI” in the accent colour) and under it the small spaced line **AI Trading Advisor** (`src/admin/BrandMark.jsx`, the line is `BRAND.line`); on a phone the logo alone |
| Where the logo appears | the header of every private page, the terminal's top bar, the dashboard's side column, TradeAI's mark and avatar, the tab icon, the link previews |
| Favicon (private area) | `drishti-logo.svg` with PNG copies `drishti-192.png`, `drishti-512.png`, `drishti-apple-touch.png` (and `drishti-32.png`); set in `src/admin/AdminApp.jsx` and `scripts/prerender.js` |
| Link previews (private area) | `public/img/og/<page>.png`, the logo beside the page name, drawn by `scripts/og-images.js` from `drishti-512.png` |
| After changing the logo | redraw the PNG copies from the SVG (any browser or image tool; 32, 192, 512 px round, and 180 px on a square of `#0c1c3e` for Apple), then run `node scripts/og-images.js` |
| Browser tab | `DrishtiAI` |
| Files it names | `DrishtiAI-complete-guide.docx`, `DrishtiAI-AI-Engine.docx` |

Where the name comes from in code — change it there, and only there:

- `src/admin/brand.js` — everything the private area shows (header, terminal top bar, tab title,
  Document and AI Engine titles and Word files).
- `server/brand.js` — the server's messages (WhatsApp, Telegram, price alerts, the risk guard and the
  3:45 PM report).

Feature names stay as they are: **TradeAI** (the chat), **Social Media**, **AI Engine**, **AI brains**, **Stock Report**
(the trading terminal), **Trade Analysis**, **Journal**, **WhatsApp Trading**, **Mandir**.

The public website at `/` (vinaytiwari.org) is the owner's personal site and keeps its own name, photo and icons.

## Buttons — one system, in `src/admin/buttons.css`

Loaded last by `src/admin/AdminApp.jsx`, so it governs every page of the private area. Do not style
buttons again in a page's own CSS — only place them (margins, width, row height inside a table).

| Kind | Class | Use |
|---|---|---|
| Filled | `adm-btn adm-btn--solid` | the main action of a place (one per card where possible) |
| Outlined | `adm-btn` | everything else |
| Ghost | `adm-btn adm-btn--ghost` | quiet actions in a header or toolbar |
| Danger | `adm-btn adm-btn--danger` | anything that cannot be undone |
| Small | add `adm-btn--sm` | inside cards, tables and tool rows |
| Trading | `tr-btn tr-btn--buy` / `--sell` / `--exit` | Buy (Zerodha blue `#0059c1`), Sell (Kite orange, darkened to `#cf4113` so white text reads), Exit (ink) |
| Chips | `.jp-chips`, `.sv__ranges`, `.sv__tabs`, `.sr-views`, `.pc__toggles` rows | periods, kinds, tabs inside a page |

Heights: 40 px (small 34 px, terminal small 32 px) with a mouse; **44 px (small 40 px) on a touch
screen**. Labels are semibold, centred, and wrap rather than overflow. A disabled button stays
readable (grey fill, secondary ink). Keyboard focus shows a 2 px accent ring.

## Text colours — readable in light and dark

Every piece of text meets WCAG AA (4.5:1, or 3:1 for large text) in **both** themes; checked page by
page on 15 November 2026. Rules that keep it so:

- Take text colours from the tokens (`--ink`, `--ink-2`, `--ink-3`, `--up-ink`, `--down-ink`,
  `--warn-ink`, `--accent`), never from a chart or series colour. Light-theme tokens live in
  `.adm {}` in `src/admin/stock/analyzer/analyzer.css`; dark ones in `.adm[data-desk="dark"]`.
- Text on a filled accent uses `--on-accent` (white on the light theme's Zerodha blue, near-black on the dark
  theme's light blue). Never hard-code white text on `--accent`.
- Gold (Mandir) is `#8a6100` / `#7a5600` on light and `#d9a93a` / `#e8b84a` on dark.
- Numbers drawn on a coloured cell (calendar days, heatmap values) sit on a small surface-coloured
  pill so they read whatever the cell's colour.
- `.adm a { color: inherit }` beats a single class: a link styled as a button needs a `.adm …`
  selector (as `buttons.css` does) to keep its own text colour.

The public homepage (`src/styles/site.css`) was brought to the same standard: `--ink-3` and
`--accent-2` were darkened in its two themes.

## Two palettes: the public site's, and the private area's (20 November 2026)

**The public site (vinaytiwari.org) wears the owner's own colours**, chosen from his birth chart by the traditional
rule (favour the colours of the lord of the ascendant and of the lords of the 1st, 5th and 9th houses). The chart and
the reasoning are on his private Kundali page (`/me/kundali`, superadmins only) — they are not in this repository.

| Colour | Value | Where (`src/styles/site.css`) |
|---|---|---|
| Sandal ivory | `#f8f4ec` (surfaces `#fffdf9`, `#f2eadb`) | `--paper` of the page (`[data-theme="tech"]`) |
| Ink | `#21150f` | text: a deep warm brown, never pure black |
| Ruby maroon | `#7a1f2b` | `--accent`: buttons, links, emphasis |
| Copper | `#96460f` | `--accent-2` |
| Gold | `#c8962e` | `--gold`: rules and glows only, never small text |
| Deeper sandalwood + saffron copper | `#f3e7d2`, `#8a3c08` | the writer's band (`[data-theme="write"]`) |

**The private area (/me and every page under it) wears Zerodha's theme** (the owner's choice, 21 November 2026:
"same color, same text, same theme"). On 20 November he had tried the Kundali family there and gone back to navy the
same day; a day later he asked for Zerodha's look instead. The values are **Zerodha Kite's own**, read from Kite's
published stylesheet (`:root` and `[data-theme=dark]`), plus Zerodha Console's primary blue `#0059c1`; Kite's font,
Open Sans, was already the private area's.

| Role | Light | Dark | Kite's own value, and why it differs (if it does) |
|---|---|---|---|
| Page / panel | `#ffffff` / `#ffffff`, band `#fafafb` | `#111111` / `#181818`, band `#242424` | the same |
| Text | `#444444` | `#bbbbbb` | the same |
| Second text | `#555555` | `#9e9e9e` | Kite has none between its two greys |
| Muted text | `#6b6b6b` | `#8f8f8f` | Kite's `#9b9b9b` / `#666` are too faint to read (2.8:1, 3.1:1) |
| Lines | `#eeeeee`, `#dddddd` | `#232325`, `#363636` | the same |
| Accent (links, selected, Buy) | `#0059c1` | `#4f8cf0` | Kite's `#4184f3` reads at 3.6:1 on white, so Console's own blue; dark `#4987ee` a touch lighter |
| Orange (active tab, eyebrows, Sell) | `#c73a0e` text, `#ff5722` underline | `#dc6a45` | Kite's `#ff5722` is 3.2:1 as text; it is used exact for the underline |
| Green — up, profit | `#2c7f32` text, `#4caf50` fills | `#62a464` | Kite's `#4caf50` is 2.8:1 as text; exact for bars and candles |
| Red — down, loss | `#c53f3a` text, `#df514c` fills | `#e66a66` | Kite's `#df514c` is 3.9:1 as text; exact for fills |
| Amber — caution | `#ff8f00` fills, `#7a4f00` text | `#ff8f00`, `#ffb547` text | Kite's amber |

Every text shade above is Kite's own colour made just dark (or, in dark, light) enough to read at 4.5:1 or better —
the owner asked on 15 November 2026 that every text be readable in both themes. A page-by-page audit after the change
(Desk, Journal, /me, Expenses, Kundali, Advisor, Research, Admin users; light and dark) found nothing below that.

The look — flat white panels, hairline borders, 3–4px corners, no glows or glass, headings in Open Sans, the selected tab
in orange with an orange underline as in Kite's top bar — is one stylesheet loaded last, `src/admin/kite.css`. Delete it
to bring back the softer shapes; the colours stay with the tokens in `src/admin/stock/analyzer/analyzer.css`. Built-in
accent "blue" is now Zerodha blue; the other accents under Customize still override it.

**No text overflows (2026-11-21).** Text wraps rather than spilling out of its box, being cut off, or ending in "…";
no page scrolls sideways on a phone. The rules that guarantee it sit in `src/admin/fit.css`, loaded after `kite.css`.
A new label that must stay on one line goes in a box that scrolls, never behind `text-overflow: ellipsis`.

**Zerodha's words.** Every profit-and-loss figure uses the terms of Zerodha's own reports: **Realised P&L** (before costs),
**Charges & taxes**, **Other credits & debits**, **Net realised P&L** (after costs), **Unrealised P&L** (open positions),
and on the Positions page Kite's **Total P&L**, **Day's P&L**, **Margin available**, **Margins used**. The Journal opens
with Zerodha's five-figure P&L strip and ends with its per-symbol table (Qty., Buy avg., Buy value, Sell avg., Sell value,
Realised P&L, Unrealised P&L). "Other credits & debits" shows "—": Zerodha's API does not give them.

DrishtiAI keeps its own name and logo; nothing of Zerodha's brand (name, logo) is copied into the private area.

- The public theme sits on the private area's own root element (`<div data-theme="tech" class="adm">`), so the
  private area states its light colours in full in `.adm[data-theme="tech"]`
  (`src/admin/stock/analyzer/analyzer.css`). **Never let a private page take a colour from the public theme**, and do
  not use the public-only `--gold` token in private CSS.
- A change to the public palette must be checked on `/me` in light mode, and the other way round.
- Colours are a traditional observance. They do not change a price, and nothing in the desk's logic reads them.

Named on 15 November 2026, by the owner.
