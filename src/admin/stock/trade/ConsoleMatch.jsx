// Match with Zerodha Console (24 Nov 2026) — on the Day book. Drop the files Console gives you (the Tradebook and the
// Ledger, .xlsx or .csv, in any order, several at once): each is recognised by its own headers and read — trades go to the
// journal, the ledger gives every other credit and debit and each day's net settlement. The settlement is Zerodha's own
// figure for what a day's trades came to, so every day is then compared with the journal's day: the ones that match say so,
// the ones that differ a little (the charges here are an estimate) are corrected to the ledger — on every page, undoable —
// and the ones that differ a lot are shown for a look (a trade missing from, or extra in, the journal).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useTopics } from "../../live";
import { Alert } from "../../ui";
import { useDialog } from "../../dialog/DialogProvider";
import { isNum, num } from "../analyzer/format";
import { CONSOLE_FILE, uploadConsoleFile } from "./consoleUpload";
import { importSaid } from "./OtherLedger";
import "./console-match.css";

const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const plain = (x) => (isNum(x) ? `₹${num(x)}` : "—");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d || "";
};
const SHOWN = 10;
const KEY = "vpt.consolematch.hidden";
const remembered = () => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch (_) {
    return false;
  }
};

export const STATUS = {
  match: { label: "Matches", tone: "ok", tip: "The journal's day equals Zerodha's ledger (within ₹1)." },
  corrected: { label: "Corrected to match", tone: "ok", tip: "The day's charges were set so its net equals Zerodha's ledger. Undo puts the estimate back." },
  off: { label: "Differs a little", tone: "warn", tip: "Within ₹50: the estimated charges differ from what Zerodha charged. Correct it to take the ledger's figure." },
  check: { label: "Check the trades", tone: "bad", tip: "More than ₹50 apart, or the ledger has a day with no trades here: a trade is probably missing from, or extra in, the journal. Upload that day's tradebook." },
  later: { label: "Not in the ledger yet", tone: "dim", tip: "Zerodha posts a day's settlement after the close; this day is after the ledger's last day." },
  skip: { label: "Not compared", tone: "dim", tip: "Delivery, futures & options or an open position: their settlement is not the day's profit or loss." },
};

/** What one file's answer says, in words. Pure, for the tests. */
export function resultSaid(r) {
  if (!r) return "";
  if (r.type === "tradebook") return `Tradebook: ${r.added} new trade${r.added === 1 ? "" : "s"} added${r.read && r.read !== r.added ? ` (${r.read - r.added} already here)` : ""}${r.fromDay ? `, ${dayText(r.fromDay)} – ${dayText(r.toDay)}` : ""}.`;
  if (r.type === "pnl") return `P&L statement of ${range(r.from, r.to)}: kept as the reference${r.added ? `, ${r.added} other credit${r.added === 1 ? "" : "s"} or debit${r.added === 1 ? "" : "s"} added` : ""}. ${r.corrected ? `Charges set to Console’s on ${r.corrected} day${r.corrected === 1 ? "" : "s"}. ` : ""}${r.compare ? (r.compare.ok ? "Every figure matches the journal." : "Some figures differ: see below.") : ""}`;
  const fixed = r.matched && r.matched.length ? ` ${r.matched.length} day${r.matched.length === 1 ? "" : "s"} corrected to match.` : "";
  return `Ledger: ${r.settledDays || 0} day${r.settledDays === 1 ? "" : "s"} of settlements read. ${importSaid({ ...r, name: "" })}${fixed}`;
}

const HEAD = { brokerage: "Brokerage", stt: "STT / CTT", exchange: "Exchange transaction charges", gst: "GST", sebi: "SEBI turnover fees", stamp: "Stamp duty", dp: "DP charges", other: "Other (IPFT, corrections)" };
const range = (a, b) => `${dayText(a)} – ${dayText(b)}`;

/** One of Console's P&L statements against the journal's same period: the figures, every charge head, every symbol. */
function Statement({ st, busy, onApply, onUndo }) {
  const charges = st.rows.find((r) => r.label === "Charges & taxes");
  const heads = st.heads.every((h) => h.ok);
  const fixable = (charges && !charges.ok) || !heads;
  const bad = st.rows.filter((r) => !r.ok).length + st.symbols.filter((x) => !x.ok).length;
  return (
    <div className="cm-st">
      <header className="cm-st__head">
        <div>
          <h4>Console’s P&amp;L statement · {range(st.from, st.to)}</h4>
          <small className="ta-dim">{st.file ? `${st.file} · ` : ""}{st.trades} closed equity trade{st.trades === 1 ? "" : "s"} here in that period</small>
        </div>
        <span className={`cm-chip cm-chip--${st.ok ? "ok" : fixable && st.rows[0].ok ? "warn" : "bad"}`}>{st.ok ? "Every figure matches" : fixable && st.rows[0].ok ? "Charges differ" : `${bad} figure${bad === 1 ? "" : "s"} differ`}</span>
      </header>
      <div className="cm-wrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th scope="col">Figure</th>
              <th scope="col" className="is-num">
                Console
              </th>
              <th scope="col" className="is-num">
                DrishtiAI
              </th>
              <th scope="col" className="is-num">
                Difference
              </th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {st.rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="is-num">{sMoney(r.console)}</td>
                <td className="is-num">{sMoney(r.app)}</td>
                <td className="is-num">{Math.abs(r.diff) < 0.005 ? "0" : sMoney(r.diff)}</td>
                <td>
                  <span className={`cm-chip cm-chip--${r.ok ? "ok" : "bad"}`}>{r.ok ? "Matches" : "Differs"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cm-bar">
        <p className="ta-dim">
          {fixable ? "The charges are an estimate from Zerodha’s published rates; Console’s are the real ones. Correct them and every head, every trade and every page shows Console’s figures." : st.corrected ? `Charges are Console’s (${st.corrected} day${st.corrected === 1 ? "" : "s"} corrected).` : "Charges already equal Console’s."}
        </p>
        {fixable && (
          <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled={Boolean(busy)} onClick={() => onApply(st)}>
            Correct charges to Console
          </button>
        )}
        {!fixable && st.corrected > 0 && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => onUndo(st)}>
            Undo the correction
          </button>
        )}
      </div>
      <details className="cm-more">
        <summary>Charges head by head</summary>
        <div className="cm-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th scope="col">Head</th>
                <th scope="col" className="is-num">
                  Console
                </th>
                <th scope="col" className="is-num">
                  Estimate
                </th>
                <th scope="col" className="is-num">
                  DrishtiAI now
                </th>
              </tr>
            </thead>
            <tbody>
              {st.heads.map((h) => (
                <tr key={h.head}>
                  <td>{HEAD[h.head] || h.head}</td>
                  <td className="is-num">{plain(h.console)}</td>
                  <td className="is-num">{plain(h.est)}</td>
                  <td className="is-num">{plain(h.app)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="cm-more" open={st.symbols.some((x) => !x.ok)}>
        <summary>Realised P&amp;L by symbol{st.symbols.some((x) => !x.ok) ? " — some differ" : ""}</summary>
        <div className="cm-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="is-num">
                  Console
                </th>
                <th scope="col" className="is-num">
                  DrishtiAI
                </th>
                <th scope="col" className="is-num">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {st.symbols.map((x) => (
                <tr key={x.symbol}>
                  <td>{x.symbol}</td>
                  <td className="is-num">{x.console === null ? "not in Console" : sMoney(x.console)}</td>
                  <td className="is-num">{x.app === null ? "not here" : sMoney(x.app)}</td>
                  <td className="is-num">{x.diff === null ? "—" : Math.abs(x.diff) < 0.005 ? "0" : sMoney(x.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {st.symbols.some((x) => !x.ok) && <p className="ta-dim">A difference in realised P&amp;L means a trade is missing from, or extra in, the journal — not something to correct. Upload that period’s Tradebook.</p>}
      </details>
    </div>
  );
}

export default function ConsoleMatch({ onChanged = () => {} }) {
  const ask = useDialog();
  const input = useRef(null);
  const [rec, setRec] = useState(null);
  const [pnl, setPnl] = useState([]);
  const [kc, setKc] = useState(null); // how far Zerodha's own per-order charges reach
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState("");
  const [drag, setDrag] = useState(false);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(remembered); // collapsed: only the title and the verdict stay
  const toggle = () =>
    setHidden((h) => {
      try {
        window.localStorage.setItem(KEY, h ? "0" : "1");
      } catch (_) {
        /* remembered for this visit only */
      }
      return !h;
    });

  const load = useCallback(
    () =>
      Promise.all([api("/api/admin/trading/journal/reconcile"), api("/api/admin/trading/journal/pnl"), api("/api/admin/trading/journal/charges").catch(() => null)])
        .then(([r, p, c]) => {
          setRec(r);
          setPnl((p && p.statements) || []);
          setKc(c);
        })
        .catch((e) => setErr(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  useTopics(["trading"], load);

  const send = async (list) => {
    setErr("");
    const ok = [...list].filter((f) => CONSOLE_FILE.test(f.name));
    if (ok.length < list.length) setErr(`${list.length - ok.length} file${list.length - ok.length === 1 ? " was" : "s were"} left out: only .xlsx and .csv files from Console can be read.`);
    if (!ok.length) return;
    setBusy("files");
    // a tradebook first, then a ledger: the ledger is compared with trades that are already there
    const order = [...ok].sort((a, b) => Number(/ledger/i.test(a.name)) - Number(/ledger/i.test(b.name)));
    for (const f of order) {
      const key = `${Date.now()}-${f.name}`;
      const upd = (patch) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      setQueue((q) => [{ key, name: f.name, state: "reading", pct: 0, text: "" }, ...q].slice(0, 12));
      try {
        const r = await uploadConsoleFile(f, (pct) => upd({ pct }));
        upd({ state: "done", pct: 100, text: resultSaid(r) });
      } catch (e) {
        upd({ state: "error", text: e.message });
      }
    }
    setBusy("");
    if (input.current) input.current.value = "";
    await load();
    onChanged();
  };
  const apply = async (days) => {
    setBusy("apply");
    setErr("");
    try {
      const r = await api("/api/admin/trading/journal/reconcile/apply", { method: "POST", body: days ? { days } : {} });
      setRec(r.reconcile);
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  const readKite = async () => {
    setBusy("kite");
    setErr("");
    try {
      const r = await api("/api/admin/trading/journal/charges/refresh", { method: "POST", body: {} });
      setKc(r);
      if (r.error) setErr(`Zerodha’s charge calculator: ${r.error}`);
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  const pnlApply = async (st) => {
    setBusy(st.key);
    setErr("");
    try {
      const r = await api(`/api/admin/trading/journal/pnl/${encodeURIComponent(st.key)}/apply`, { method: "POST", body: {} });
      setPnl(r.statements || []);
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  const pnlUndo = async (st) => {
    const yes = await ask({ title: "Take the correction back?", body: `The charges of ${range(st.from, st.to)} go back to the estimate from Zerodha’s published rates.`, confirmText: "Take it back", cancelText: "Keep it" });
    if (!yes) return;
    setBusy(st.key);
    try {
      const r = await api(`/api/admin/trading/journal/pnl/${encodeURIComponent(st.key)}/apply`, { method: "DELETE" });
      setPnl(r.statements || []);
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  const undo = async (x) => {
    const yes = await ask({ title: "Take the correction back?", body: `${dayText(x.date)}: the charges go back to the estimate, so the net is ${sMoney(x.app)} again instead of ${sMoney(x.ledger)}.`, confirmText: "Take it back", cancelText: "Keep it" });
    if (!yes) return;
    setBusy(x.date);
    try {
      const r = await api(`/api/admin/trading/journal/reconcile/${encodeURIComponent(x.date)}`, { method: "DELETE" });
      setRec(r.reconcile);
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const days = rec && rec.days ? [...rec.days].reverse() : [];
  const counts = (rec && rec.counts) || {};
  const shown = all ? days : days.slice(0, SHOWN);
  const fixable = counts.off || 0;
  const bad = counts.check || 0;
  const headline = !days.length && pnl.length ? (pnl[0].ok ? "Matches Console’s P&L" : "Differs from Console’s P&L") : !days.length ? "No ledger read yet" : bad ? `${bad} day${bad === 1 ? "" : "s"} to check` : fixable ? `${fixable} day${fixable === 1 ? "" : "s"} can be corrected` : `All compared days match Zerodha`;

  return (
    <section className="ta-card cm" aria-labelledby="cm-h">
      <header className="cm-head">
        <div>
          <h3 id="cm-h">Match with Zerodha Console</h3>
          <p className="ta-dim">
            Drop the files Console gives you — the <b>Tradebook</b> (Reports → Tradebook), the <b>Ledger</b> (Funds → Statement) and the <b>P&amp;L statement</b> (Reports → P&amp;L), .xlsx or .csv, several at once. Each is recognised by what is in it; trades are added, other credits &amp; debits are read, and every day is compared with Zerodha’s own settlement.
          </p>
        </div>
        <div className="cm-head__side">
          <span className={`cm-chip cm-chip--${bad ? "bad" : fixable ? "warn" : days.length || pnl.length ? "ok" : "dim"}`}>{headline}</span>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm cm-toggle" data-ico="none" aria-expanded={!hidden} aria-controls="cm-body" onClick={toggle}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={hidden ? "" : "is-up"}>
              <path d="M6 9l6 6 6-6" />
            </svg>
            {hidden ? "Show" : "Hide"}
          </button>
        </div>
      </header>

      <div id="cm-body" className="cm-body" hidden={hidden}>

      <div
        className={`cm-drop ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          send(e.dataTransfer.files || []);
        }}
      >
        <input ref={input} type="file" multiple accept=".xlsx,.csv,.txt" hidden onChange={(e) => send(e.target.files || [])} />
        <p>{busy === "files" ? "Reading…" : "Drop Console files here"}</p>
        <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled={Boolean(busy)} onClick={() => input.current && input.current.click()}>
          Choose files to upload
        </button>
      </div>

      {kc && kc.trades > 0 && (
        <div className="cm-kite">
          <p className="ta-dim">
            <b>Charges from Zerodha itself:</b> {kc.kite} of {kc.trades} closed trade{kc.trades === 1 ? "" : "s"} use the figures Kite’s own charge calculator gives for each order (brokerage, STT, exchange and SEBI fees, GST, stamp duty); the rest use Zerodha’s published rates.
            {kc.pending > 0 ? ` ${kc.pending} order${kc.pending === 1 ? " is" : "s are"} still to be priced${kc.connected ? "; this happens by itself every few minutes while Zerodha is connected." : " — connect Zerodha (log in to Kite on the Desk) to read them."}` : ""}
          </p>
          {kc.pending > 0 && kc.connected && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" data-ico="refresh" disabled={Boolean(busy)} onClick={readKite}>
              {busy === "kite" ? "Reading from Kite…" : "Read charges from Kite now"}
            </button>
          )}
        </div>
      )}

      {queue.length > 0 && (
        <ul className="cm-queue" aria-live="polite">
          {queue.map((q) => (
            <li key={q.key} className={`cm-q cm-q--${q.state}`}>
              <b>{q.name}</b>
              <span>{q.state === "reading" ? `Reading… ${q.pct}%` : q.text}</span>
            </li>
          ))}
        </ul>
      )}
      <Alert>{err}</Alert>

      {pnl.slice(0, 3).map((st) => (
        <Statement key={st.key} st={st} busy={busy} onApply={pnlApply} onUndo={pnlUndo} />
      ))}

      {days.length > 0 && (
        <>
          <div className="cm-bar">
            <p className="ta-dim">
              Ledger of {dayText(rec.from)} – {dayText(rec.to)}
              {rec.file ? ` · from ${rec.file}` : ""}. {counts.match || 0} match{counts.corrected ? `, ${counts.corrected} corrected` : ""}
              {fixable ? `, ${fixable} differ a little` : ""}
              {bad ? `, ${bad} to check` : ""}.
            </p>
            {fixable > 0 && (
              <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled={Boolean(busy)} onClick={() => apply(null)}>
                Correct {fixable} day{fixable === 1 ? "" : "s"} to match
              </button>
            )}
          </div>
          <div className="cm-wrap">
            <table className="cm-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="is-num">
                    Zerodha ledger
                  </th>
                  <th scope="col" className="is-num">
                    DrishtiAI net
                  </th>
                  <th scope="col" className="is-num">
                    Difference
                  </th>
                  <th scope="col">Result</th>
                  <th scope="col">
                    <span className="cm-sr">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => {
                  const s = STATUS[x.status] || STATUS.skip;
                  return (
                    <tr key={x.date}>
                      <td>{dayText(x.date)}</td>
                      <td className="is-num">{x.ledger === null ? "—" : sMoney(x.ledger)}</td>
                      <td className="is-num">{x.appNow === null ? "—" : sMoney(x.appNow)}</td>
                      <td className="is-num">{x.status === "corrected" ? `${sMoney(-x.fix)} fixed` : x.diff === null ? "—" : x.status === "match" && Math.abs(x.diff) < 0.005 ? "0" : sMoney(x.diff)}</td>
                      <td>
                        <span className={`cm-chip cm-chip--${s.tone}`} data-tip={s.tip}>
                          {s.label}
                        </span>
                      </td>
                      <td className="is-act">
                        {x.status === "off" && (
                          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => apply([x.date])}>
                            Correct
                          </button>
                        )}
                        {x.status === "corrected" && (
                          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => undo(x)}>
                            Undo
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {days.length > SHOWN && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" data-ico="none" onClick={() => setAll((v) => !v)}>
              {all ? "Show the latest days only" : `Show all ${days.length} days`}
            </button>
          )}
          <p className="ta-dim">
            The ledger’s net settlement is what a day’s trades came to in your account, after every charge. A correction changes only the day’s charges (shared among its trades) and shows in the Journal, the Day book and the calendar; the trades themselves are never changed. Total compared: {plain(days.reduce((a, x) => a + (x.status === "match" || x.status === "corrected" ? Math.abs(x.ledger || 0) : 0), 0))} of settlements.
          </p>
        </>
      )}
      </div>
    </section>
  );
}
