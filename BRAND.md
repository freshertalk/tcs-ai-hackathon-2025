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
| Trading | `tr-btn tr-btn--buy` / `--sell` / `--exit` | Buy (deep blue), Sell (deep orange), Exit (ink) |
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
- Text on a filled accent uses `--on-accent` (white on the light theme's navy, near-black on the dark
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

**The private area (/me and every page under it) keeps the colours it always had** — the owner tried the same family
there on 20 November 2026 and chose to go back the same day. So: light porcelain `#f4f5f7` with navy `#1e4b7a`, dark
`#0b0f14` with light blue `#6aaeee`, the logo on its dark-blue badge, blue as the built-in accent.

- The public theme sits on the private area's own root element (`<div data-theme="tech" class="adm">`), so the
  private area states its light colours in full in `.adm[data-theme="tech"]`
  (`src/admin/stock/analyzer/analyzer.css`). **Never let a private page take a colour from the public theme**, and do
  not use the public-only `--gold` token in private CSS.
- A change to the public palette must be checked on `/me` in light mode, and the other way round.
- Colours are a traditional observance. They do not change a price, and nothing in the desk's logic reads them.

Named on 15 November 2026, by the owner.
