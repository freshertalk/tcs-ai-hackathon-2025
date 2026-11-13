import { matchScore, parseAlert, parseCommand, rank } from "./paletteMath";

test("a typed trade becomes a ticket prefill, never an order", () => {
  expect(parseCommand("buy sbin 10")).toEqual({ side: "BUY", symbol: "SBIN", quantity: 10, price: null });
  expect(parseCommand("b sbin")).toEqual({ side: "BUY", symbol: "SBIN", quantity: null, price: null });
  expect(parseCommand("  SELL infy 5 @ 1500 ")).toEqual({ side: "SELL", symbol: "INFY", quantity: 5, price: 1500 });
  expect(parseCommand("s tcs 2 at 3900.5")).toEqual({ side: "SELL", symbol: "TCS", quantity: 2, price: 3900.5 });
  expect(parseCommand("buy m&m 3")).toEqual({ side: "BUY", symbol: "M&M", quantity: 3, price: null });
  // a stock name is not a command, and neither is half of one
  expect(parseCommand("sbin")).toBeNull();
  expect(parseCommand("buy")).toBeNull();
  expect(parseCommand("buy sbin 0")).toBeNull();
  expect(parseCommand("buy sbin ten")).toBeNull();
  expect(parseCommand("buy sbin 10 20")).toBeNull();
  expect(parseCommand(null)).toBeNull();
});

test("a typed alert names the stock, the price and, when said, the side", () => {
  expect(parseAlert("alert sbin 800")).toEqual({ symbol: "SBIN", price: 800, dir: "" });
  expect(parseAlert("alert sbin below 780.5")).toEqual({ symbol: "SBIN", price: 780.5, dir: "below" });
  expect(parseAlert("al tcs > 4000")).toEqual({ symbol: "TCS", price: 4000, dir: "above" });
  expect(parseAlert("alert infy under 1450")).toEqual({ symbol: "INFY", price: 1450, dir: "below" });
  expect(parseAlert("alert sbin")).toBeNull();
  expect(parseAlert("alert sbin 0")).toBeNull();
  expect(parseAlert("alerts")).toBeNull();
});

test("matches are ranked: exact, then a word that starts with it, then anywhere, then letters in order", () => {
  expect(matchScore("Advisor", "advisor")).toBe(100);
  expect(matchScore("Advisor", "adv")).toBe(80);
  expect(matchScore("Positions and orders", "ord")).toBe(60);
  expect(matchScore("Screener", "reen")).toBe(40);
  expect(matchScore("Research", "rsch")).toBe(10);
  expect(matchScore("Desk", "xyz")).toBe(0);
  expect(matchScore("Desk", "")).toBe(1);
  const items = [{ label: "Desk" }, { label: "Debrief" }, { label: "Dark or light theme", keywords: "appearance colours" }, { label: "Advisor", keywords: "measured odds decide" }];
  // "de": two labels start with it, one keyword does ("decide"), and one only has the letters in order
  expect(rank(items, "de").map((x) => x.label)).toEqual(["Desk", "Debrief", "Advisor", "Dark or light theme"]);
  expect(rank(items, "deb").map((x) => x.label)).toEqual(["Debrief"]);
  expect(rank(items, "odds").map((x) => x.label)).toEqual(["Advisor"]);
  expect(rank(items, "theme").map((x) => x.label)).toEqual(["Dark or light theme"]);
  expect(rank(items, "zzz")).toEqual([]);
  expect(rank(items, "", 2)).toHaveLength(2);
  // scattered letters in a long description are not a match
  expect(rank([{ label: "Journal", keywords: "every round trip you made and an AI review" }], "adv")).toEqual([]);
});
