import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TradeSetup from "./TradeSetup";
import { api } from "../../api";

jest.mock("../../api", () => ({ api: jest.fn(), peek: () => null }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
afterEach(() => api.mockReset());

const lv = (name, spot, pivot) => ({ name, available: true, spot, pivot, r1: pivot + 100, r2: pivot + 200, r3: pivot + 300, s1: pivot - 100, s2: pivot - 200, s3: pivot - 300, prevHigh: pivot + 80, prevLow: pivot - 90, prevClose: pivot + 10, basedOn: "2026-11-20", walls: { put: pivot - 200, call: pivot + 200, maxPain: pivot }, read: `${name} above its pivot ₹${pivot}.` });
const side = (kind) => ({ side: kind, expiry: "2026-11-25", maxOi: [{ strike: 26500, oi: 4200000 }], maxAdded: [{ strike: 26400, oiChange: 900000 }], maxShed: [{ strike: 26000, oiChange: -300000 }], changeKnown: true, read: "" });
const build = {
  known: 190,
  counts: { "long build-up": 55, "long unwinding": 50, "short build-up": 45, "short covering": 73 },
  lists: { "long build-up": [{ symbol: "ABB", changePct: 2.1, oiChangePct: 9.4 }], "long unwinding": [], "short build-up": [{ symbol: "SAIL", changePct: -1.8, oiChangePct: 6.2 }], "short covering": [] },
};
const data = {
  available: true,
  asOf: "2026-11-23T04:40:00.000Z",
  connected: true,
  sessionOn: true,
  nifty: lv("NIFTY 50", 26300, 26200),
  bank: lv("NIFTY BANK", 59000, 58800),
  options: { niftyCalls: side("call"), niftyPuts: side("put"), bankCalls: null, bankPuts: null },
  pcr: { nifty: 1.24, bank: 0.92, expiry: "2026-11-25" },
  maxPain: { nifty: 26200, bank: 58800 },
  vix: { last: 13.2, changePct: -3.5 },
  flows: { date: "20-Nov-2026", fii: { buy: 23596, sell: 13288, net: 10308 }, dii: { buy: 18492, sell: 23352, net: -4860 } },
  build,
  prevBuild: build,
  buildBasis: "now, against each future's open interest at the last close (2026-11-20)",
  delivery: [{ symbol: "HDFCBANK", delivPct: 68.2, vsAvg: 1.6, changePct: 1.1 }],
  deliveryAsOf: "2026-11-20",
  ban: { date: "2026-11-23", symbols: ["MANAPPURAM"] },
  lean: { score: 34, label: "Bullish", agreement: 0.8, votes: [{ id: "flows", vote: 0.6, why: "FIIs bought ₹10,308 cr" }] },
  record: { called: 10, right: 7, hitRate: 0.7, last: [], rule: "The rule." },
  times: {},
  errors: {},
  rule: "Pivots: P = (H+L+C)/3.",
};

test("the fifteen readings and the lean, each in its own section; a stock opens on the Desk", async () => {
  api.mockResolvedValue(data);
  const opened = jest.fn();
  const { container } = render(<TradeSetup onOpen={opened} />);
  await waitFor(() => expect(container.querySelector(".ts-leanbox")).toBeTruthy());
  expect(api).toHaveBeenCalledWith("/api/admin/market/setup");
  expect(container.querySelector(".ts-leanbox").textContent).toMatch(/Setup leanBullishscore \+34 · 80% of the weight agrees/);
  expect(container.textContent).toMatch(/the 9:14 lean was right on 7 of 10 called sessions \(70%\)/);
  expect(container.textContent).toMatch(/NIFTY 50 above its pivot ₹26200\./);
  expect(container.querySelector(".ts-four").textContent).toMatch(/NIFTY callsMost OI26500 \(42\.0 L\)Most added26400 \(\+9\.0 L\)Most shed26000 \(-3\.0 L\)/);
  expect(container.textContent).toMatch(/\+₹10,308 cr/);
  expect(container.textContent).toMatch(/−₹4,860 cr/);
  expect(container.textContent).toMatch(/1\.24 NIFTY · 0\.92 BANK/);
  expect(container.textContent).toMatch(/13\.2/);
  expect(container.querySelector(".ts-builds").textContent).toMatch(/Long build-up 55/);
  expect(container.querySelector(".ts-builds").textContent).toMatch(/Short covering 73/);
  expect(container.textContent).toMatch(/HDFCBANK68\.2%1\.6×\+1\.10%/);
  // the ban as rows since 28 Nov 2026: a BAN tag, the stock (it opens on the Desk) and what the ban allows
  const ban = screen.getByRole("list", { name: "Stocks in the F&O ban" });
  expect(ban.textContent).toMatch(/BANMANAPPURAM/);
  expect(ban.textContent).toMatch(/F&O: reduce only · Cash: open/);
  // the first-sight panel: the lean, both indices against their levels, the flows, the breadth and the ban
  const glance = screen.getByRole("region", { name: "At a glance" });
  expect(glance.textContent).toMatch(/NIFTY 5026,300▲ above pivot 26,200/);
  expect(glance.textContent).toMatch(/Support R1 26,300Resistance R2 26,400/);
  expect(glance.textContent).toMatch(/F&O ban1 stockMANAPPURAM/);
  fireEvent.click(screen.getByRole("button", { name: "ABB" }));
  expect(opened).toHaveBeenCalledWith("ABB");
  fireEvent.click(screen.getByRole("button", { name: "Last session" }));
  expect(screen.getByRole("button", { name: "Last session" }).getAttribute("aria-pressed")).toBe("true");
});
