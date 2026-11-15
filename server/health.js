"use strict";
// Site health: one look at every part of the site — is it working, switched off, or in trouble —
// with a plain sentence and what to do. Each check is independent and can never break the page:
// a check that throws is reported as an error, not as a crash.
//
// status: "ok" (working), "warn" (works, but look at it), "error" (not working), "off" (switched
// off or not set up — by choice).

const fs = require("node:fs");


const IST = 5.5 * 3600 * 1000;
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const ago = (iso, now) => {
  if (!iso) return "never";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

async function buildHealth(ctx, { secure = false, host = "" } = {}) {
  const now = ctx.now ? ctx.now() : Date.now();
  const out = [];
  const check = async (id, group, name, fn) => {
    try {
      const r = await fn();
      if (r) out.push({ id, group, name, ...r });
    } catch (err) {
      out.push({ id, group, name, status: "error", detail: `The check itself failed: ${err && err.message ? err.message : err}` });
    }
  };

  /* ---------------------------------------------------------------- the platform */
  await check("server", "Platform", "Server", () => {
    const m = process.memoryUsage();
    const up = process.uptime();
    const rss = Math.round(m.rss / 1048576);
    return { status: rss > 550 ? "warn" : "ok", detail: `Up ${up > 86400 ? `${Math.floor(up / 86400)} d ` : ""}${Math.floor((up % 86400) / 3600)} h ${Math.floor((up % 3600) / 60)} min · memory ${rss} MB${rss > 550 ? " (pm2 restarts it at 600 MB)" : ""} · Node ${process.versions.node}` };
  });
  await check("database", "Platform", "Database", () => {
    const docs = ctx.docs;
    const kind = docs && docs.kind === "mongodb" ? "MongoDB" : "files";
    const probe = { at: new Date(now).toISOString() };
    docs.write("health/probe.json", probe);
    const back = docs.read("health/probe.json", null);
    if (!back || back.at !== probe.at) return { status: "error", detail: `Writing and reading back a record (${kind}) failed.` };
    if (docs.lastError) return { status: "warn", detail: `${kind}: works now, but a write failed earlier — ${docs.lastError}` };
    return { status: "ok", detail: `${kind}: a record was written and read back just now.` };
  });
  await check("disk", "Platform", "Disk space", () => {
    if (!fs.statfsSync || !ctx.dataDir) return null;
    const s = fs.statfsSync(ctx.dataDir);
    const free = (s.bavail * s.bsize) / 1073741824;
    return { status: free < 0.2 ? "error" : free < 1 ? "warn" : "ok", detail: `${free.toFixed(1)} GB free where the data is kept.` };
  });
  await check("https", "Platform", "HTTPS and proxy", () => {
    const local = /^(localhost|127\.|\[?::1\]?)(:|$)/.test(host);
    if (local) return { status: "ok", detail: "Running locally (HTTPS is not needed here)." };
    return secure ? { status: "ok", detail: "The app sees HTTPS: secure cookies and HSTS are on." } : { status: "warn", detail: "The app does not see HTTPS, so cookies lack the Secure flag and HSTS is not sent.", hint: "Check TRUST_PROXY in deploy/ecosystem.config.cjs and that nginx sends X-Forwarded-Proto." };
  });
  await check("signin", "Platform", "Google sign-in", () => (ctx.googleConfigured() ? { status: "ok", detail: "Set up." } : { status: "error", detail: "Not set up: nobody can sign in.", hint: "Open Google sign-in under Settings." }));

  /* ---------------------------------------------------------------- market data */
  const market = ctx.market;
  await check("zerodha", "Market data", "Zerodha connection", () => {
    const st = market.status();
    if (st.mode === "kite") return { status: "ok", detail: `Connected${st.kite && st.kite.user ? ` as ${st.kite.user}` : ""} until ${st.kite && st.kite.expiresAt ? new Date(st.kite.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "6 AM"}.` };
    if (st.mode === "demo") return { status: "warn", detail: "Demo data is on: no real prices.", hint: "Log in to Kite on the Desk." };
    if (st.kite && st.kite.configured) return { status: "warn", detail: "Set up but not logged in today (the session ends at 6 AM every day).", hint: "Press Log in to Kite on the Desk." };
    return { status: "off", detail: "Not set up.", hint: "Zerodha setup on the Desk." };
  });
  await check("stream", "Market data", "Live price stream", () => {
    const t = market.ticker;
    if (!t) return { status: "off", detail: "Not used on this server." };
    const s = t.state;
    if (s === "live") return { status: "ok", detail: "Ticks are streaming." };
    if (s === "idle" || s === "off") return { status: market.mode() === "kite" ? "ok" : "off", detail: s === "idle" ? "Ready; it connects when a page asks for prices." : "Waiting for a Zerodha session." };
    if (s === "connecting") return { status: "ok", detail: "Connecting…" };
    if (s === "denied") return { status: "error", detail: "Zerodha refused the stream: the session has expired or was closed.", hint: "Log in to Kite again." };
    return { status: "warn", detail: "The stream dropped and is reconnecting by itself." };
  });
  await check("universe", "Market data", "Screener history (Nifty 500)", () => {
    const st = market.screenerStatus ? market.screenerStatus() : null;
    const u = st && (st.universe || st);
    if (!u || !u.ready) return { status: "warn", detail: "Not downloaded yet: the RSI search and the custom scanner need it.", hint: "Screener → Download the Nifty 500." };
    if (u.job && u.job.running) return { status: "ok", detail: `Downloading: ${u.job.done} of ${u.job.total}.` };
    const days = u.through ? Math.round((Date.parse(istDate(now)) - Date.parse(u.through)) / 86400000) : 99;
    return { status: days > 4 ? "warn" : "ok", detail: `${u.symbols} stocks, daily closes to ${u.through || "?"}.${days > 4 ? " It rolls forward with each quote; open the Screener once while connected." : ""}` };
  });
  await check("alerts", "Market data", "Price alerts (server watch)", () => {
    const w = ctx.alertWatch ? ctx.alertWatch.status() : null;
    if (!w) return { status: "off", detail: "Not running on this server." };
    const waiting = market.alerts().alerts.filter((a) => !a.firedAt).length;
    if (!w.running) return { status: "warn", detail: `The watcher is stopped; ${waiting} alert(s) waiting are checked only while a terminal is open.` };
    if (w.error) return { status: "warn", detail: `Last look ${ago(w.at, now)} failed: ${w.error}` };
    return { status: "ok", detail: `${waiting} waiting · checked every 15 s in market hours${w.at ? ` · last look ${ago(w.at, now)}` : ""}.` };
  });
  await check("holidays", "Market data", "Holiday calendars", () => {
    const n = ctx.holidays ? ctx.holidays.snapshot().nasdaq : null;
    const india = "NSE/BSE list is checked by hand (2026)";
    if (!n) return { status: "ok", detail: india };
    if (n.lastError) return { status: "warn", detail: `NASDAQ: the last check failed (${n.lastError}); the last good copy is kept. ${india}.` };
    return { status: "ok", detail: `NASDAQ checked ${ago(n.lastSuccessAt, now)}. ${india}; add 2027 in December.` };
  });

  /* ---------------------------------------------------------------- AI */
  const ai = ctx.ai;
  await check("ai", "AI", "AI company in use", () => {
    const st = ai.status();
    if (!st.configured) return { status: "off", detail: "No key for the company in use: AI features are idle (everything else works).", hint: "AI settings." };
    const t = st.lastTest;
    if (t && t.ok === false) return { status: "error", detail: `${st.providerName} · ${st.modelName || st.model}: the last key test failed — ${t.message}`, hint: "AI settings → Test." };
    return { status: "ok", detail: `${st.providerName} · ${st.modelName || st.model}${t && t.at ? ` · key tested ${ago(t.at, now)}` : ""}.` };
  });
  await check("free", "AI", "Free NVIDIA models", () => {
    const r = ai.ensemble.roster();
    const cat = ai.ensemble.status().catalogue;
    if (!cat.some((m) => m.ready)) return { status: "off", detail: "No NVIDIA key saved: AI Live / AI Research, the AI team, TradeAI and WhatsApp summaries use the desk's arithmetic only.", hint: "AI settings → FREE → NVIDIA key." };
    return { status: r.free.length ? "ok" : "warn", detail: `${r.free.length} of ${cat.length} free models on${r.lead ? ` · paid lead ${r.lead.name}` : " · no paid lead"}.` };
  });
  await check("brains", "AI", "AI brains", () => {
    const l = ai.brains.list();
    const on = l.brains.filter((b) => b.enabled !== false).length;
    return { status: "ok", detail: `${on} on, ${l.brains.length - on} off · added automatically to the features in their scope.` };
  });
  await check("research", "AI", "Automatic research (8:45 & 4:00)", () => {
    const s = ctx.researchAuto.status();
    if (!s.enabled) return { status: "off", detail: "Switched off." };
    const last = (s.history || [])[0];
    return { status: "ok", detail: `On${s.withAi ? ", with AI notes" : ", data only"}${last ? ` · last run ${ago(last.at || last.finishedAt || last.startedAt, now)}` : ""}.` };
  });

  /* ---------------------------------------------------------------- trading and records */
  await check("trading", "Trading", "Trading switch and risk guard", () => {
    const st = ctx.trading.status();
    const lock = st.riskLock && st.riskLock.day === istDate(now) ? st.riskLock : null;
    if (lock) return { status: "warn", detail: `Trading ${st.enabled ? "ON" : "OFF"} · the risk guard locked today: ${lock.reason}` };
    return { status: "ok", detail: `Trading ${st.enabled ? "ON" : "OFF"} · risk guard ${st.risk && st.risk.enabled ? "on" : "off"}.` };
  });
  await check("analysis", "Trading", "Trade Analysis (3:45 PM)", () => {
    const s = ctx.analysis.settings();
    if (!s.auto) return { status: "off", detail: "Auto-save is switched off." };
    return { status: "ok", detail: `Auto-save on${s.withAi ? ", with the AI write-up" : ""}${s.lastAuto ? ` · last ${s.lastAuto}` : ""}.` };
  });
  await check("paper", "Trading", "Paper trading", () => {
    const s = ctx.paper.status();
    return { status: s.auto ? "ok" : "off", detail: s.auto ? `Auto mode on since ${ago(s.autoSince, now)}.` : "Auto mode is off (start it in Paper when you want)." };
  });

  /* ---------------------------------------------------------------- messages */
  await check("telegram", "Messages", "Telegram", () => {
    const s = ctx.notifier.status();
    if (!s.configured) return { status: "off", detail: "Not set up." };
    if (s.lastError) return { status: "warn", detail: `Set up, but the last message failed: ${s.lastError}` };
    return { status: "ok", detail: `Set up${s.lastSent ? ` · last message ${ago(s.lastSent, now)}` : " · nothing sent yet"}.` };
  });
  if (ctx.whatsapp) {
    await check("whatsapp", "Messages", "WhatsApp Trading", () => {
      const s = ctx.whatsapp.status();
      if (!s.configured) return { status: "off", detail: "Not set up." };
      if (!s.enabled) return { status: "off", detail: "Set up, switched off." };
      if (s.lastError) return { status: "warn", detail: `On, but the last message failed: ${s.lastError}` };
      return { status: "ok", detail: `On · updates every ${s.every} min in market hours${s.lastSent ? ` · last sent ${ago(s.lastSent, now)}` : ""}${s.lastReceived ? ` · last command ${ago(s.lastReceived, now)}` : ""}.` };
    });
  }

  /* ---------------------------------------------------------------- the Mandir */
  await check("mandir", "Mandir", "Shri Hanuman Chalisa audio", () => {
    const s = ctx.temple.settings();
    if (s.missing) return { status: "warn", detail: "An uploaded file is missing from this server and was left out of the list.", hint: "Upload it again in the Mandir card." };
    if (s.source.kind === "youtube") return { status: "warn", detail: "Only a YouTube link is set: it cannot play as background audio.", hint: "Add audio or video files in the Mandir card." };
    const n = (s.library || []).length;
    const what = s.source.kind === "library" ? `${n} uploaded file${n === 1 ? "" : "s"}${n > 1 ? (s.auto ? " · Auto: one after another" : " · Auto off: one repeats") : ""}` : `${s.source.label} · audio link`;
    return { status: "ok", detail: `${what} · volume ${Math.round(s.volume * 100)}%${s.autoplay ? " · starts by itself" : ""}.` };
  });

  const rank = { error: 3, warn: 2, ok: 1, off: 0 };
  const worst = out.reduce((w, c) => (rank[c.status] > rank[w] ? c.status : w), "ok");
  return {
    at: new Date(now).toISOString(),
    overall: worst === "off" ? "ok" : worst,
    counts: { ok: out.filter((c) => c.status === "ok").length, warn: out.filter((c) => c.status === "warn").length, error: out.filter((c) => c.status === "error").length, off: out.filter((c) => c.status === "off").length },
    checks: out,
  };
}

module.exports = { buildHealth, ago };

