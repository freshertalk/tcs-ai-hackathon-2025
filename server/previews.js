"use strict";
// Link previews for the private area (/me): what WhatsApp, Telegram, Slack, X, LinkedIn and iMessage
// show when a page's address is shared.
//
// Those apps read the page's HTML without running its JavaScript, so the server writes the tags into
// the bare admin shell for each address (app.js): the page's own title and description, the canonical
// address, Open Graph (og:*) and the large Twitter/X card, pointing at a 1200×630 picture made for
// that page (public/img/og/<image>.png, drawn by scripts/og-images.js from this same list).
//
// Previews only name a page and describe what it is for — never any account, position, price or
// person. The private area stays out of search engines (noindex) while still previewing well.

const SITE = "DrishtiAI";
const LINE = "the AI Trading Advisor for NSE";
const IMG_W = 1200;
const IMG_H = 630;

/**
 * Every page: `name` (on the card and in the title), `description` (the preview's text, ≤ 200
 * characters), `card` (one or two short lines drawn on the picture) and `image` (its file name).
 */
const PAGES = {
  dashboard: { name: SITE, title: `${SITE} — ${LINE}`, description: "A private workspace for intraday trading on NSE: the live desk, TradeAI, Social Media, the Journal, measured odds and plans — with the Mandir beside it.", card: ["Your private intraday desk for NSE:", "live calls, TradeAI, news, Journal"], image: "drishtiai" },
  stockReport: { name: "Stock Report", description: "The trading terminal: the watchlist, the full chart, the live intraday call, order book and co-pilot for one stock, with positions docked below.", card: ["The trading terminal for NSE:", "chart, live call, book, co-pilot"], image: "stock-report" },
  desk: { name: "Desk", description: "One stock, live: the watchlist, the chart, the desk's intraday call with its plan, the order book, AI Live and the co-pilot.", card: ["One stock, live: chart and call,", "the plan, the order book, AI Live"], image: "desk" },
  advisor: { name: "Advisor", description: "The watchlist read by measured odds: what followed the days most like today, whether such calls held up when tested forward, and a plan sized to your risk.", card: ["The watchlist read by measured odds,", "with plans sized to your risk"], image: "advisor" },
  positions: { name: "Positions", description: "Positions, holdings, orders and funds, the daily goal and profit protection, the trading switch and the AI coach.", card: ["Positions, orders, funds, the daily", "goal and profit protection"], image: "positions" },
  journal: { name: "Journal", description: "Every intraday round trip, saved by itself: win rate, profit factor, expectancy, drawdown, the P&L calendar, MAE/MFE, tags and an AI review.", card: ["Every round trip, saved by itself:", "win rate, expectancy, drawdown"], image: "journal" },
  research: { name: "Research", description: "Pre-market and post-market research for the watchlist: levels, scenarios, the next session's outlook and an intraday plan for each stock.", card: ["Pre-market and post-market research,", "with an intraday plan for each stock"], image: "research" },
  screener: { name: "Screener", description: "Any NSE index — NIFTY 50, BANK, NEXT 50, broad and sector indices: gainers and losers, RSI, VWAP, volume and the 52-week range, live.", card: ["Any NSE index, live: movers, RSI,", "VWAP, volume and the 52-week range"], image: "screener" },
  paper: { name: "Paper Trading", description: "The desk's live intraday call followed with play money — in today's market, on past sessions and in an auto mode. No real orders.", card: ["The live call, with play money:", "today, past sessions and auto mode"], image: "paper" },
  debrief: { name: "Debrief", description: "After the close: what following every live call by fixed rules would have made or lost today — a report card for the desk's signals.", card: ["After the close: the desk's signals", "scored by fixed rules"], image: "debrief" },
  calendar: { name: "Calendar", description: "World clock and the upcoming NSE and BSE trading holidays.", card: ["World clock and the upcoming", "NSE and BSE trading holidays"], image: "calendar" },
  analysis: { name: "Trade Analysis", description: "Every trading day read back: profit and loss after charges and taxes, trades and margin, what went well and what did not, with analytics over many days.", card: ["Every trading day read back, with", "analytics over many days"], image: "trade-analysis" },
  engine: { name: "AI Engine", description: "Everything about the AI in one place: every feature, rule and condition, the AI brains, the live engine and the trading-skills file.", card: ["Every AI feature, rule, condition,", "the brains and the live engine"], image: "ai-engine" },
  document: { name: "Document", description: "The complete guide to this advisor in plain English: every feature, who does what, and every rule — what it does, how and when.", card: ["The complete guide in plain English:", "every feature and every rule"], image: "document" },
  tradeai: { name: "TradeAI", description: "Ask anything about the market, a stock or your intraday trades: answered from the desk's live data in plain English, with tables, levels and actions.", card: ["Ask about the market, a stock", "or your trades — from live data"], image: "tradeai" },
  social: { name: "Social Media", description: "Live news and posts that can move NSE and BSE stocks — news sites, X, Reddit, YouTube and NSE announcements — organised for intraday trading.", card: ["Live news and posts that move NSE", "stocks, organised for trading"], image: "social" },
  ai: { name: "AI Model", description: "The one AI model every feature uses — Claude Sonnet 5.5 by default — its key, the fallback and the live co-pilot's limits.", card: ["The one AI model every feature uses,", "its key and the fallback"], image: "ai-model" },
  google: { name: "Google Sign-in", description: "The Google sign-in that guards this private area: only the owner and the people they add can enter.", card: ["The Google sign-in that guards", "this private area"], image: "google" },
  analytics: { name: "Analytics", description: "The site's analytics setting: the measurement ID for the public pages.", card: ["The analytics setting for", "the public pages"], image: "analytics" },
  admins: { name: "Admin Users", description: "Who may sign in to this private area, and what each of them can do.", card: ["Who may sign in,", "and what each can do"], image: "admins" },
  access: { name: "Private Access", description: "A private workspace: entry by invitation only.", card: ["A private workspace:", "entry by invitation only"], image: "access" },
  chart: { name: "Pro Chart", description: "The full-screen chart: candles, moving averages, VWAP, Bollinger Bands, volume and the desk's levels, for any NSE stock.", card: ["The full-screen chart for any", "NSE stock: candles, VWAP, levels"], image: "chart" },
};

// the desk's workspaces (/me/stock-report?view=…), as the terminal names them
const VIEW_PAGE = { analyzer: "desk", advisor: "advisor", account: "positions", journal: "journal", research: "research", screener: "screener", paper: "paper", debrief: "debrief", calendar: "calendar", analysis: "analysis", engine: "engine", document: "document" };
const ROUTE_PAGE = { "": "dashboard", "/stock-report": "stockReport", "/tradeai": "tradeai", "/social": "social", "/ai": "ai", "/google": "google", "/analytics": "analytics", "/admins": "admins", "/personal-access": "access" };
const SYMBOL = /^[A-Z0-9][A-Z0-9&._-]{0,24}$/;

/**
 * The preview of one private-area address.
 * @param pathname  e.g. "/me/stock-report"
 * @param query     the request's query object (view=…)
 * @returns { key, name, title, description, image, path } — an unknown address gets the dashboard's
 */
function previewFor(pathname, query = {}) {
  const rest = String(pathname || "").replace(/^\/me/, "").replace(/\/+$/, "");
  let key = ROUTE_PAGE[rest];
  let extra = null;
  if (rest === "/stock-report" && query && VIEW_PAGE[String(query.view || "")]) key = VIEW_PAGE[String(query.view)];
  const chart = /^\/chart\/([^/]+)$/.exec(rest);
  if (chart) {
    key = "chart";
    const sym = decodeURIComponent(chart[1]).toUpperCase();
    if (SYMBOL.test(sym)) extra = sym;
  }
  if (!key || !PAGES[key]) key = "dashboard";
  const p = PAGES[key];
  const name = extra ? `${extra} — ${p.name}` : p.name;
  // the address previewed: the path, plus the workspace for the desk (nothing else from the query)
  const known = key === "dashboard" ? "/me" : `/me${rest}`;
  const path = rest === "/stock-report" && VIEW_PAGE[String((query && query.view) || "")] ? `${known}?view=${String(query.view)}` : chart && extra ? `/me/chart/${encodeURIComponent(extra)}` : known;
  return { key, name, title: p.title || `${name} — ${SITE}`, description: extra ? `${extra} on NSE: ${p.description.charAt(0).toLowerCase()}${p.description.slice(1)}` : p.description, image: p.image, path };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The tags for one page; `origin` is the site's address (https://…), no trailing slash. */
function previewTags(p, origin) {
  const url = `${origin}${p.path}`;
  const img = `${origin}/img/og/${p.image}.png`;
  const alt = `${p.name} — ${SITE}, ${LINE}: the page name beside Panchmukhi Hanuman Ji`;
  return [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<meta name="robots" content="noindex, nofollow, noarchive" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    `<meta property="og:image:secure_url" content="${esc(img)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${IMG_W}" />`,
    `<meta property="og:image:height" content="${IMG_H}" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(p.title)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    `<meta name="twitter:image" content="${esc(img)}" />`,
    `<meta name="twitter:image:alt" content="${esc(alt)}" />`,
    `<meta name="application-name" content="${SITE}" />`,
    `<meta name="apple-mobile-web-app-title" content="${SITE}" />`,
  ].join("\n    ");
}

const START = "<!--preview-->";
const END = "<!--/preview-->";

/**
 * The admin shell with this page's tags: the block between the preview markers (written by
 * scripts/prerender.js) is replaced; an older shell without markers gets its <title> replaced.
 */
function injectPreview(html, tags) {
  const block = `${START}\n    ${tags}\n    ${END}`;
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a >= 0 && b > a) return html.slice(0, a) + block + html.slice(b + END.length);
  // an older shell: drop the tags this block brings, then put the block in place of the title
  const bare = html.replace(/<meta\s+name="(?:robots|description|application-name|apple-mobile-web-app-title)"[^>]*>\s*/gi, "").replace(/<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/gi, "").replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "");
  if (/<title>[\s\S]*?<\/title>/i.test(bare)) return bare.replace(/<title>[\s\S]*?<\/title>/i, block);
  return bare.replace("</head>", `${block}\n  </head>`);
}

module.exports = { PAGES, VIEW_PAGE, ROUTE_PAGE, SITE, LINE, IMG_W, IMG_H, previewFor, previewTags, injectPreview, START, END };
