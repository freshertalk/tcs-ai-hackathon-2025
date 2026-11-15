"use strict";
// TradeAI's router: which way a question goes, decided by its words — no model is asked.
//
//   instant  the question only wants the desk's own data (positions, today's P&L against the daily
//            goal, margin, a price, the option chain, the intraday plan, orders, alerts): it is
//            answered at once from that data, in a table, with no model at all
//   fast     a light question: ONE model — the fastest free one by its measured speed — answers;
//            only if it fails is the next one asked
//   advice   a question of judgement (should I…, why…, will…, a forecast, news, a plan): ONE model —
//            the paid lead when it is allowed, for the best advice; else the strongest free model
//   deep     asked for depth (research, compare, review, the week ahead): the free models answer
//            together and the paid lead (when allowed) merges them into one — paid and free in combination
//
// The trader can also pick: Fast (instant or one fast model), Deep (always the combination) or Auto.
// Also here: the instant answers themselves, written from the data as Markdown.

const MODES = ["auto", "fast", "deep"];

const JUDGE = /\b(should|shall|would|could|why|will|predict|forecast|expect|outlook|advice|advise|suggest|recommend|best|worst|which|worth|explain|analy[sz]e|analysis|compare|strategy|risk|risky|safe|good time|enter|entry|exit|book|hold|average|averaging|trail|stop.?loss|tomorrow|next week|next month|news|reason|opinion|think|idea|setup|swing|long.?term|target for|buy|sell|short|go long|fix|mistake|improve|wrong|right)\b/;
const DEEP = /\b(deep|detailed|in.?depth|research|full analysis|compare|comparison|every stock|week ahead|next week|portfolio review|review (my|all)|all my (stocks|positions|trades)|thorough)\b/;

const INTENTS = [
  ["goal", /\b((daily|today'?s|my) (target|goal|stop)|how am i doing|how is my day|(my )?(p&l|pnl|profit|loss) today|today'?s (p&l|pnl|profit|loss)|giving back|given back)\b/],
  ["positions", /\b((my|open) positions?|positions? (now|today)|what do i (hold|have)|my holdings?|my portfolio)\b/],
  ["funds", /\b(margin|funds|available (cash|balance)|buying power|how much (cash|money) (do )?i have)\b/],
  ["orders", /\b((my|pending|open) orders?|orders? (pending|open|today))\b/],
  ["alerts", /\b(my (price )?alerts?|alerts? (set|waiting))\b/],
  ["global", /\b(gift ?nifty|sgx ?nifty|global (markets?|cues?)|world markets?|overseas|us markets?|wall street|dow jones|s&p ?500|nasdaq|nikkei|japan(ese)? markets?|singapore markets?|straits times|hang seng|asian? markets?|europe(an)? markets?|dax|ftse|how will (the )?(market|nifty) open|(market|nifty) open(ing)? (tomorrow|today)|pre.?open|pre.?market)\b/],
  ["options", /\b(option.?chain|options? (data|chain|oi)|pcr|put.?call ratio|max.?pain|open interest|call wall|put wall)\b/],
  ["plan", /\b(intraday plan|plan for|trade plan|trading plan|intraday (setup|levels)|levels for)\b/],
  ["quote", /\b(price|ltp|quote|rate|trading at|how much is)\b/],
];

/**
 * @param question the trader's words
 * @param symbols  the stocks the question names (from the plan)
 * @param mode     "auto" | "fast" | "deep"
 * @returns { tier, intent, why }
 */
function classify(question, { symbols = [], mode = "auto" } = {}) {
  const q = ` ${String(question || "").toLowerCase().replace(/\s+/g, " ")} `;
  const m = MODES.includes(mode) ? mode : "auto";
  let intent = null;
  for (const [id, re] of INTENTS) {
    if (!re.test(q)) continue;
    if ((id === "quote" || id === "plan") && !symbols.length) continue; // a price or a plan of what?
    intent = id;
    break;
  }
  const judge = JUDGE.test(q);
  if (m === "deep") return { tier: "deep", intent, why: "Deep was chosen: the free models answer together and the paid lead merges them." };
  // a plan or the option chain is the desk's own analysis: shown at once even when phrased as "should"
  const analytic = intent === "plan" || intent === "options" || intent === "global";
  if (intent && (!judge || analytic || m === "fast") && !(DEEP.test(q) && m === "auto")) return { tier: "instant", intent, why: "The desk's own data answers this — no model needed." };
  if (m === "fast") return { tier: "fast", intent, why: "Fast was chosen: one model, the quickest." };
  if (DEEP.test(q)) return { tier: "deep", intent, why: "A question for depth: the free models answer together and the paid lead merges them." };
  if (judge) return { tier: "advice", intent, why: "A question of judgement: one model — the paid lead when allowed — for the best advice." };
  return { tier: "fast", intent, why: "A light question: one model, the quickest." };
}

/* ------------------------------------------------------------------- the instant answers */
const num = (x) => typeof x === "number" && Number.isFinite(x);
const rs = (x, d = 2) => (num(x) ? `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}` : "—");
const rs0 = (x) => rs(x, 0);
const signed = (x, d = 0) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${rs(Math.abs(x), d)}` : "—");
const pc = (x) => (num(x) ? `${x > 0 ? "+" : ""}${x.toFixed(2)}%` : "—");
const reply = (answer, extra = {}) => ({ answer, datapoints: [], actions: [], forecast: { lean: "n/a", horizon: "", scenarios: [] }, confidence: "high", followups: [], ...extra });

function goalLine(g) {
  if (!g || !g.available || !g.enabled) return "";
  return `**Daily goal:** today ${signed(g.pnl)} of the ${rs0(g.target)} target (${g.progressPct}%), daily stop ${rs0(g.stop)}${g.peak > 0 ? `, best today ${signed(g.peak)}` : ""}. ${g.state === "ok" ? "" : `**${g.title}.** ${g.action}`}`;
}

/** The instant answer for an intent, from the gathered data — or null when the data is not there. */
function instantAnswer(intent, d, { symbol = "" } = {}) {
  if (intent === "goal") {
    const g = d.goal;
    if (!g || !g.available) return null;
    const lines = [
      `${g.state === "target-hit" ? "🎯 " : g.level === "danger" ? "🛑 " : g.level === "warning" ? "⚠️ " : ""}**${g.title}.** ${g.text}`,
      "",
      `| Today | Target | Daily stop | Best today | Keep at least |`,
      `|---|---|---|---|---|`,
      `| **${signed(g.pnl)}** | ${rs0(g.target)} (${g.config.targetPct}%) | ${rs0(g.stop)} (${g.config.stopPct}%) | ${signed(g.peak)} | ${g.floor ? rs0(g.floor) : "—"} |`,
      "",
      `**What to do:** ${g.action}`,
    ];
    for (const p of g.positions || []) lines.push(`- ${p.text}`);
    lines.push("", `_Target and stop are ${g.config.targetPct}% and ${g.config.stopPct}% of ${rs0(g.base)}, your available margin at the open._`);
    return reply(lines.join("\n"), { actions: g.state === "ok" ? [] : [{ kind: "corrective", text: g.action }], followups: ["Which of my positions should I book first?", "Where should I trail my stops now?"] });
  }
  if (intent === "positions") {
    if (!Array.isArray(d.positions)) return null;
    if (!d.positions.length) return reply(`You have **no open positions** right now.${d.goal ? `\n\n${goalLine(d.goal)}` : ""}`, { followups: ["Which watchlist stocks look best now?", "What does the market look like?"] });
    const tot = d.positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const rows = d.positions.map((p) => `| ${p.symbol} | ${p.side} | ${Math.abs(p.quantity)} | ${rs(p.average)} | ${rs(p.last)} | ${signed(p.pnl)} |`);
    const worst = d.positions.slice().sort((a, b) => (a.pnl || 0) - (b.pnl || 0))[0];
    return reply(
      [`You have **${d.positions.length} open position${d.positions.length === 1 ? "" : "s"}**, ${signed(tot)} in all.`, "", "| Stock | Side | Qty | Avg | Last | P&L |", "|---|---|---|---|---|---|", ...rows, "", d.goal ? goalLine(d.goal) : ""].join("\n"),
      { followups: [`What should I do with my ${worst.symbol} ${worst.side}?`, "Which of my positions is the riskiest right now?", "Where should I trail my stops?"] },
    );
  }
  if (intent === "funds") {
    if (!d.funds) return null;
    const f = d.funds;
    return reply(`**Available margin:** ${rs0(f.available)}${f.used ? `\n\n| Used | |\n|---|---|\n${Object.entries(f.used).filter(([, v]) => num(v) && v !== 0).slice(0, 6).map(([k, v]) => `| ${k} | ${rs0(v)} |`).join("\n")}` : ""}${d.goal ? `\n\n${goalLine(d.goal)}` : ""}`, { followups: ["How much should I risk per trade?", "How are my open positions?"] });
  }
  if (intent === "orders") {
    if (!Array.isArray(d.orders)) return null;
    if (!d.orders.length) return reply("You have **no pending orders**.", { followups: ["How are my open positions?"] });
    return reply(["**Pending orders:**", "", "| Stock | Side | Qty | Price | Type |", "|---|---|---|---|---|", ...d.orders.slice(0, 12).map((o) => `| ${o.symbol} | ${o.side} | ${o.quantity} | ${rs(o.price)} | ${o.type} |`)].join("\n"), { followups: ["Should I keep these orders or cancel them?"] });
  }
  if (intent === "alerts") {
    if (!Array.isArray(d.alerts)) return null;
    if (!d.alerts.length) return reply("No price alerts are waiting.", { followups: ["Which levels should I set alerts at?"] });
    return reply(["**Price alerts waiting:**", "", "| Stock | When | Price | Note |", "|---|---|---|---|", ...d.alerts.map((a) => `| ${a.symbol} | ${a.dir} | ${rs(a.price)} | ${a.note || ""} |`)].join("\n"));
  }
  if (intent === "quote") {
    const s = d[`stock_${symbol}`];
    const q = s && s.quote;
    if (!q || !num(q.last)) return null;
    return reply(
      [`**${symbol}** is at **${rs(q.last)}** (${pc(q.changePct)} on the day).`, "", "| Open | High | Low | Prev close | VWAP | Buyers |", "|---|---|---|---|---|---|", `| ${rs(q.open)} | ${rs(q.high)} | ${rs(q.low)} | ${rs(q.prevClose)} | ${rs(q.vwap)} | ${num(q.buyersShare) ? `${q.buyersShare}%` : "—"} |`, "", q.upperCircuit ? `Circuit limits ${rs(q.lowerCircuit)} – ${rs(q.upperCircuit)}.` : ""].join("\n"),
      { followups: [`Should I buy ${symbol} now?`, `What is the intraday plan for ${symbol}?`, `Show the option chain of ${symbol}`] },
    );
  }
  if (intent === "options") {
    const c = d.options;
    if (!c) return null;
    if (!c.available) return reply(c.reason || "There is no option chain for that.", { confidence: "high" });
    const v = (c.bias.votes || []).map((x) => `- **${x.label}:** ${x.why}`);
    return reply(
      [
        `**Options on ${c.underlying}** (expiry ${c.expiry}, ${Math.round(c.daysToExpiry) < 1 ? "expires today" : `${Math.round(c.daysToExpiry)} days`}): **${c.bias.label}** (bias ${c.bias.score > 0 ? "+" : ""}${c.bias.score}).`,
        "",
        "| PCR (OI) | Max pain | Call wall | Put wall | ATM IV | Expected move |",
        "|---|---|---|---|---|---|",
        `| ${c.pcr ?? "—"} | ${rs0(c.maxPain)} | ${c.resistance ? rs0(c.resistance.strike) : "—"} | ${c.support ? rs0(c.support.strike) : "—"} | ${num(c.atmIv) ? `${c.atmIv}%` : "—"} | ±${rs(c.expectedMove && c.expectedMove.day)} a day |`,
        "",
        "### Why",
        ...v,
        ...(c.bias.cautions || []).map((x) => `- ⚠️ ${x}`),
        "",
        "_One factor among the desk's readings — not a call._",
      ].join("\n"),
      { followups: [`What is the intraday plan for ${c.underlying}?`, `Should I trade ${c.underlying} tomorrow?`] },
    );
  }
  if (intent === "global") {
    const f = d.forecast;
    if (!f) return null;
    if (!f.available) return reply(`No overseas reading is available right now. ${(f.cautions || []).join(" ")}`, { confidence: "high" });
    const lines = [`**${f.headline}** — for ${f.for}.`, ""];
    if (f.open && f.nifty) lines.push("| Nifty last close | Expected open | Range of the open | Gap |", "|---|---|---|---|", `| ${rs(f.nifty.prevClose)} | **${rs(f.open.expected)}** | ${rs(f.open.low)} – ${rs(f.open.high)} | ${pc(f.open.gapPct)} |`, "", `_${f.open.basis}_`, "");
    const mk = (f.markets || []).filter((m) => num(m.changePct) || m.flowCr);
    if (mk.length) {
      lines.push("### World markets", "", "| Region | Market | Last | Change | Status |", "|---|---|---|---|---|");
      for (const m of mk.slice(0, 16)) lines.push(`| ${m.region} | ${m.name} | ${typeof m.last === "number" ? Number(m.last).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : m.last || "—"} | ${num(m.changePct) ? pc(m.changePct) : m.flowCr ? `₹${Math.round(m.flowCr).toLocaleString("en-IN")} cr` : "—"} | ${m.session || m.asOf || m.source} |`);
      lines.push("");
    }
    lines.push("### Why", ...f.votes.slice(0, 8).map((v) => `- **${v.label}** (${v.vote > 0 ? "+" : ""}${v.vote}): ${v.why}`));
    if (f.measured && f.measured.us) lines.push("", `_Measured: the Nifty's opening gap moved ${f.measured.us.beta}× the S&P 500's previous session over ${f.measured.us.days} days${num(f.measured.us.followedPct) ? `; after a move of ${f.measured.us.minMove}% or more it opened the same way ${f.measured.us.followedPct}% of the time` : ""}._`);
    if (f.sectors && f.sectors.length) lines.push("", "### Sectors", ...f.sectors.slice(0, 6).map((x) => `- **${x.sector}** — ${x.bias}: ${x.why}`));
    if (f.news && f.news.headline) lines.push("", "### News", `- ${f.news.headline}`, ...(f.news.indiaRead ? [`- ${f.news.indiaRead}`] : []), ...(f.news.events || []).slice(0, 3).map((e) => `- 📅 ${e}`));
    for (const c of f.cautions || []) lines.push(`- ⚠️ ${c}`);
    lines.push("", "_A reading of the cues, not a promise._");
    return reply(lines.join("\n"), { forecast: { lean: f.lean.word === "up" ? "up" : f.lean.word === "down" ? "down" : "sideways", horizon: f.for, scenarios: [] }, followups: ["Which of my watchlist stocks gain most if the market opens like this?", "What could change this before the open?", "Show the option chain of NIFTY"] });
  }
  if (intent === "plan") {
    const p = d.plan;
    if (!p) return null;
    if (!p.available) return reply(p.reason || "There is no intraday plan for that.", { confidence: "high" });
    const dd = p.decision;
    const L = p.plans.long;
    const S = p.plans.short;
    return reply(
      [
        `**Intraday plan for ${p.symbol}** (${p.marketOpen ? "today's session, as planned before the open" : `next session, ${p.nextSession}`}): **${dd.headline}**`,
        "",
        `Because ${dd.why}.${num(dd.strength) ? ` Plan strength ${dd.strength}/100.` : ""}`,
        "",
        "| | Trigger | Stop | Target 1 | Target 2 |",
        "|---|---|---|---|---|",
        `| Long | above ${rs(L.entry)} | ${rs(L.stop)} | ${rs(L.targets[0])} | ${rs(L.targets[1])} |`,
        `| Short | below ${rs(S.entry)} | ${rs(S.stop)} | ${rs(S.targets[0])} | ${rs(S.targets[1])} |`,
        "",
        `**Expected open** ${rs(p.open.expected)} · **range** ${rs(p.range.low)} – ${rs(p.range.high)}`,
        "",
        "### For",
        ...(dd.for.length ? dd.for.map((x) => `- ${x}`) : ["- Nothing stands out."]),
        "### Against",
        ...(dd.against.length ? dd.against.map((x) => `- ${x}`) : ["- Nothing stands out."]),
        "### Before you trade it",
        ...dd.checklist.map((x, i) => `${i + 1}. ${x}`),
      ].join("\n"),
      { forecast: { lean: p.lean.chartBucket === "up" ? "up" : p.lean.chartBucket === "down" ? "down" : "sideways", horizon: "next session", scenarios: [] }, followups: [`Explain the ${p.symbol} plan in simple words`, `Show the option chain of ${p.symbol}`, `What could go wrong with this ${p.symbol} plan?`] },
    );
  }
  return null;
}

module.exports = { classify, instantAnswer, MODES, JUDGE, DEEP };
