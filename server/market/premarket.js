"use strict";
// The NSE forecast from the world: where the Nifty may open, and which way the day may lean — read
// from GIFT Nifty, the US, Europe, Japan, Singapore, Hong Kong, Korea and China, the rupee, crude, both
// VIXes, institutional flows, the Nifty's own option chain and the world-news brief.
//
//   before the open  (and after the close, for the next session): the expected opening gap — GIFT
//                    Nifty first, as it trades through the night; without it, the overseas closes times
//                    the Nifty's MEASURED sensitivity to them — and a lean for the day from every cue
//   in the session   GIFT Nifty only mirrors the Nifty now, so the lean for the rest of the day comes
//                    from the Nifty's own tide, Europe once it opens, US futures, Asia's close, the
//                    rupee, crude, VIX and the option chain
//
// Each cue votes −1…+1 with a fixed weight; the lean is the weighted sum and the agreement is how much
// of the weight sits on its side. Where the overseas history is there, the forecast also says how the
// Nifty's opens actually followed the S&P 500 — a count of the past, with how many days it rests on.
// No network, no clock, no order: the market service hands it the numbers. Not a promise; not advice.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pctOf = (txt) => {
  const m = /([+\-−]?\s*\d+(?:\.\d+)?)\s*%/.exec(String(txt || ""));
  return m ? Number(m[1].replace("−", "-").replace(/\s/g, "")) : null;
};
const crore = (txt) => {
  // "₹-1,234.5 crore", "net sold Rs 2,300 cr", "+850 cr"
  const s = String(txt || "").replace(/,/g, "");
  const m = /([+\-−]?\s*\d+(?:\.\d+)?)\s*(cr|crore)/i.exec(s);
  if (!m) return null;
  let v = Number(m[1].replace("−", "-").replace(/\s/g, ""));
  if (/sold|outflow|net seller|selling/i.test(s) && v > 0) v = -v;
  return v;
};

// names in the world brief → the desk's ids
const NAME_IDS = [
  [/futures/i, "usfut", (t) => /s&p|nasdaq|dow|us |u\.s\./i.test(t)],
  [/s&p\s*500/i, "spx"],
  [/nasdaq/i, "ixic"],
  [/dow/i, "dji"],
  [/nikkei/i, "n225"],
  [/hang\s*seng/i, "hsi"],
  [/straits|\bsti\b|singapore/i, "sti"],
  [/kospi/i, "kospi"],
  [/shanghai/i, "sse"],
  [/ftse/i, "ftse"],
  [/\bdax\b/i, "dax"],
  [/\bcac\b/i, "cac"],
  [/gift\s*nifty|sgx\s*nifty/i, "gift"],
  [/brent|crude/i, "crude"],
  [/dollar index|dxy/i, "dxy"],
  [/10.?year|treasury/i, "us10y"],
  [/\bfii\b|\bfpi\b|foreign (portfolio|institutional)/i, "fii"],
  [/\bdii\b|domestic institutional/i, "dii"],
  [/usd\s*\/?\s*inr|rupee/i, "usdinr"],
  [/\bvix\b/i, "vixw"],
];
function idOfCue(name) {
  for (const [re, id, extra] of NAME_IDS) if (re.test(name) && (!extra || extra(name))) return id;
  return null;
}
const REGION = { spx: "US", ixic: "US", dji: "US", usfut: "US", vix: "US", vixw: "US", ftse: "Europe", dax: "Europe", cac: "Europe", n225: "Japan", sti: "Singapore", hsi: "Hong Kong", kospi: "Korea", sse: "China", gift: "India (GIFT City)", crude: "Commodities", dxy: "Currency", us10y: "Rates", fii: "Flows", dii: "Flows", usdinr: "Currency" };

/**
 * How the Nifty's opening gaps followed an overseas index's previous session.
 * @param nifty daily bars { t, o, c } oldest first; us: [{ d, c }] oldest first
 */
function measureFollow(nifty, us, { minMove = 0.5 } = {}) {
  if (!Array.isArray(nifty) || !Array.isArray(us) || nifty.length < 60 || us.length < 60) return null;
  const xs = [];
  const ys = [];
  let j = 1;
  for (let i = 1; i < nifty.length; i += 1) {
    const t = nifty[i].t;
    while (j + 1 < us.length && us[j + 1].d < t) j += 1;
    if (!(us[j] && us[j].d < t && us[j - 1])) continue;
    const ret = (us[j].c / us[j - 1].c - 1) * 100;
    const gap = (nifty[i].o / nifty[i - 1].c - 1) * 100;
    if (num(ret) && num(gap)) {
      xs.push(ret);
      ys.push(gap);
    }
  }
  const last = xs.slice(-250);
  const lastY = ys.slice(-250);
  if (last.length < 40) return null;
  const mx = mean(last);
  const my = mean(lastY);
  const vx = last.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (!(vx > 0)) return null;
  const beta = last.reduce((s, x, i) => s + (x - mx) * (lastY[i] - my), 0) / vx;
  const ssTot = lastY.reduce((s, y) => s + (y - my) ** 2, 0);
  if (!(ssTot > 0)) return null; // gaps that never vary measure nothing
  const ssRes = lastY.reduce((s, y, i) => s + (y - (my + beta * (last[i] - mx))) ** 2, 0);
  const big = last.map((x, i) => [x, lastY[i]]).filter(([x]) => Math.abs(x) >= minMove);
  const followed = big.filter(([x, y]) => Math.sign(x) === Math.sign(y)).length;
  return { beta: r2(beta), r2: ssTot > 0 ? r2(1 - ssRes / ssTot) : null, days: last.length, bigDays: big.length, followedPct: big.length >= 10 ? Math.round((followed / big.length) * 100) : null, minMove };
}

/**
 * @param phase    "pre" | "open" | "post" | "closed" (the NSE session at `now`)
 * @param nifty    { prevClose, last, open, changePct } and `daily` bars
 * @param kite     the context's items by id: { gift, usdinr, crude, gold, vix } (Zerodha), and `tide`
 * @param global   the overseas feed's markets [{ id, name, region, last, changePct, prevClose, session, … }] or null
 * @param world    the world brief (web search by the paid model), or null
 * @param options  the Nifty's option chain read (options.js), or null
 * @param history  overseas daily closes { spx, ixic, dax, n225 } or null
 */
function buildMarketForecast({ phase = "pre", nifty = null, kite = {}, tide = null, global = null, world = null, options = null, history = null, nextSession = null } = {}) {
  // one table of every cue, the provider's numbers first, the world brief filling gaps
  const rows = new Map();
  const put = (id, row) => {
    if (!rows.has(id) || (!num(rows.get(id).changePct) && num(row.changePct))) rows.set(id, row);
  };
  for (const m of Array.isArray(global) ? global : []) if (m.available) put(m.id, { id: m.id, name: m.name, region: m.region, last: m.last, changePct: m.changePct, prevClose: m.prevClose, volume: m.volume, session: m.session, asOf: m.asOf, source: m.source || "FMP" });
  const kiteName = { gift: "GIFT Nifty", usdinr: "USD / INR", crude: "Crude oil (MCX)", gold: "Gold (MCX)", vix: "India VIX" };
  for (const [id, it] of Object.entries(kite || {})) if (it && it.available) put(id === "vix" ? "indiavix" : id, { id: id === "vix" ? "indiavix" : id, name: kiteName[id] || it.name, region: id === "gift" ? "India (GIFT City)" : id === "vix" ? "India" : REGION[id] || "India", last: it.last, changePct: it.changePct, session: null, asOf: null, source: "Zerodha" });
  const fresh = world && world.at ? world : null;
  for (const c of fresh ? fresh.cues || [] : []) {
    const id = idOfCue(c.name);
    if (!id) continue;
    const ch = id === "fii" || id === "dii" ? null : pctOf(c.change);
    put(id, { id, name: c.name, region: REGION[id] || "", last: c.value, changePct: ch, flowCr: id === "fii" || id === "dii" ? crore(`${c.value} ${c.change}`) : null, session: null, asOf: c.asOf, source: `web search (${new Date(fresh.at).toISOString().slice(11, 16)} UTC)` });
  }
  const ch = (id) => (rows.get(id) && num(rows.get(id).changePct) ? rows.get(id).changePct : null);
  const avg = (ids) => {
    const v = ids.map(ch).filter(num);
    return v.length ? mean(v) : null;
  };

  const live = phase === "open";
  const votes = [];
  const add = (id, label, weight, vote, why) => {
    if (num(vote)) votes.push({ id, label, weight, vote: r2(clamp(vote, -1, 1)), why });
  };
  const s = (x, d = 2) => `${x > 0 ? "+" : ""}${Number(x).toFixed(d)}%`;
  const gift = ch("gift");
  if (!live && num(gift)) add("gift", "GIFT Nifty (trades through the night)", 2.5, gift / 0.6, `GIFT Nifty ${s(gift)} from its last settlement — the closest thing to the Nifty overnight`);
  const us = avg(["spx", "ixic"]);
  const usState = rows.get("spx") && rows.get("spx").session;
  if (num(us)) add("us", usState === "live" ? "US markets (trading now)" : "US markets (last session)", live ? 0.8 : 1.5, us / 1.0, `S&P 500 ${num(ch("spx")) ? s(ch("spx")) : "—"}, Nasdaq ${num(ch("ixic")) ? s(ch("ixic")) : "—"}${usState === "live" ? " now" : " at the close"}`);
  if (num(ch("usfut"))) add("usfut", "US index futures (now)", 1.0, ch("usfut") / 0.5, `US futures ${s(ch("usfut"))} now`);
  const asiaIds = ["n225", "hsi", "sti", "kospi"].filter((id) => num(ch(id)));
  const asia = avg(asiaIds);
  if (num(asia)) add("asia", "Asia (Japan, Hong Kong, Singapore, Korea)", live ? 0.8 : 1.2, asia / 1.0, asiaIds.map((id) => `${rows.get(id).name} ${s(ch(id))}`).join(", "));
  const eu = avg(["ftse", "dax", "cac"]);
  const euLive = ["ftse", "dax", "cac"].some((id) => rows.get(id) && rows.get(id).session === "live");
  if (num(eu)) add("europe", euLive ? "Europe (trading now)" : "Europe (last session)", live && euLive ? 1.0 : 0.8, eu / 1.0, ["ftse", "dax", "cac"].filter((id) => num(ch(id))).map((id) => `${rows.get(id).name} ${s(ch(id))}`).join(", "));
  if (num(ch("vix"))) add("usvix", "US VIX", 0.5, -ch("vix") / 8, `US VIX ${s(ch("vix"))} — ${ch("vix") > 0 ? "more fear" : "calmer"}`);
  if (num(ch("crude"))) add("crude", "Crude oil", 0.6, -ch("crude") / 2, `crude ${s(ch("crude"))} — ${ch("crude") > 0 ? "a cost for India" : "a relief for India"}`);
  if (num(ch("usdinr"))) add("rupee", "The rupee (USD/INR)", 0.6, -ch("usdinr") / 0.4, `USD/INR ${s(ch("usdinr"))} — the rupee ${ch("usdinr") > 0 ? "weaker" : "stronger"}`);
  if (num(ch("indiavix"))) add("indiavix", "India VIX", 0.5, -ch("indiavix") / 6, `India VIX ${s(ch("indiavix"))}`);
  const fii = rows.get("fii") && num(rows.get("fii").flowCr) ? rows.get("fii").flowCr : null;
  if (num(fii)) add("fii", "Foreign institutions (FII/FPI)", live ? 0.4 : 0.8, fii / 2000, `FIIs ${fii >= 0 ? "bought" : "sold"} a net ₹${Math.abs(Math.round(fii)).toLocaleString("en-IN")} crore in the latest reported session`);
  if (options && options.available && options.bias) add("options", "Nifty option chain", live ? 1.2 : 1.0, options.bias.score / 50, `${options.bias.label}: PCR ${options.pcr ?? "—"}, max pain ${options.maxPain ?? "—"}, call wall ${options.resistance ? options.resistance.strike : "—"}, put wall ${options.support ? options.support.strike : "—"}`);
  if (live && tide && num(tide.score)) add("tide", "The Nifty's own tide (live)", 2.0, tide.score / 60, tide.summary || `tide ${tide.score}`);
  if (fresh && fresh.mood) add("mood", "World news mood", live ? 0.5 : 0.8, { risk_on: 0.7, risk_off: -0.7 }[fresh.mood] || 0, `${fresh.headline || fresh.mood}`);

  const wsum = votes.reduce((a, v) => a + v.weight, 0);
  const lean = wsum ? votes.reduce((a, v) => a + v.vote * v.weight, 0) / wsum : 0;
  const score = Math.round(lean * 100);
  const side = Math.sign(score);
  const agreeW = side ? votes.filter((v) => Math.sign(v.vote) === side && Math.abs(v.vote) >= 0.1).reduce((a, v) => a + v.weight, 0) : 0;
  const agreement = wsum ? Math.round((agreeW / wsum) * 100) : 0;
  const word = score >= 20 ? "up" : score <= -20 ? "down" : "sideways";
  const firm = Math.abs(score) >= 20 && agreement >= 60;

  // the measured follow: the Nifty's opens against the S&P 500's previous session
  const follow = history && history.spx && nifty && nifty.daily ? measureFollow(nifty.daily, history.spx) : null;
  const followEu = history && history.dax && nifty && nifty.daily ? measureFollow(nifty.daily, history.dax) : null;

  // the expected open (before the session only)
  let open = null;
  if (!live && nifty && num(nifty.prevClose)) {
    let gap = null;
    let basis = "";
    if (num(gift)) {
      gap = gift;
      basis = `GIFT Nifty ${s(gift)}: it trades through the night, so it is the best single guide to the Nifty's open.`;
    } else if (num(ch("spx"))) {
      const b = follow ? follow.beta : 0.3;
      gap = b * ch("spx") + (num(eu) ? 0.15 * eu : 0) + (num(asia) ? 0.25 * asia : 0);
      basis = `No GIFT Nifty reading: the S&P 500's ${s(ch("spx"))} × ${follow ? `the Nifty's measured ${b}` : "about 0.3"}${num(eu) ? `, plus a little of Europe's ${s(eu)}` : ""}${num(asia) ? ` and Asia's ${s(asia)}` : ""}.`;
    }
    if (num(gap)) {
      const gaps = (nifty.daily || []).slice(-120).map((b, i, a) => (i ? (b.o / a[i - 1].c - 1) * 100 : null)).filter(num);
      const m = mean(gaps);
      const sd = gaps.length > 20 ? Math.max(0.1, Math.sqrt(gaps.reduce((a, x) => a + (x - m) ** 2, 0) / (gaps.length - 1)) * 0.6) : 0.25;
      const exp = nifty.prevClose * (1 + gap / 100);
      open = {
        gapPct: r2(gap),
        expected: Math.round(exp * 20) / 20,
        low: Math.round(nifty.prevClose * (1 + (gap - sd) / 100) * 20) / 20,
        high: Math.round(nifty.prevClose * (1 + (gap + sd) / 100) * 20) / 20,
        label: Math.abs(gap) < 0.2 ? "a flat open" : gap > 0 ? `a gap-up open (${s(gap)})` : `a gap-down open (${s(gap)})`,
        basis,
      };
    }
  }
  // the day's range for the Nifty, around the expected open (or the last price in the session)
  let range = null;
  if (nifty && nifty.daily && nifty.daily.length > 21) {
    const d = nifty.daily.slice(-21);
    const rg = d.slice(1).map((b, i) => ((b.h - b.l) / d[i].c) * 100).sort((a, b) => a - b);
    const med = rg[Math.floor(rg.length / 2)];
    const at = live ? nifty.last : open ? open.expected : nifty.prevClose;
    if (num(med) && num(at)) {
      const tilt = 0.5 + (clamp(score, -100, 100) / 100) * 0.2;
      const span = (med / 100) * at;
      range = live ? { low: Math.round((Math.min(nifty.low || at, at - span * (1 - tilt) * 0.5)) * 20) / 20, high: Math.round((Math.max(nifty.high || at, at + span * tilt * 0.5)) * 20) / 20, typicalPct: r2(med) } : { low: Math.round((at - span * (1 - tilt)) * 20) / 20, high: Math.round((at + span * tilt) * 20) / 20, typicalPct: r2(med) };
    }
  }

  // sectors most exposed to tonight's cues
  const sectors = [];
  const sec = (sector, bias, why) => sectors.push({ sector, bias, why });
  if (num(ch("ixic")) && Math.abs(ch("ixic")) >= 0.7) sec("IT", ch("ixic") > 0 ? "tailwind" : "headwind", `Nasdaq ${s(ch("ixic"))} — Indian IT trades with US tech`);
  if (num(ch("usdinr")) && Math.abs(ch("usdinr")) >= 0.2) sec("IT and pharma exporters", ch("usdinr") > 0 ? "tailwind" : "headwind", `the rupee ${ch("usdinr") > 0 ? "weaker" : "stronger"} (USD/INR ${s(ch("usdinr"))})`);
  const china = avg(["hsi", "sse"]);
  if (num(china) && Math.abs(china) >= 1) sec("Metals", china > 0 ? "tailwind" : "headwind", `Hong Kong / China ${s(china)} — metal prices follow Chinese demand`);
  if (num(ch("crude")) && Math.abs(ch("crude")) >= 1.5) sec("Oil marketers, paints, tyres, airlines", ch("crude") < 0 ? "tailwind" : "headwind", `crude ${s(ch("crude"))}`);
  if (num(fii) && Math.abs(fii) >= 1500) sec("Large banks and financials", fii > 0 ? "tailwind" : "headwind", `FIIs ${fii > 0 ? "bought" : "sold"} ₹${Math.abs(Math.round(fii)).toLocaleString("en-IN")} crore`);
  for (const x of fresh ? fresh.sectors || [] : []) if (!sectors.some((y) => y.sector.toLowerCase() === String(x.sector).toLowerCase())) sec(x.sector, x.bias, `${x.why} (world brief)`);

  const cautions = [];
  if (!votes.length) cautions.push("No overseas cue could be read: connect Zerodha (GIFT Nifty, the rupee, crude), add an FMP key for the overseas indices, or refresh the world brief.");
  if (!num(gift) && !live) cautions.push("No GIFT Nifty reading: the expected open rests on the overseas closes alone, which explain only a part of the Nifty's opens.");
  if (fresh && fresh.events && fresh.events.length) cautions.push(`Scheduled today: ${fresh.events.slice(0, 3).join("; ")}.`);
  if (follow && num(follow.r2) && follow.r2 < 0.15) cautions.push(`Overnight US moves explained only ${Math.round(follow.r2 * 100)}% of the Nifty's opening gaps over ${follow.days} days: GIFT Nifty and the morning's own news matter more.`);

  const forWhen = live ? "the rest of today's session" : nextSession ? `the session on ${nextSession}` : "the next session";
  const headline = live
    ? firm
      ? `The rest of today leans ${word.toUpperCase()} (${agreement}% of the cues agree)`
      : `No firm lean for the rest of today (${agreement}% agree)`
    : open
      ? `NSE likely to see ${open.label}; the day leans ${firm ? word.toUpperCase() : "nowhere firmly"}${firm ? ` (${agreement}% agree)` : ""}`
      : firm
        ? `The next session leans ${word.toUpperCase()} (${agreement}% of the cues agree)`
        : "No firm lean from the overseas cues";

  return {
    available: votes.length > 0,
    phase,
    for: forWhen,
    headline,
    lean: { score, word, agreement, firm },
    open,
    range,
    votes: votes.sort((a, b) => Math.abs(b.vote * b.weight) - Math.abs(a.vote * a.weight)),
    markets: [...rows.values()].sort((a, b) => ["India (GIFT City)", "US", "Europe", "Japan", "Singapore", "Hong Kong", "Korea", "China", "India", "Currency", "Commodities", "Rates", "Flows"].indexOf(a.region) - ["India (GIFT City)", "US", "Europe", "Japan", "Singapore", "Hong Kong", "Korea", "China", "India", "Currency", "Commodities", "Rates", "Flows"].indexOf(b.region)),
    measured: { us: follow, europe: followEu },
    sectors,
    options: options && options.available ? { label: options.bias.label, score: options.bias.score, pcr: options.pcr, maxPain: options.maxPain, resistance: options.resistance && options.resistance.strike, support: options.support && options.support.strike, expiry: options.expiry } : null,
    news: fresh ? { headline: fresh.headline, indiaRead: fresh.indiaRead, mood: fresh.mood, events: fresh.events || [], caveats: fresh.caveats || [], at: fresh.at } : null,
    cautions,
    nifty: nifty ? { prevClose: r2(nifty.prevClose), last: r2(nifty.last), changePct: r2(nifty.changePct) } : null,
    rule: "Each cue votes between −1 and +1 with a fixed weight — before the open: GIFT Nifty 2.5, US 1.5, Asia 1.2, US futures 1, the Nifty option chain 1, Europe 0.8, FII flows 0.8, world-news mood 0.8, crude 0.6, the rupee 0.6, both VIXes 0.5; in the session GIFT Nifty is left out and the Nifty's own tide weighs 2. A lean of ±20 with 60% agreement is firm. The expected open is GIFT Nifty's move (or, without it, the overseas closes times the Nifty's measured sensitivity). Agreement is not a probability.",
  };
}

module.exports = { buildMarketForecast, measureFollow, idOfCue, pctOf, crore };
