"use strict";
// TradeAI's router: which way a question goes, decided by its words — no model is asked.
//
//   instant  the question only wants the desk's own data (positions, today's P&L against the daily
//            goal, margin, a price, the option chain, the intraday plan, orders, alerts): it is
//            answered at once from that data, in a table, with no model at all
//   fast     a light question: the default model answers briefly (less data, a short answer)
//   advice   a question of judgement (should I…, why…, will…, a forecast, news, a plan): the default
//            model answers with the full data
//   deep     asked for depth (research, compare, review, the week ahead): the default model thinks
//            longer (a higher effort) over the full data and writes a longer answer
// In every tier the default model (Claude Sonnet 5.5 unless the owner picked another on the AI page)
// answers; only if it fails are the AI page's fallback models asked, one at a time.
//
// The trader can also pick: Fast (instant or a brief answer), Deep (always the long one) or Auto.
// Also here: the instant answers themselves, written from the data as Markdown.

const MODES = ["auto", "fast", "deep"];

const JUDGE = /\b(should|shall|would|could|why|will|predict|forecast|expect|outlook|advice|advise|suggest|recommend|best|worst|which|worth|explain|analy[sz]e|analysis|compare|strategy|risk|risky|safe|good time|enter|entry|exit|book|hold|average|averaging|trail|stop.?loss|tomorrow|next week|next month|news|reason|opinion|think|idea|setup|swing|long.?term|target for|buy|sell|short|go long|fix|mistake|improve|wrong|right)\b/;
const STRONG = /\b(why|should|shall|would|could|recommend|advi[sc]e|suggest|buy|sell|short|hold|exit|enter|entry|book|average|trail|strategy|reason|explain|predict|forecast|will)\b/;
const DEEP = /\b(deep|detailed|in.?depth|research|full analysis|compare|comparison|every stock|week ahead|next week|portfolio review|review (my|all)|all my (stocks|positions|trades)|thorough)\b/;

const INTENTS = [
  // managing an open position: answered at once from the exit coach's live reading (tradeai.js seeds it)
  ["exit", /\b(when (should|do|can|to) (i )?(exit|sell|book|close|get out|square off|cover)|where (should|do|can|to) (i )?(exit|book|sell|cover|trail|put (my|the) stop)|should i (exit|book|hold|close|sell|cover|keep holding|stay in|get out)|(exit|booking) (price|level|point|plan)|best (price|time|level) to (exit|sell|book|cover)|trail(ing)? (my |the )?stop|(stop|target) for my|what (do i|should i|to) do with my|manage my (position|trade)s?)\b/],
  ["goal",/\b((daily|today'?s|my) (target|goal|stop)|how am i doing|how is my day|(my )?(p&l|pnl|profit|loss) today|today'?s (p&l|pnl|profit|loss)|giving back|given back)\b/],
  ["positions", /\b((my|open) positions?|positions? (now|today)|what do i (hold|have)|my holdings?|my portfolio)\b/],
  ["funds", /\b(margin|funds|available (cash|balance)|buying power|how much (cash|money) (do )?i have)\b/],
  ["orders", /\b((my|pending|open) orders?|orders? (pending|open|today))\b/],
  ["alerts", /\b(my (price )?alerts?|alerts? (set|waiting))\b/],
  ["social", /\b(latest (news|headlines|tweets?|posts?)|(market|stock) news (now|today)|what'?s (the )?(news|buzz)|news (feed|now|today)|any news|tweets?|trending (stocks?|now)|most talked|social (media|feed|mood|sentiment)|news (mood|sentiment))\b/],
  ["global", /\b(gift ?nifty|sgx ?nifty|global (markets?|cues?)|world markets?|overseas|us markets?|wall street|dow jones|s&p ?500|nasdaq|nikkei|japan(ese)? markets?|singapore markets?|straits times|hang seng|asian? markets?|europe(an)? markets?|dax|ftse|how will (the )?(market|nifty) open|(market|nifty) open(ing)? (tomorrow|today)|pre.?open|pre.?market)\b/],
  ["options", /\b(option.?chain|options? (data|chain|oi)|pcr|put.?call ratio|max.?pain|open interest|call wall|put wall)\b/],
  ["plan", /\b(intraday plan|plan for|trade plan|trading plan|intraday (setup|levels))\b/],
  ["levels", /\b(support|resistance|supports|resistances|key levels|levels (of|for|in|on)|pivot( points?|s)?)\b/],
  ["outlook", /\b(outlook|next session|next trading (day|session))\b/],
  ["call", /\b(live call|desk'?s (call|view|signal)|signal (on|for)|what does the desk say|technicals?|indicators?|rsi|vwap|macd|adx|supertrend)\b/],
  ["pnl", /\b(how did i do|my (p&l|pnl|results?|performance|win rate)( this| last| for)?|(this|last) (week|month)'?s? (p&l|pnl|results?)|last (7|30) days|journal (stats|summary))\b/],
  ["market", /\b(how is the market|how'?s the market|market (today|now|mood|breadth)|nifty (today|now)|sectors? (today|now|leading|lagging|performance)|which sectors?|leading sectors?|lagging sectors?|market tide)\b/],
  ["quote", /\b(price|ltp|quote|rate|trading at|how much is)\b/],
];
const NEEDS_SYMBOL = new Set(["quote", "plan", "levels", "outlook", "call"]);

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
    if (NEEDS_SYMBOL.has(id) && !symbols.length) continue; // a price, a plan, levels of what?
    intent = id;
    break;
  }
  const judge = JUDGE.test(q);
  if (m === "deep") return { tier: "deep", intent, why: "Deep was chosen: the default model thinks longer and writes a fuller answer." };
  // a plan or the option chain is the desk's own analysis: shown at once even when phrased as "should"
  // the desk's own analysis is shown at once even when phrased as "should"; readings of the market,
  // a stock's indicators or your results too, unless the question asks for a judgement (why, should…)
  const analytic = ["exit", "plan", "options", "global", "social", "levels", "outlook"].includes(intent) || (["market", "call", "pnl"].includes(intent) && !STRONG.test(q));
  if (intent && (!judge || analytic || m === "fast") && !(DEEP.test(q) && m === "auto")) return { tier: "instant", intent, why: "The desk's own data answers this — no model needed." };
  if (m === "fast") return { tier: "fast", intent, why: "Fast was chosen: a brief answer from the default model." };
  if (DEEP.test(q)) return { tier: "deep", intent, why: "A question for depth: the default model thinks longer and writes a fuller answer." };
  if (judge) return { tier: "advice", intent, why: "A question of judgement: the default model, with the full data." };
  return { tier: "fast", intent, why: "A light question: a brief answer from the default model." };
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
  if (intent === "exit") {
    // the exit coach's live reading of each open position the question is about (DATA.position_SYMBOL)
    const all = Object.keys(d)
      .filter((k) => k.startsWith("position_"))
      .map((k) => d[k])
      .filter((p) => p && p.coach && p.numbers);
    const list = symbol && all.some((p) => p.symbol === symbol) ? all.filter((p) => p.symbol === symbol) : all;
    if (!list.length) return null;
    const lines = [];
    for (const p of list) {
      const c = p.coach;
      const n = p.numbers;
      const mark = c.state === "exit-now" ? "🛑 " : c.state === "book-part" ? "◆ " : c.state === "tighten" ? "▲ " : "";
      if (list.length > 1) lines.push(`### ${p.symbol}`);
      lines.push(`${mark}**${p.symbol} ${p.side} ${p.qty} @ ${rs(p.avg)} — ${c.word}** · exit pressure ${c.pressure}/100`);
      lines.push(`Now **${rs(n.last)}**: **${signed(n.pnl)}** (${pc(n.gainPct)})${n.best ? `, best ${signed(n.best.pnl)} at ${n.best.clock}` : ""}${num(n.givenBackPct) ? `, ${n.givenBackPct}% given back` : ""} · ${n.minutesIn} min in${num(n.minutesToSquareOff) && n.minutesToSquareOff > 0 ? `, ${n.minutesToSquareOff} to the 3:15 square-off` : ""}.`);
      lines.push("", "| | Price | Note |", "|---|---|---|");
      const first = c.state === "exit-now" ? "Exit now at" : c.state === "book-part" ? `Book ${c.exit.qty} at` : "Take profit at";
      lines.push(`| **${first}** | **${rs(c.exit.price)}** | ${String(c.exit.note || "").replace(/\|/g, "/")} |`);
      lines.push(`| **Stop** | **${rs(c.stop)}** | ${c.stopKind} — only ever moved towards the price |`);
      if (c.state !== "exit-now") lines.push(`| Next target | ${rs(c.target)} | ${pc(((c.target - n.last) / n.last) * 100)} from here |`);
      const lv = p.aiLevels;
      for (const t of (lv && lv.targets) || []) {
        const rec = t.held ? ` · levels like it held ${t.held.pct}% of ${t.held.n} tests` : "";
        lines.push(`| AI target ${t.n} | ${rs(t.level)} | ${t.label}${t.status === "reached" ? " — **reached**" : ` · limit ${rs(t.limit)}${num(t.r) ? ` · ${t.r}R` : ""}${num(t.reachPct) ? ` · reach ${t.reachPct}%` : ""}`}${rec} |`);
      }
      lines.push("");
      if (c.whyLeave.length) lines.push(`**Why leave:** ${c.whyLeave.slice(0, 3).join(" ")}`);
      if (c.whyStay.length) lines.push(`**Why stay:** ${c.whyStay.slice(0, 3).join(" ")}`);
      if (!c.whyLeave.length && !c.whyStay.length) lines.push("Nothing is pressing against the position, and nothing on the tape argues for more.");
      const ob = n.orderBook;
      if (ob) lines.push(`**Order book:** buyers ${ob.buyersPct}% of the five best levels · ${ob.label}${ob.lean && !/none|learning/.test(ob.lean) ? ` · next 30 seconds leans ${String(ob.lean).toUpperCase()}` : ""}.`);
      if (lv && lv.turn) lines.push(`**Watch for a turn at ${rs(lv.turn.price)}** (${lv.turn.label})${lv.turn.sign ? `: ${lv.turn.sign}` : "."}`);
      if (lv && lv.summary) lines.push(`_AI levels (${lv.by}, ${lv.at}; ${lv.passed} of its choices passed the desk's check):_ ${lv.summary}`);
      if (p.aiOpinion) lines.push(`_AI's second opinion (${p.aiOpinion.by}, ${p.aiOpinion.at}):_ ${String(p.aiOpinion.action).replace("-", " ").toUpperCase()} — ${p.aiOpinion.reason}`);
      lines.push("");
    }
    if (d.goal && d.goal.available && d.goal.enabled) lines.push(goalLine(d.goal), "");
    lines.push("_The exit coach's live reading — arithmetic on the tape, the order book, the levels and the forecasts — with the AI's levels the desk has checked. A reading with its reasons, not a promise; nothing is traded by itself._");
    const p0 = list[0];
    return reply(lines.join("\n"), {
      datapoints: list.slice(0, 4).map((p) => ({ label: `${p.symbol} ${p.coach.word}`, value: `exit ${rs(p.coach.exit.price)} · stop ${rs(p.coach.stop)}` })),
      actions: list.slice(0, 4).map((p) => ({ kind: p.coach.state === "hold" ? "watch" : "corrective", text: p.coach.headline })),
      followups: [`Give me the AI's second opinion on my ${p0.symbol} ${p0.side}`, `What do the order book and volume say about ${p0.symbol} now?`, `Why would ${p0.symbol} reverse from here?`, list.length > 1 ? "Which of my positions is the riskiest right now?" : "How am I doing against my daily goal?"],
    });
  }
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
  if (intent === "social") {
    const x = d.social;
    if (!x) return null;
    const sig = x.signal;
    if (!sig && !(x.latest || []).length && !(x.stocks || []).length) return reply("The Social Media feed has nothing market-related in the last six hours yet. Add or switch on sources on the Social Media page.", { confidence: "high" });
    const tone = (v) => (v >= 0.2 ? "🟢 bullish" : v <= -0.2 ? "🔴 bearish" : "⚪ mixed");
    const when = (t) => (t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
    const lines = [];
    if (sig) lines.push(`**News & social mood (last 6 hours): ${sig.mood.label} (${sig.mood.score > 0 ? "+" : ""}${sig.mood.score})** across ${sig.items} market items${sig.aiRead ? `, ${sig.aiRead} read by the AI` : ""}.`, "");
    if (sig && sig.brief && sig.brief.headline) lines.push(`> ${sig.brief.headline}`, "");
    for (const st of x.stocks || []) {
      lines.push(`### ${st.symbol} — ${st.mentions} item${st.mentions === 1 ? "" : "s"}, ${tone(st.sentiment)}`);
      for (const it of st.items.slice(0, 4)) lines.push(`- ${when(it.at)} · ${it.source}: ${it.summary || it.title}${it.impact === "high" ? " **(high impact)**" : ""}`);
      lines.push("");
    }
    if (sig && sig.stocks && sig.stocks.length) {
      lines.push("### Most talked about", "", "| Stock | Mentions | Tone | Latest |", "|---|---|---|---|");
      for (const r of sig.stocks.slice(0, 6)) lines.push(`| ${r.symbol} | ${r.mentions} | ${tone(r.sentiment)} | ${String(r.headline || "").slice(0, 70)} |`);
      lines.push("");
    }
    if ((x.latest || []).length) {
      lines.push("### Latest market items");
      for (const it of x.latest.slice(0, 6)) lines.push(`- ${when(it.at)} · ${it.source}: ${it.summary || it.title}${it.stocks && it.stocks.length ? ` _(${it.stocks.join(", ")})_` : ""}`);
    }
    lines.push("", "_Headlines and posts as published; social posts are unverified. One input among the desk's readings — not a call._");
    return reply(lines.join("\n"), { followups: [(x.stocks[0] && `Should I trade ${x.stocks[0].symbol} on this news?`) || "Which sectors are in the news today?", "How will the market open tomorrow?", "Show my positions"] });
  }
  const st = symbol ? d[`stock_${symbol}`] : null;
  // the desk's data could not be read (Zerodha not connected, no history): say so at once — a model
  // given no data could only say the same, and would be paid for it
  const noData = (what, why) => reply(`No ${what} right now: ${why}`, { confidence: "high", followups: ["How is the market today?", "Show my positions"] });
  if (["levels", "call", "outlook"].includes(intent) && st && !st.levels && !st.daily && !st.liveCall && st.liveError) return noData(`reading for ${symbol}`, st.liveError);
  if (intent === "levels") {
    if (!st || !Array.isArray(st.levels) || !st.levels.length) return null;
    const last = st.quote && st.quote.last;
    const rows = st.levels.slice().sort((a, b) => b.price - a.price).slice(0, 12);
    const lines = [`**${symbol} — the levels that matter${num(last) ? ` around ${rs(last)}` : ""}.**`, "", "| Level | Price | Away |", "|---|---:|---:|"];
    for (const l of rows) lines.push(`| ${l.name}${num(last) ? (l.price > last ? " ▲" : " ▼") : ""} | ${rs(l.price)} | ${num(l.awayPct) ? pc(l.awayPct) : "—"} |`);
    const pv = st.outlook && st.outlook.pivots;
    if (pv && num(pv.p)) lines.push("", `_Next-session pivots: S2 ${rs(pv.s2)} · S1 ${rs(pv.s1)} · P ${rs(pv.p)} · R1 ${rs(pv.r1)} · R2 ${rs(pv.r2)}._`);
    lines.push("", "_From the desk's own ladder (prior highs and lows, VWAP, pivots, moving averages) — no model._");
    return reply(lines.join("\n"), { followups: [`What is the intraday plan for ${symbol}?`, `What does the desk's live call say on ${symbol}?`, `Should I buy ${symbol} near support?`] });
  }
  if (intent === "call") {
    if (!st || (!st.liveCall && !st.daily && !st.verdict)) return null;
    const lc = st.liveCall;
    const dl = st.daily;
    const v = st.verdict;
    const lines = [`**${symbol}${st.quote && num(st.quote.last) ? ` ${rs(st.quote.last)} (${pc(st.quote.changePct)})` : ""} — what the desk reads now.**`, ""];
    if (lc) lines.push(`- **Live call:** ${lc.headline || lc.state}${num(lc.score) ? ` — score ${lc.score}${num(lc.threshold) ? ` of ${lc.threshold} needed` : ""}` : ""}.`, `- **VWAP:** ${rs(lc.vwap)}${num(lc.vsVwapPct) ? ` (price ${pc(lc.vsVwapPct)} from it)` : ""} · **RSI 5-min:** ${num(lc.rsi5) ? Math.round(lc.rsi5) : "—"}`);
    if (lc && Array.isArray(lc.earlyWarnings) && lc.earlyWarnings.length) lines.push(`- **Early warnings:** ${lc.earlyWarnings.join("; ")}`);
    if (dl) lines.push(`- **Daily:** score ${dl.score ? `${dl.score.value} (${dl.score.label})` : "—"} · RSI 14 ${num(dl.rsi14) ? Math.round(dl.rsi14) : "—"} · MACD histogram ${num(dl.macdHist) ? dl.macdHist.toFixed(2) : "—"} · ADX ${num(dl.adx) ? Math.round(dl.adx) : "—"}${dl.supertrendDir ? ` · Supertrend ${dl.supertrendDir > 0 ? "up" : "down"}` : ""}`);
    if (v && v.stance) lines.push(`- **All timeframes:** ${v.stance}${v.convictionLabel ? ` (${v.convictionLabel})` : ""}${v.summary ? ` — ${v.summary}` : ""}`);
    if (st.odds && st.odds.graded && st.odds.graded.length) lines.push(`- **Measured odds:** ${st.odds.graded.map((g) => `${g.kind} ${g.side} grade ${g.grade}${num(g.winPct) ? ` (${g.winPct}% of ${g.trades})` : ""}`).join("; ")}`);
    lines.push("", "_The desk's own engines — no model. Ask “should I…” for a judgement._");
    return reply(lines.join("\n"), { followups: [`Should I buy ${symbol} now?`, `What are the key levels for ${symbol}?`, `What is the outlook for ${symbol} next session?`] });
  }
  if (intent === "outlook") {
    const o = st && st.outlook;
    if (!o) return null;
    const lines = [`**${symbol} — next session: ${o.headline || o.call || o.lean}.**`, "", `- **Lean:** ${o.lean}${num(o.score) ? ` (score ${o.score})` : ""}${num(o.agreement) ? `, ${o.agreement}% of the evidence agrees` : ""}`];
    if (o.range && num(o.range.low)) lines.push(`- **A normal day's range:** ${rs(o.range.low)} – ${rs(o.range.high)}`);
    if (o.pivots && num(o.pivots.p)) lines.push(`- **Pivots:** S1 ${rs(o.pivots.s1)} · P ${rs(o.pivots.p)} · R1 ${rs(o.pivots.r1)}`);
    if (Array.isArray(o.scenarios) && o.scenarios.length) lines.push("", "### Scenarios", ...o.scenarios.map((x) => `- ${typeof x === "string" ? x : x.text || x.if ? `${x.if || ""} → ${x.then || ""}` : JSON.stringify(x)}`));
    lines.push("", "_The desk's Next-Session Outlook (arithmetic) — not a promise. Ask Deep for the AI's reading._");
    return reply(lines.join("\n"), { forecast: { lean: o.lean === "up" || o.lean === "down" ? o.lean : "sideways", horizon: "next session", scenarios: [] }, followups: [`What is the intraday plan for ${symbol}?`, `What are the key levels for ${symbol}?`, `Deep research on ${symbol}`] });
  }
  if (intent === "market") {
    const mk = d.market;
    if (mk && mk.available === false) return noData("market reading", mk.reason || "the market data is not available.");
    if (!mk) return null;
    const lines = [];
    if (mk.tide) lines.push(`**The market now: ${mk.tide.label || ""}${num(mk.tide.score) ? ` (tide ${mk.tide.score})` : ""}.** ${mk.tide.summary || ""}`, "");
    if (mk.vix && num(mk.vix.last)) lines.push(`India VIX ${mk.vix.last.toFixed(2)}${num(mk.vix.changePct) ? ` (${pc(mk.vix.changePct)})` : ""}.`, "");
    const sec = (mk.sectors || []).filter((x) => num(x.changePct)).sort((a, b) => b.changePct - a.changePct);
    if (sec.length) {
      lines.push("| Sector | Change |", "|---|---:|");
      for (const x of [...sec.slice(0, 4), ...(sec.length > 8 ? sec.slice(-4) : sec.slice(4))]) lines.push(`| ${x.name}${x.changePct > 0 ? " ▲" : x.changePct < 0 ? " ▼" : ""} | ${pc(x.changePct)} |`);
    }
    for (const n of (mk.notes || []).slice(0, 3)) lines.push(`- ${n}`);
    if (!lines.length) return null;
    lines.push("", "_From the desk's market reading — no model._");
    return reply(lines.join("\n"), { followups: ["Why is the market moving today?", "How will the market open tomorrow?", "Show my positions"] });
  }
  if (intent === "pnl") {
    const h = d.pnl;
    if (!h || h.error || !h.last30) return null;
    const l = h.last30;
    if (!l.days) return reply("No saved Trade Analysis days in the last 30 days yet, so there are no results to show. They are saved from the 3:45 PM report or the Trade Analysis page.", { confidence: "high", followups: ["Show my positions", "How am I doing against my daily target?"] });
    const lines = [`**Last 30 days: net ${signed(l.net)}** over ${l.days} saved day${l.days === 1 ? "" : "s"} and ${l.trades || 0} trades (profit ${rs0(l.profit)}, loss ${rs0(Math.abs(l.loss || 0))}, charges ${rs0(l.charges)}).`, ""];
    if (Array.isArray(h.recentDays) && h.recentDays.length) {
      lines.push("| Day | Net | Trades |", "|---|---:|---:|");
      for (const x of h.recentDays.slice(0, 7)) lines.push(`| ${x.date} | ${signed(x.net)} | ${x.trades ?? "—"} |`);
      lines.push("");
    }
    const j = h.journal3m;
    if (j && j.trades) lines.push(`**Journal, 3 months:** ${j.trades} trades, win rate ${num(j.winRate) ? `${Math.round(j.winRate)}%` : "—"}, profit factor ${num(j.profitFactor) ? j.profitFactor.toFixed(2) : "—"}, expectancy ${signed(j.expectancy)}, deepest drawdown ${signed(j.maxDrawdown)}.`);
    lines.push("", "_From your saved Trade Analysis days and journal — no model._");
    return reply(lines.join("\n"), { followups: ["What are my biggest mistakes?", "Which hour of the day loses me most?", "How am I doing against my daily target?"] });
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
