"use strict";
// The owner's expense ledger: what was spent, on which day, on what. It is a personal thing of the owner's, kept beside
// the Kundali under "Personal" on /me, and — like the Kundali — it is for superadmins only.
//
//   AN ENTRY      a day, an amount in rupees, a category, a few words on what it was, how it was paid, and a note.
//                 Everything is checked on the way in: a real date, an amount above zero, a category from the list.
//   CLASSIFIED    fifty-odd categories in eight groups (Stock Market, Home, Dharma & giving, Food, Family & education,
//                 Health & lifestyle, Transport & travel, Money matters) and "Other". The list lives here, so the page,
//                 the totals and a file exported years from now all mean the same thing by a category's name.
//                 Eight groups, because a chart can keep eight colours apart (for colour-blind readers too) and no
//                 more: Health joined Lifestyle when Stock Market was added (21 Nov 2026). A category's id never
//                 changes, so an entry keeps its category whatever group that category is shown under.
//   KEPT          one record per entry in the record store (collection "expenses"), so it is in the daily backup.
//
// Searching, sorting and the month / year / category totals are the page's work (src/admin/expenses/): the whole ledger
// is small enough to hand over in one answer. Nothing here is read by the trading desk or shown to an AI model.

const crypto = require("crypto");

const NAME = "expenses";
const MAX_ITEMS = 50000;
const MAX_AMOUNT = 1e9; // ₹100 crore: more than this is a slip of the finger
const FIRST_DAY = "2000-01-01";
const IST = 5.5 * 3600 * 1000;

/** The groups, in the order they are listed and stacked on the page (the order their colours were checked in). */
const GROUPS = [
  { id: "stock", label: "Stock Market" },
  { id: "home", label: "Home" },
  { id: "dharma", label: "Dharma & giving" },
  { id: "food", label: "Food" },
  { id: "family", label: "Family & education" },
  { id: "life", label: "Health & lifestyle" },
  { id: "travel", label: "Transport & travel" },
  { id: "money", label: "Money matters" },
  { id: "other", label: "Other" },
];
const CATEGORIES = [
  // what running the trading desk costs (the owner's list, 21 Nov 2026, and the usual others)
  { id: "kiteapi", label: "Zerodha Kite API subscription", group: "stock" },
  { id: "chatgpt", label: "ChatGPT subscription", group: "stock" },
  { id: "claude", label: "Claude subscription", group: "stock" },
  { id: "aitools", label: "Other AI tools", group: "stock" },
  { id: "aiapi", label: "AI API token cost", group: "stock" },
  { id: "charting", label: "Charting & market data", group: "stock" },
  { id: "tradetools", label: "Trading tools & software", group: "stock" },
  { id: "research", label: "Research, news & advisory", group: "stock" },
  { id: "youtube", label: "YouTube Premium", group: "stock" },
  { id: "netflix", label: "Netflix", group: "stock" },
  { id: "broadband", label: "Internet broadband", group: "stock" },
  { id: "mobile", label: "Mobile recharge", group: "stock" },
  { id: "ithw", label: "IT hardware", group: "stock" },
  { id: "cloud", label: "Cloud server, domain & hosting", group: "stock" },
  { id: "officerent", label: "Office rent", group: "stock" },
  { id: "officesetup", label: "Office setup & furniture", group: "stock" },
  { id: "ups", label: "Power backup (UPS, inverter)", group: "stock" },
  { id: "demat", label: "Demat AMC & DP charges", group: "stock" },
  { id: "courses", label: "Trading courses & books", group: "stock" },
  { id: "ca", label: "CA & tax filing", group: "stock" },
  { id: "tradeother", label: "Other trading expense", group: "stock" },
  { id: "rent", label: "Rent", group: "home" },
  { id: "upkeep", label: "Home upkeep & repairs", group: "home" },
  { id: "help", label: "Household help", group: "home" },
  { id: "power", label: "Electricity, water & gas", group: "home" },
  { id: "net", label: "Phone & internet", group: "home" },
  { id: "puja", label: "Puja & temple", group: "dharma" },
  { id: "daan", label: "Daan & charity", group: "dharma" },
  { id: "yatra", label: "Pilgrimage", group: "dharma" },
  { id: "grocery", label: "Groceries", group: "food" },
  { id: "dining", label: "Eating out", group: "food" },
  { id: "snacks", label: "Tea, snacks & sweets", group: "food" },
  { id: "parents", label: "Family support", group: "family" },
  { id: "kids", label: "Children", group: "family" },
  { id: "study", label: "Fees, books & courses", group: "family" },
  { id: "gifts", label: "Gifts & functions", group: "family" },
  { id: "clothes", label: "Clothes & shopping", group: "life" },
  { id: "gadgets", label: "Electronics", group: "life" },
  { id: "fun", label: "Entertainment & subscriptions", group: "life" },
  { id: "care", label: "Personal care", group: "life" },
  { id: "doctor", label: "Doctor & tests", group: "life" },
  { id: "medicine", label: "Medicines", group: "life" },
  { id: "fitness", label: "Fitness", group: "life" },
  { id: "fuel", label: "Fuel", group: "travel" },
  { id: "ride", label: "Cab, auto & metro", group: "travel" },
  { id: "trip", label: "Trips & tickets", group: "travel" },
  { id: "vehicle", label: "Vehicle service", group: "travel" },
  { id: "emi", label: "EMI & loans", group: "money" },
  { id: "insurance", label: "Insurance", group: "money" },
  { id: "tax", label: "Taxes", group: "money" },
  { id: "fees", label: "Bank & broker charges", group: "money" },
  { id: "other", label: "Other", group: "other" },
];
const METHODS = [
  { id: "upi", label: "UPI" },
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "netbanking", label: "Net banking" },
  { id: "wallet", label: "Wallet" },
  { id: "other", label: "Other" },
];
const CAT = new Map(CATEGORIES.map((c) => [c.id, c]));
const METHOD = new Set(METHODS.map((m) => m.id));

class ExpenseError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const realDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
};
const text = (v, max) =>
  String(v === undefined || v === null ? "" : v)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** What was typed, as an entry's fields — or an ExpenseError saying, in words, what is wrong. */
function clean(input, now = Date.now()) {
  const b = input && typeof input === "object" ? input : {};
  const date = String(b.date || "");
  if (!realDate(date)) throw new ExpenseError("Choose the day it was spent.");
  if (date < FIRST_DAY) throw new ExpenseError("That date is too far back.");
  // a bill paid ahead can be entered, but not one from another year by a slip of the finger
  if (date > istDate(now + 366 * 86400000)) throw new ExpenseError("That date is more than a year ahead.");
  const raw = typeof b.amount === "string" ? b.amount.replace(/[₹,\s]/g, "") : b.amount;
  const amount = Math.round(Number(raw) * 100) / 100;
  if (raw === "" || raw === null || raw === undefined || !Number.isFinite(amount) || amount <= 0) throw new ExpenseError("Enter the amount, above zero.");
  if (amount > MAX_AMOUNT) throw new ExpenseError("That amount is too large to be right.");
  const category = String(b.category || "");
  if (!CAT.has(category)) throw new ExpenseError("Choose a category.");
  const method = b.method === undefined || b.method === "" ? "upi" : String(b.method);
  if (!METHOD.has(method)) throw new ExpenseError("Choose how it was paid.");
  return { date, amount, category, title: text(b.title, 120) || CAT.get(category).label, method, note: text(b.note, 500) };
}

/** Newest day first; on one day, the latest entry first. */
const byDay = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt).localeCompare(String(a.createdAt)));

class Expenses {
  constructor({ docs, now = () => Date.now() }) {
    this.docs = docs;
    this.now = now;
  }

  /** The lists the page classifies by (they never change with the data). */
  meta() {
    return { groups: GROUPS, categories: CATEGORIES, methods: METHODS, today: istDate(this.now()), limits: { maxItems: MAX_ITEMS, maxAmount: MAX_AMOUNT } };
  }

  list() {
    return this.docs.items(NAME).slice().sort(byDay);
  }

  add(input, by = "") {
    const fields = clean(input, this.now());
    if (this.docs.items(NAME).length >= MAX_ITEMS) throw new ExpenseError(`The ledger holds at most ${MAX_ITEMS.toLocaleString("en-IN")} entries.`);
    const at = new Date(this.now()).toISOString();
    const item = { id: `e${crypto.randomBytes(8).toString("hex")}`, ...fields, createdAt: at, updatedAt: at, by };
    this.docs.putItems(NAME, [item]);
    return item;
  }

  update(id, input, by = "") {
    const old = this.docs.items(NAME).find((x) => x.id === String(id || ""));
    if (!old) throw new ExpenseError("That entry is no longer there.", "not_found", 404);
    const item = { ...old, ...clean(input, this.now()), updatedAt: new Date(this.now()).toISOString(), by: by || old.by };
    this.docs.putItems(NAME, [item]);
    return item;
  }

  remove(id) {
    const old = this.docs.items(NAME).find((x) => x.id === String(id || ""));
    if (!old) throw new ExpenseError("That entry is no longer there.", "not_found", 404);
    this.docs.removeItems(NAME, [old.id]);
    return old;
  }
}

/** The routes. Superadmins only: it is the owner's own ledger, not an admin's page. */
function mountExpenses(app, { expenses, requireSuper, limiter }) {
  const wrap = (fn, status = 200) => async (req, res) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      if (err instanceof ExpenseError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error("[expenses]", err && err.message ? err.message : err);
      res.status(500).json({ error: "expenses_failed", message: "The expense could not be saved." });
    }
  };
  const by = (req) => (req.user && req.user.email) || "";
  app.get("/api/admin/expenses", requireSuper, wrap(async () => ({ items: expenses.list(), ...expenses.meta() })));
  app.post("/api/admin/expenses", requireSuper, limiter(600, 15 * 60 * 1000), wrap(async (req) => ({ item: expenses.add(req.body, by(req)) }), 201));
  app.put("/api/admin/expenses/:id", requireSuper, limiter(600, 15 * 60 * 1000), wrap(async (req) => ({ item: expenses.update(String(req.params.id), req.body, by(req)) })));
  app.delete("/api/admin/expenses/:id", requireSuper, limiter(600, 15 * 60 * 1000), wrap(async (req) => ({ ok: true, removed: expenses.remove(String(req.params.id)).id })));
}

module.exports = { Expenses, ExpenseError, mountExpenses, clean, GROUPS, CATEGORIES, METHODS, NAME };
