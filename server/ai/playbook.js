"use strict";
// The trading-skills file: the strategist's written rules and the lessons it has
// drawn from its own scored plans. It is a plain Markdown file on the server
// (data/ai/trading-skills.md): readable, editable and resettable from the page.
//
// Every strategy request includes this file, so what is written here shapes
// every later answer. Lessons are appended only by the "Score & learn" step,
// from outcomes that were scored mechanically against real prices.


const MAX_CHARS = 24000;
const MAX_LESSONS = 60;
const LESSONS_HEAD = "## Lessons from scored plans";

const SEED = `# Trading skills

How this desk trades NSE cash equities. The strategist follows these rules in every plan.

## What cannot be promised
- No method wins every trade. Losses are a cost of doing business; the job is to keep them small and planned.
- A plan is a bet with a defined loss, not a prediction. Never describe a plan as certain, safe or guaranteed.
- This desk sees price, volume and time only. News, results, block deals and order flow can override any chart.

## Risk first
- Decide the exit before the entry. Every plan has a stop-loss at a price where the idea is clearly wrong.
- Risk a small, fixed part of capital per trade (commonly 0.5–1%). Size the position from the stop distance, never the other way round.
- Never widen a stop after entry. Never average down a losing day trade.
- Skip a trade whose first target is closer than its stop. Prefer at least 1.5× reward to risk.
- After two losing day trades in a session, stop for the day. Tilt costs more than any missed move.

## Trade with the evidence
- Prefer trades where the weekly, daily and intraday trends agree. A counter-trend trade needs smaller size and a quicker exit.
- "No trade" is a position. When the evidence is mixed, say so and stand aside.
- A breakout counts only after a bar closes beyond the level, ideally on above-average volume. One tick through is not a breakout.
- Do not chase. If price has run more than about 0.8 ATR from the level that would prove the idea wrong, wait for a pullback.
- Stocks far above their 20-day average tend to pause; stocks at 52-week highs in an uptrend tend to keep trending. Know which one you are looking at.

## Day trading on NSE
- The first 15 minutes set the opening range. No entries before 9:30 AM.
- 9:30–11:30 AM and 1:30–2:45 PM carry the cleanest moves. 11:30 AM–1:30 PM is thin: demand stronger evidence.
- No fresh entries after 2:45 PM. Be flat before the broker's auto square-off (about 3:15–3:20 PM).
- VWAP is the day's fair price: longs above it, shorts below it. A long below VWAP or a short above it needs a very good reason.
- A short in the cash market is intraday-only (MIS). It must be bought back the same day.
- Respect circuit limits. Never plan a target beyond a circuit, and never enter within about 1.5% of one.
- A large opening gap that is being given back is weakness, even if the stock is still up on the day.

## Swing and delivery
- Delivery trades are long-only. A bearish reading means stay out or exit, not short.
- Buy strength in an uptrend on a pullback or a confirmed breakout; do not buy a falling stock because it looks cheap.
- A daily close below the 50-day average ends most swing ideas. A weekly close below the 40-week average ends most long-term ones.
- Check liquidity: thin stocks gap through stops.

## What the best-known traders agree on
Different people, different markets, the same few habits. None of them won every trade.
- Protect capital first. Paul Tudor Jones's rule is to play defence before offence; the old floor saying is that the first loss is the cheapest.
- Cut losses short and let winners run. The Turtle traders and Ed Seykota built whole systems on that one asymmetry.
- Trade with the main trend and let price confirm. Jesse Livermore waited for the line of least resistance; he did not guess turning points.
- Buy strength, not weakness: leaders leaving tight bases on rising volume (William O'Neil, Mark Minervini) — and sell at once when a breakout fails.
- Let volatility set the stop. The Turtles used a multiple of the average true range, never a round number.
- Size decides survival. Van Tharp's point: position size, not the entry, determines whether a sound method lives through a losing streak.
- Be selective. Most days offer nothing worth taking; a month's profit usually comes from a handful of trades.
- It is not being right that pays, but how much is made when right against how much is lost when wrong — George Soros, as Stanley Druckenmiller tells it.
- Keep trading and investing apart. Rakesh Jhunjhunwala held businesses he understood through deep falls, and traded separately with strict stops. Do not let a failed trade become an "investment".
- Fast to warn, slow to commit: act on an exit signal at once, and make an entry prove itself first.

## Process
- Write the plan before the trade: entry, stop, target, size, and what would make you cancel it.
- Score every plan afterwards against what price actually did. Keep what works, drop what does not.
- A backtest on one stock is weak evidence, and the best of several backtests is partly luck.

${LESSONS_HEAD}
_None yet. Lessons appear here after plans have been scored against real prices._
`;

const NAME = "ai/trading-skills.md";

class Playbook {
  /** @param docs  the record store (server/docs.js); the file is "ai/trading-skills.md" */
  constructor({ docs }) {
    this.docs = docs;
  }

  read() {
    const text = this.docs.read(NAME, "");
    return typeof text === "string" && text.trim() ? text : SEED;
  }

  write(text) {
    const clean = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!clean) throw new Error("The skills file cannot be empty. Use Reset to restore the starting rules.");
    if (clean.length > MAX_CHARS) throw new Error(`The skills file is limited to ${MAX_CHARS} characters (it is sent with every AI request).`);
    this.docs.write(NAME, `${clean}\n`);
    return this.read();
  }

  reset() {
    this.docs.remove(NAME);
    return this.read();
  }

  lessons() {
    const text = this.read();
    const i = text.indexOf(LESSONS_HEAD);
    if (i < 0) return [];
    return text
      .slice(i + LESSONS_HEAD.length)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
  }

  /**
   * Replace (or add) one named section, just above the lessons. Used for findings that are
   * rewritten as a whole each time (paper trading), so they never pile up.
   */
  setSection(head, body) {
    const text = this.read();
    const block = `${head}\n${String(body || "").trim()}`;
    const at = text.indexOf(head);
    let next;
    if (at >= 0) {
      // the section runs to the next "## " heading
      const rest = text.slice(at + head.length);
      const m = rest.search(/\n## /);
      next = `${text.slice(0, at)}${block}${m >= 0 ? `\n${rest.slice(m)}` : "\n"}`;
    } else {
      const i = text.indexOf(LESSONS_HEAD);
      next = i >= 0 ? `${text.slice(0, i).trimEnd()}\n\n${block}\n\n${text.slice(i)}` : `${text.trimEnd()}\n\n${block}\n`;
    }
    return this.write(next);
  }

  /** Add dated lessons, keeping only the newest MAX_LESSONS. Everything above the lessons section is untouched. */
  appendLessons(lessons, date) {
    const fresh = (lessons || []).map((l) => String(l || "").replace(/\s+/g, " ").trim()).filter(Boolean).map((l) => `${date}: ${l.slice(0, 400)}`);
    if (fresh.length === 0) return this.read();
    const text = this.read();
    const i = text.indexOf(LESSONS_HEAD);
    const head = (i < 0 ? `${text.trim()}\n\n` : text.slice(0, i)).trimEnd();
    const all = [...this.lessons(), ...fresh].slice(-MAX_LESSONS);
    let next = `${head}\n\n${LESSONS_HEAD}\n${all.map((l) => `- ${l}`).join("\n")}`;
    // the rules above always win the space: drop the oldest lessons if the file is full
    while (next.length > MAX_CHARS && all.length > 1) {
      all.shift();
      next = `${head}\n\n${LESSONS_HEAD}\n${all.map((l) => `- ${l}`).join("\n")}`;
    }
    return this.write(next);
  }
}

module.exports = { Playbook, SEED, MAX_CHARS, MAX_LESSONS, LESSONS_HEAD };
