"use strict";
// The vault: everything the desk has recorded and learned, downloadable from /me, and backed up by itself.
//
//   DOWNLOADS   every dataset in the database, one link each: the recorded tape (a spreadsheet per session, or all of
//               them), the NIFTY 100's 5-minute history (per stock, or all), every list (forecasts and their scores, the
//               journal's fills, the robot's trades, what each learner learned…) as CSV or JSON, and every record
//               (the models, the trading-skills file…) as it is stored.
//   BACKUPS     one file holding EVERYTHING the store holds (documents, the whole of each log, every list, every
//               recorded session): lines of JSON, compressed. Made by itself once a day after the close (the automation
//               supervisor's last duty), on a click, kept on the server's disk (data/backups, the newest N), and
//               downloadable — a copy on your own computer is the one that survives the server.
//   RESTORE     never from the browser: a restore replaces records while services hold their own copies in memory, so
//               it is done with the server stopped —  node server/restore.js <file>  (see that file).
//
// What a backup holds and does not: your settings and accounts are in it (secrets inside them stay encrypted, and the
// two key files are NOT in it); caches that download again (candles, instrument lists) and the temple's audio are not.
// Owner only, every route. Nothing here reaches the broker or an AI model.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { once } = require("events");
const { unpack } = require("./robot/history");
const { LOGS } = require("./docs");

const IST = 5.5 * 3600 * 1000;
const SETTINGS = "vault/settings.json";
const FILE_RE = /^drishtiai-backup-\d{4}-\d{2}-\d{2}-\d{6}\.ndjson\.gz$/;
const NAME_RE = /^[a-z][a-z0-9_]{1,40}$/;
const DOC_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;
const FORMAT = 1;
const DEFAULTS = { auto: true, keep: 5 };
const STALE_MS = 20 * 3600000;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const istStamp = (ms) => new Date(ms + IST).toISOString();
const iso = (ms) => new Date(ms).toISOString();

/** What each list is, in plain words, and where it belongs on the screen. */
const LISTS = {
  loans: {
    group: "Other records",
    title: "Loan book",
    what: "Every loan, its monthly EMIs (paid or not), part-payments, remarks and the history of changes.",
  },
  robot_history: {
    group: "Recorded market data",
    title: "NIFTY 100 price history",
    what: "A year of 5-minute bars for every NIFTY 100 stock: what the forecaster and the paper robot learn from.",
  },
  horizon_learning: {
    group: "The learning brain",
    title: "15-minute forecaster: what it learned on each run",
    what: "The model chosen, the contest, the time-of-day experts and the lessons in words, per training and per evening.",
  },
  horizon_days: {
    group: "The learning brain",
    title: "15-minute forecaster: each evening's score",
    what: "How the whole NIFTY 100 day was forecast before it was learned: direction, miss and band, by horizon.",
  },
  tape_learning: {
    group: "The learning brain",
    title: "Order book and open interest: what was learned",
    what: "Per evening: forecasts scored, the gain out of sample, whether the readings are in use, and the strongest ones.",
  },
  robot_study: {
    group: "The learning brain",
    title: "Paper robot: the NIFTY 100 level book",
    what: "What each stock's levels did, studied every evening.",
  },
  analysis_learnings: {
    group: "The learning brain",
    title: "Trade Analysis: lessons and Don't-repeat rules",
    what: "What your own trading days taught.",
  },
  horizon_forecasts: {
    group: "Forecasts and their scores",
    title: "15-minute forecasts made live",
    what: "Every forecast kept during the session, with what really happened beside it.",
  },
  open_forecasts: {
    group: "Forecasts and their scores",
    title: "Opening-price forecasts",
    what: "Predicted and actual opening price per stock, with the miss.",
  },
  autopilot_proposals: {
    group: "Forecasts and their scores",
    title: "Autopilot proposals",
    what: "Every proposal, the risk gate's verdict and its grade afterwards (never an order).",
  },
  robot_trades: {
    group: "Trading records",
    title: "Paper robot: trades",
    what: "Play-money trades with entry, exit and result.",
  },
  robot_days: {
    group: "Trading records",
    title: "Paper robot: days",
    what: "One record per session.",
  },
  journal_fills: {
    group: "Trading records",
    title: "Trade journal: every fill",
    what: "Your real fills, as imported or captured.",
  },
  analysis_snapshots: {
    group: "Trading records",
    title: "Trade Analysis: day snapshots",
    what: "The saved picture of each trading day.",
  },
  analysis_outcomes: {
    group: "Trading records",
    title: "Trade Analysis: outcomes",
    what: "What happened after each day's calls.",
  },
};
const DOCS = {
  "market/horizon-model.json": {
    group: "The learning brain",
    title: "15-minute forecaster: the model",
    what: "Weights, sums, confidence tables and each stock's profile.",
  },
  "market/flow-model.json": {
    group: "The learning brain",
    title: "Order book and open interest: the model",
    what: "Sums, weights, the out-of-sample evidence and whether it is in use.",
  },
  "ai/trading-skills.md": {
    group: "The learning brain",
    title: "The trading-skills file",
    what: "The text every AI feature reads: your rules and what the desk has measured.",
  },
  "market/tape-index.json": {
    group: "Recorded market data",
    title: "Recorded sessions: the index",
    what: "Which sessions are stored and how much of each.",
  },
  "market/edge.json": {
    group: "The learning brain",
    title: "Edge models per stock",
    what: "",
  },
  "market/behaviour.json": {
    group: "The learning brain",
    title: "Stock behaviour studies",
    what: "",
  },
  "market/signals.json": {
    group: "Forecasts and their scores",
    title: "Tracked signals",
    what: "",
  },
};
const GROUPS = ["Recorded market data", "The learning brain", "Forecasts and their scores", "Trading records", "Other records"];
// never served one by one: the accounts-and-settings record, anything with a key or a secret in its name, and other
// people's own trading records (accounts/…) — a full backup still holds them, as it must
const PRIVATE_DOC = /(^|\/)db\.json$|\.key$|secret|^accounts\//i;

/* ============================================================================ CSV */

const cell = (v) => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // text that a spreadsheet would run as a formula (=, +, -, @, tab, return first) is kept as text with a leading apostrophe;
  // numbers are left as they are (a negative number is a number, not a formula)
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** An object as one flat row: nested objects become "a.b" columns, lists stay as JSON in one cell. */
function flatten(obj, prefix = "", out = {}, depth = 0) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) flatten(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

/** A list of records as a spreadsheet (at most 300 columns: the rest is in the JSON download). */
function toCsv(items) {
  const rows = items.map((it) => flatten(it));
  const cols = [];
  const seen = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k) && cols.length < 300) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  const lines = [cols.map(cell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c])).join(","));
  return `${lines.join("\n")}\n`;
}

/** One stock's stored bars as a spreadsheet. */
function barsCsv(symbol, bars, header = true) {
  const out = header ? ["symbol,date,time,open,high,low,close,volume"] : [];
  for (const b of bars) {
    const t = istStamp(b.t);
    out.push(`${cell(symbol)},${t.slice(0, 10)},${t.slice(11, 16)},${b.o},${b.h},${b.l},${b.c},${b.v}`);
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

/* ============================================================================ the backup file */

/** Write every record of a store to a compressed file of JSON lines. @returns { counts, bytes } */
async function writeBackup(docs, file, { now = Date.now() } = {}) {
  const tmp = `${file}.tmp`;
  const gz = zlib.createGzip({ level: 6 });
  const sink = fs.createWriteStream(tmp, { mode: 0o600 });
  const closed = once(sink, "close");
  gz.pipe(sink);
  const counts = { doc: 0, log: 0, item: 0, cold: 0 };
  const put = async (obj) => {
    if (!gz.write(`${JSON.stringify(obj)}\n`)) await once(gz, "drain");
  };
  try {
    await put({
      kind: "meta",
      app: "DrishtiAI",
      format: FORMAT,
      at: iso(now),
      store: docs.kind || "",
    });
    await docs.dump(async (e) => {
      if (!e || e.v === undefined || e.v === null) return;
      counts[e.kind] = (counts[e.kind] || 0) + 1;
      await put(e);
    });
    await put({ kind: "end", counts });
    gz.end();
    await closed;
  } catch (err) {
    gz.destroy();
    sink.destroy();
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* nothing was written */
    }
    throw err;
  }
  fs.renameSync(tmp, file);
  return { counts, bytes: fs.statSync(file).size };
}

async function eachLine(file, fn) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    await fn(JSON.parse(line));
  }
}

/** Read a backup through without changing anything: is it whole, and what is in it? */
async function inspect(file) {
  let meta = null;
  let end = null;
  const counts = { doc: 0, log: 0, item: 0, cold: 0 };
  const names = {
    doc: new Set(),
    log: new Set(),
    item: new Set(),
    cold: new Set(),
  };
  await eachLine(file, (e) => {
    if (e.kind === "meta") meta = e;
    else if (e.kind === "end") end = e;
    else if (counts[e.kind] !== undefined) {
      counts[e.kind] += 1;
      names[e.kind].add(e.name);
    }
  });
  const whole = Boolean(meta && end && ["doc", "log", "item", "cold"].every((k) => (end.counts[k] || 0) === counts[k]));
  return {
    whole,
    meta,
    counts,
    names: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, [...v].sort()])),
  };
}

/**
 * Put a backup's records into a store. The file is read through first: a file that is cut short changes nothing.
 * Documents, lists and recorded sessions replace what is there (record by record; what the backup does not hold is left
 * alone). A log is only restored into an EMPTY log, so entries are never doubled.
 * @param opts { dryRun, only: ["doc","log","item","cold"] }
 */
async function restore(file, docs, { dryRun = false, only = null } = {}) {
  const seen = await inspect(file);
  if (!seen.whole) throw new Error("This backup file is incomplete (it has no proper end): nothing was changed.");
  if (seen.meta.format !== FORMAT) throw new Error(`This backup is of format ${seen.meta.format}; this server reads format ${FORMAT}.`);
  const want = (k) => !only || only.includes(k);
  const done = { doc: 0, log: 0, item: 0, cold: 0, skippedLogs: [] };
  if (dryRun) return { ...seen, dryRun: true, done };
  const logOpen = new Map(); // log name → may it be restored (was empty at the start)
  let batch = [];
  let batchName = "";
  const flushItems = () => {
    if (batch.length) docs.putItems(batchName, batch);
    batch = [];
  };
  await eachLine(file, async (e) => {
    if (e.kind === "doc" && want("doc")) {
      docs.write(e.name, e.v);
      done.doc += 1;
    } else if (e.kind === "item" && want("item")) {
      if (e.name !== batchName || batch.length >= 500) {
        flushItems();
        batchName = e.name;
      }
      batch.push(e.v);
      done.item += 1;
    } else if (e.kind === "cold" && want("cold")) {
      await docs.coldPut(e.name, e.id, e.v);
      done.cold += 1;
    } else if (e.kind === "log" && want("log")) {
      if (!logOpen.has(e.name)) {
        const empty = docs.tail(e.name, 1).length === 0;
        logOpen.set(e.name, empty);
        if (!empty) done.skippedLogs.push(e.name);
      }
      if (logOpen.get(e.name)) {
        docs.append(e.name, e.v);
        done.log += 1;
      }
    }
  });
  flushItems();
  await docs.flush();
  return { ...seen, dryRun: false, done };
}

/* ============================================================================ the service */

class Vault {
  /**
   * @param docs      the record store
   * @param dataDir   server/data: backups are kept in its "backups" folder
   * @param recorder  the market recorder (status(), csv(date), _index()), optional
   */
  constructor({ docs, dataDir, recorder = null, now = () => Date.now(), log = console }) {
    this.docs = docs;
    this.dir = path.join(dataDir, "backups");
    this.recorder = recorder;
    this.now = now;
    this.log = log;
    this._job = null;
    this._rev = 0;
    this.lastError = "";
  }

  settings() {
    const s = this.docs.read(SETTINGS, null) || {};
    return {
      auto: s.auto !== false && DEFAULTS.auto,
      keep: Number.isInteger(s.keep) && s.keep >= 1 && s.keep <= 30 ? s.keep : DEFAULTS.keep,
    };
  }

  setSettings(input = {}) {
    const cur = this.settings();
    const next = {
      auto: typeof input.auto === "boolean" ? input.auto : cur.auto,
      keep: Number.isInteger(input.keep) && input.keep >= 1 && input.keep <= 30 ? input.keep : cur.keep,
    };
    this.docs.write(SETTINGS, next);
    this._rev += 1;
    this._prune();
    return next;
  }

  fingerprint() {
    const l = this.list();
    return `${this._rev}|${l.length}|${l[0] ? l[0].file : ""}|${this._job ? `${this._job.startedAt}|${this._job.finishedAt || ""}` : ""}`;
  }

  /* --------------------------------------------------------------------------- backups */
  /** The backups on the server's disk, newest first. */
  list() {
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => FILE_RE.test(f));
    } catch (_) {
      return [];
    }
    return files
      .map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        // when it was made is in its name (India time): a copied or touched file keeps its true age
        const m = /(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})/.exec(f);
        return {
          file: f,
          bytes: st.size,
          at: new Date(Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}+05:30`)).toISOString(),
        };
      })
      .sort((a, b) => (a.file < b.file ? 1 : -1));
  }

  /** The full path of a backup, or null when the name is not one of ours (nothing else can be read through this). */
  pathOf(file) {
    if (!FILE_RE.test(String(file))) return null;
    const p = path.join(this.dir, file);
    return fs.existsSync(p) ? p : null;
  }

  remove(file) {
    const p = this.pathOf(file);
    if (!p) return false;
    fs.unlinkSync(p);
    this._rev += 1;
    return true;
  }

  _prune() {
    const keep = this.settings().keep;
    for (const b of this.list().slice(keep)) {
      try {
        fs.unlinkSync(path.join(this.dir, b.file));
      } catch (_) {
        /* already gone */
      }
    }
  }

  /** Make a backup now. One at a time. Resolves with { file, bytes, counts }. */
  backup({ trigger = "you asked" } = {}) {
    if (this._job && !this._job.finishedAt) return this._job.promise;
    const now = this.now();
    const stamp = istStamp(now);
    const file = `drishtiai-backup-${stamp.slice(0, 10)}-${stamp.slice(11, 19).replace(/:/g, "")}.ndjson.gz`;
    fs.mkdirSync(this.dir, { recursive: true });
    const job = {
      trigger,
      file,
      startedAt: iso(now),
      finishedAt: null,
      error: "",
      bytes: 0,
      counts: null,
    };
    this._job = job;
    this._rev += 1;
    job.promise = writeBackup(this.docs, path.join(this.dir, file), { now })
      .then((r) => {
        job.bytes = r.bytes;
        job.counts = r.counts;
        this.lastError = "";
        this._prune();
        this.log.log(`[vault] backup ${file}: ${Math.round(r.bytes / 1024)} KB (${r.counts.doc} records, ${r.counts.item} list items, ${r.counts.cold} recorded sessions, ${r.counts.log} log entries) — ${trigger}`);
        return { file, bytes: r.bytes, counts: r.counts };
      })
      .catch((err) => {
        job.error = err.message || String(err);
        this.lastError = `${iso(this.now())} ${job.error}`;
        this.log.error(`[vault] backup failed: ${job.error}`);
        throw err;
      })
      .finally(() => {
        job.finishedAt = iso(this.now());
        this._rev += 1;
      });
    job.promise.catch(() => {});
    return job.promise;
  }

  /** For the supervisor: why a backup is due, or "". */
  due() {
    if (!this.settings().auto) return "";
    if (this._job && !this._job.finishedAt) return "";
    const last = this.list()[0];
    if (!last) return "no backup has been made yet";
    return this.now() - Date.parse(last.at) > STALE_MS ? `the newest backup is from ${last.at.slice(0, 10)}` : "";
  }

  /* --------------------------------------------------------------------------- downloads */
  items(name) {
    if (!NAME_RE.test(String(name))) return null;
    return this.docs.items(name);
  }

  collectionCsv(name) {
    const items = this.items(name);
    if (!items || name === "robot_history") return null; // the price history has its own, streamed, downloads
    return toCsv(items);
  }

  /** The stored price history: the stocks held, and one stock's bars as a spreadsheet (null when it is not stored). */
  historySymbols() {
    return this.docs
      .items("robot_history")
      .map((r) => r.id)
      .sort();
  }

  historyCsv(symbol, header = true) {
    const rec = this.docs.items("robot_history").find((r) => r.id === symbol);
    return rec ? barsCsv(symbol, unpack(rec), header) : null;
  }

  /** A record as it is stored: { type, body } or null. The accounts-and-settings record is not served one by one. */
  doc(name) {
    if (!DOC_RE.test(String(name)) || name.includes("..") || PRIVATE_DOC.test(name)) return null;
    const v = this.docs.read(name, undefined);
    if (v === undefined || v === null) return null;
    return name.endsWith(".md")
      ? { type: "text/markdown; charset=utf-8", body: String(v) }
      : {
          type: "application/json; charset=utf-8",
          body: JSON.stringify(v, null, 1),
        };
  }

  log_(name) {
    if (!Object.keys(LOGS).includes(name)) return null;
    return this.docs
      .tail(name, 1e9)
      .map((v) => JSON.stringify(v))
      .join("\n");
  }

  /** Everything that can be downloaded, grouped, with how much there is of each. */
  async datasets() {
    const out = [];
    const kb = (n) => Math.round(n / 1024);
    // the recorded tape
    if (this.recorder) {
      const st = this.recorder.status();
      out.push({
        id: "tape",
        group: "Recorded market data",
        title: "Recorded tape: every stock, every minute",
        what: st.what,
        rows: st.stored.sessions,
        unit: "sessions",
        kb: st.stored.kb,
        links: st.stored.sessions
          ? [
              {
                label: "All sessions (CSV, compressed)",
                href: "/api/admin/vault/tape.csv.gz",
              },
            ]
          : [],
        days: st.days.map((d) => ({
          date: d.date,
          minutes: d.taken,
          kb: d.kb,
          href: `/api/admin/vault/tape/${d.date}`,
        })),
      });
    }
    // every list
    const names = new Set(Object.keys(LISTS));
    try {
      const { COLLECTIONS } = require("./docs");
      COLLECTIONS.forEach((n) => names.add(n));
    } catch (_) {
      /* the known ones stand */
    }
    for (const name of names) {
      const items = this.docs.items(name);
      const info = LISTS[name] || {
        group: "Other records",
        title: name,
        what: "",
      };
      if (name === "robot_history") {
        const bars = items.reduce((a, r) => a + (r.n || 0), 0);
        out.push({
          id: name,
          group: info.group,
          title: info.title,
          what: info.what,
          rows: bars,
          unit: "bars",
          kb: kb(items.reduce((a, r) => a + (r.z ? r.z.length : 0), 0)),
          stocks: items.map((r) => r.id).sort(),
          links: items.length
            ? [
                {
                  label: "All stocks (CSV, compressed)",
                  href: "/api/admin/vault/history.csv.gz",
                },
              ]
            : [],
        });
        continue;
      }
      out.push({
        id: name,
        group: info.group,
        title: info.title,
        what: info.what,
        rows: items.length,
        unit: "records",
        kb: null,
        links: items.length
          ? [
              {
                label: "CSV",
                href: `/api/admin/vault/collection/${name}?format=csv`,
              },
              {
                label: "JSON",
                href: `/api/admin/vault/collection/${name}?format=json`,
              },
            ]
          : [],
      });
    }
    // every record (document) and log
    const seen = new Set();
    await this.docs.dump(
      async (e) => {
        if (e.kind === "log") {
          const key = `log:${e.name}`;
          const cur = seen.has(key) ? out.find((x) => x.id === key) : null;
          if (cur) cur.rows += 1;
          else {
            seen.add(key);
            out.push({
              id: key,
              group: "Other records",
              title: e.name === "trading/audit" ? "Trading audit log" : `Log: ${e.name}`,
              what: "",
              rows: 1,
              unit: "entries",
              kb: null,
              links: [
                {
                  label: "JSON lines",
                  href: `/api/admin/vault/log?name=${encodeURIComponent(e.name)}`,
                },
              ],
            });
          }
        } else if (e.kind === "doc" && !PRIVATE_DOC.test(e.name) && DOC_RE.test(e.name)) {
          const info = DOCS[e.name] || {
            group: "Other records",
            title: e.name,
            what: "",
          };
          const size = typeof e.v === "string" ? e.v.length : JSON.stringify(e.v).length;
          out.push({
            id: `doc:${e.name}`,
            group: info.group,
            title: info.title,
            what: info.what,
            name: e.name,
            rows: 1,
            unit: "record",
            kb: Math.max(1, kb(size)),
            links: [
              {
                label: e.name.endsWith(".md") ? "Text" : "JSON",
                href: `/api/admin/vault/doc?name=${encodeURIComponent(e.name)}`,
              },
            ],
          });
        }
      },
      { light: true },
    );
    return GROUPS.map((g) => ({
      group: g,
      items: out.filter((x) => x.group === g).sort((a, b) => (a.title < b.title ? -1 : 1)),
    })).filter((g) => g.items.length);
  }

  status() {
    const list = this.list();
    return {
      settings: this.settings(),
      backups: list.map((b) => ({
        ...b,
        href: `/api/admin/vault/backups/${b.file}`,
      })),
      last: list[0] || null,
      totalKb: Math.round(list.reduce((a, b) => a + b.bytes, 0) / 1024),
      where: "on the server's disk (data/backups)",
      store: this.docs.kind || "files",
      job: this._job
        ? {
            trigger: this._job.trigger,
            file: this._job.file,
            startedAt: this._job.startedAt,
            finishedAt: this._job.finishedAt,
            error: this._job.error,
            bytes: this._job.bytes,
            counts: this._job.counts,
          }
        : null,
      restore: "A restore is done with the server stopped, from a terminal on it:  node server/restore.js data/backups/<file>   (add --dry-run to see what a file holds without changing anything).",
      holds:
        "Everything in the database: every record, list and log, and every recorded session. Your settings and accounts are in it too — the secrets inside stay encrypted and the key files are not in the backup — so keep the file private. Caches that download again and the temple's audio are left out.",
      error: this.lastError,
    };
  }
}

module.exports = {
  Vault,
  writeBackup,
  restore,
  inspect,
  toCsv,
  flatten,
  barsCsv,
  FILE_RE,
  SETTINGS,
  LISTS,
  FORMAT,
};
