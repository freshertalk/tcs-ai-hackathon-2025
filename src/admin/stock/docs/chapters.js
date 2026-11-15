// The Document is plain data. Each chapter is { id, part, title, intro, blocks }, where a block
// is one of: { h }, { p }, { ul }, { ol }, { dl: [[term, text]] }, { table: { head, rows } },
// { note }, { warn }, { logic: { title, who, when, steps, limits } }.
// Text may use **bold** and `code`. The number of each chapter is given here, in reading order.

import { START } from "./content/start";
import { MARKET_DATA } from "./content/market1";
import { MARKET_VIEWS } from "./content/market2";
import { LIVE } from "./content/live";
import { TRADING } from "./content/trading";
import { AI } from "./content/ai";
import { PLATFORM } from "./content/platform";

export const PARTS = [
  { id: "start", title: "Start here" },
  { id: "market", title: "Reading the market" },
  { id: "live", title: "The live day" },
  { id: "trading", title: "Trading, records and discipline" },
  { id: "ai", title: "The AI team" },
  { id: "platform", title: "The platform" },
  { id: "end", title: "Reference" },
];

const ordered = [
  ...START.filter((c) => c.part === "start"),
  ...MARKET_DATA,
  ...MARKET_VIEWS,
  ...LIVE,
  ...TRADING,
  ...AI,
  ...PLATFORM,
  ...START.filter((c) => c.part === "end"),
];

export const CHAPTERS = ordered.map((c, i) => ({ ...c, no: String(i + 1) }));
