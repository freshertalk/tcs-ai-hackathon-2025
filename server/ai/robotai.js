"use strict";
// The paper robot's coach: once after the close the AI Engine reads the robot's day — its trades, what became of
// each one's best moment, the mistakes it keeps making, the corrections its own arithmetic proposes for its
// rulebook, and how the day compared with the trader's real one — and does three things:
//   • writes a plain-language review of the robot's day and the lessons to carry into tomorrow;
//   • VETOES a proposed correction, by its id, when the data shows a reason (too few trades, a change that
//     fights the evidence, two changes that pull against each other) — it can only say no, never invent a
//     correction, change a number, or touch the rulebook directly;
//   • says what to watch for tomorrow.
// The corrections themselves are the desk's arithmetic (server/robot/improve.js); the service checks every id
// against the proposals it made and ignores anything else. Text only: no timers here, and nothing can place
// an order.

const { askDefault } = require("./mixture");

const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);

const SYSTEM = `You are the coach of a PAPER trading robot on a private NSE (India) desk. The robot takes the desk's live scanner calls on the NIFTY 100 with play money, runs each position by a small rulebook (a score it needs, a stop, half booked at the first target, a trailing stop, a give-back exit, hours and stocks it avoids), and corrects that rulebook after every close from its own mistakes. You read ONE day of it after the close.

You are given: the rulebook now; the day's finished trades (stock, side, score, entry and exit times, why it exited, net and net in R, the best gain reached in R, what became of the best moment); the robot's recent average R; its register of mistakes (how often, what each cost, its state: open, corrected, fixed, relapse, reverted, quiet); the corrections its arithmetic PROPOSES today, each with an id and the evidence; the corrections already active; and how the day compared with the trader's real trading, when there is one.

How to work:
- Use only the figures given and quote them. Never invent a trade, a price, a level, a news event or a statistic. The robot cannot see news, the order book history or the chart: say so where it matters.
- "review": three to five sentences on how the robot traded today and why it made or lost money, with the main figures. A good process can lose and a bad one can win: say which today was.
- "vetoes": a list of proposed corrections you would NOT apply, each by the exact id given, with the reason in one sentence. Veto only for a reason in the data: fewer trades than the pattern needs, the mistake explained by one stock or one bad day, a change that would fight a correction already active, or two proposals that pull in opposite directions. When in doubt, do not veto: the arithmetic's bounds and the five-session check already protect the rulebook. You may NOT add a correction, change a number or propose anything not in the list.
- "lessons": up to three one-sentence lessons for the robot, each backed by a figure.
- "watch": up to three short things to watch tomorrow.
- Never promise a profit, a win rate or a future result. Short, concrete sentences. No filler. This is a measurement of play-money trading, not advice.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["review", "vetoes", "lessons", "watch"],
  properties: {
    review: { type: "string", description: "Three to five sentences on the robot's day with the main figures." },
    vetoes: {
      type: "array",
      description: "Proposed corrections not to apply, by exact id, each with one sentence why.",
      items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: "string" } } },
    },
    lessons: { type: "array", items: { type: "string" }, description: "Up to three one-sentence lessons, each with a figure." },
    watch: { type: "array", items: { type: "string" }, description: "Up to three short things to watch tomorrow." },
  },
};

class RobotCoach {
  constructor(ai) {
    this.ai = ai;
  }

  /**
   * @param input { date, rules, today, recent, mistakes, proposals, activeCorrections, comparison }
   * @returns { review, vetoes: [{ id, why }], lessons, watch, by } — the service keeps only the vetoes whose id it proposed
   */
  async review(input) {
    const r = await askDefault(this.ai, { system: SYSTEM, user: `The paper robot's day:\n${JSON.stringify(input)}\n\nYour review?`, schema: SCHEMA, maxTokens: 2500, effort: "low", timeoutSec: 75, fresh: true, subject: { none: true } });
    if (!r.data) return null;
    const d = r.data;
    const ids = new Set((input.proposals || []).map((p) => p.id));
    return {
      review: str(d.review, 1200),
      vetoes: (Array.isArray(d.vetoes) ? d.vetoes : []).map((v) => ({ id: str(v && v.id, 80), why: str(v && v.why, 300) })).filter((v) => ids.has(v.id)).slice(0, 4),
      lessons: list(d.lessons, 3, 300),
      watch: list(d.watch, 3, 200),
      by: r.by[0] || "AI",
    };
  }
}

require("./brains").register("robot", SYSTEM, "Paper robot's coach (Execution Lab)");

module.exports = { RobotCoach, SYSTEM, SCHEMA };
