import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { inr, isNum, pct, tone } from "./format";
import { useTick } from "./liveTicks";
import { radarLabel, radarOrder, radarScore } from "./radar";

/** Type-ahead over the NSE instrument list. */
export function SymbolSearch({ onPick, disabled, taken = [], id = "wl-q", label = "Add a stock", placeholder = "Add a stock — name or symbol" }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setState("idle");
      return undefined;
    }
    setState("loading");
    let alive = true;
    timer.current = setTimeout(() => {
      api(`/api/admin/market/search?q=${encodeURIComponent(term)}`)
        .then((d) => {
          if (!alive) return;
          setResults(d.results);
          setState("done");
        })
        .catch((e) => {
          if (!alive) return;
          setError(e.message);
          setState("error");
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [q]);

  const pick = (symbol) => {
    onPick(symbol);
    setQ("");
    setResults([]);
  };

  // Enter takes the first match that can be picked; Escape clears the box
  const onKey = (e) => {
    if (e.key === "Enter") {
      const first = results.find((r) => !taken.includes(r.symbol));
      if (first) {
        e.preventDefault();
        pick(first.symbol);
      }
    } else if (e.key === "Escape" && q) {
      e.preventDefault();
      setQ("");
    }
  };

  return (
    <div className="wl__search">
      <label className="adm-sr" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        name="stock-symbol-search"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={`${id}-pop`}
        aria-autocomplete="list"
        value={q}
        onChange={(e) => setQ(notAutofill(e.target.value, q))}
        onKeyDown={onKey}
        placeholder={disabled ? "Connect Zerodha to search stocks" : placeholder}
        disabled={disabled}
        spellCheck="false"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
      />
      <div className="wl__pop" id={`${id}-pop`}>
        {state === "loading" && <p className="adm-small">Searching…</p>}
        {state === "error" && <p className="adm-small is-down">{error}</p>}
        {state === "done" && results.length === 0 && <p className="adm-small">Nothing matches “{q.trim()}”.</p>}
        {results.length > 0 && (
          <ul className="wl__results">
            {results.map((r) => (
              <li key={r.symbol}>
                <button type="button" onClick={() => pick(r.symbol)} disabled={taken.includes(r.symbol)}>
                  <b>{r.symbol}</b>
                  <span>
                    {r.name}
                    {r.kind === "INDEX" ? " · index" : ""}
                    {taken.includes(r.symbol) ? " · already added" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One row. Its price follows the live stream directly, so a tick redraws only this row. */
function WatchRow({ s, q, r, radar, selected, onSelect, onRemove, scanning }) {
  const tick = useTick(s);
  const last = tick && isNum(tick.last) ? tick.last : q ? q.last : r && r.last;
  const chg = tick && isNum(tick.changePct) ? tick.changePct : q ? q.changePct : r && r.changePct;
  const label = radarLabel(radar);
  const flags = r && r.enoughData && (r.triggered.length > 0 || r.bearishToday.length > 0);
  return (
    <li className={selected ? "is-sel" : ""}>
      <button type="button" className="wl__row" onClick={() => onSelect(s)} aria-current={selected ? "true" : undefined} data-tip="Open this stock on the desk.">
        <span className="wl__sym">
          <b>
            {s}
            {label && (
              <i className={`wl__live is-${label}`} title={label === "strong" ? "Strong today: ahead of the Nifty, above VWAP, near its high" : "Weak today: behind the Nifty, below VWAP, near its low"}>
                {label === "strong" ? "▲" : "▼"}
                <span className="adm-sr">{label === "strong" ? " strong today" : " weak today"}</span>
              </i>
            )}
          </b>
          {r && r.enoughData && (
            <small className={r.score >= 20 ? "is-up" : r.score <= -20 ? "is-down" : ""}>
              {r.score > 0 ? `+${r.score}` : r.score} · {r.label}
            </small>
          )}
          {r && !r.enoughData && <small className="is-down">{r.error || "No data"}</small>}
          {!r && scanning && <small>scanning…</small>}
        </span>
        <span className="wl__px">
          <b>{isNum(last) ? inr(last) : "—"}</b>
          <small className={`is-${tone(chg)}`}>{pct(chg)}</small>
        </span>
      </button>
      {(label || flags) && (
        <p className="wl__flags">
          {label && (
            <span className={`an-chip an-chip--${label === "strong" ? "bullish" : "bearish"}`} title="Live: move since the open against the Nifty, distance from VWAP, place in the day's range">
              {label === "strong" ? "▲ Strong today" : "▼ Weak today"} · {radar.score > 0 ? `+${radar.score}` : radar.score}
            </span>
          )}
          {flags &&
            r.triggered.map((t) => (
              <span key={t.id} className="an-chip an-chip--bullish" title="Setup triggered on the latest close">
                ▲ {t.name}
              </span>
            ))}
          {flags &&
            r.bearishToday.map((b) => (
              <span key={b} className="an-chip an-chip--bearish" title="Warning sign on the latest bar">
                ▼ {b}
              </span>
            ))}
        </p>
      )}
      {onRemove && (
        <button type="button" className="wl__rm" onClick={() => onRemove(s)} aria-label={`Remove ${s} from the watchlist`}>
          ×
        </button>
      )}
    </li>
  );
}

const ORDERS = [
  ["mine", "My order"],
  ["strong", "Strongest"],
  ["weak", "Weakest"],
];

/** Several named lists: pick one, make a new one, rename or delete it. The open list is "the watchlist". */
function Lists({ lists, onAction }) {
  const [edit, setEdit] = useState(null); // null | "create" | "rename"
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  if (!lists) return null;
  const cur = lists.lists.find((l) => l.id === lists.active) || lists.lists[0];
  const go = async (body) => {
    setErr("");
    try {
      await onAction(body);
      setEdit(null);
      setName("");
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="wl__lists">
      <div className="wl__lists-row">
        <select value={cur.id} onChange={(e) => go({ action: "open", id: e.target.value })} aria-label="Watchlist">
          {lists.lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.count})
            </option>
          ))}
        </select>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => { setEdit(edit === "create" ? null : "create"); setName(""); }} disabled={lists.lists.length >= lists.max} data-tip="Make a new, empty list and open it.">
          + New
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => { setEdit(edit === "rename" ? null : "rename"); setName(cur.name); }} data-tip="Rename this list." aria-label="Rename this list">
          ✎
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => go({ action: "delete", id: cur.id })} disabled={lists.lists.length <= 1} data-tip="Delete this list (its stocks stay elsewhere if they are on other lists)." aria-label="Delete this list">
          🗑
        </button>
      </div>
      {edit && (
        <form className="wl__lists-row" onSubmit={(e) => { e.preventDefault(); go(edit === "create" ? { action: "create", name } : { action: "rename", id: cur.id, name }); }}>
          <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder={edit === "create" ? "Name, e.g. Swing ideas" : "New name"} aria-label="List name" autoFocus />
          <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm">
            {edit === "create" ? "Create" : "Rename"}
          </button>
        </form>
      )}
      {err && <p className="wl__lists-err">{err}</p>}
    </div>
  );
}

/**
 * What the search box should hold after a change. A browser that mistakes it for a sign-in box pours a saved email into it in
 * one go (seen 24 Nov 2026: "Nothing matches 'name@…'"); a stock name or symbol never has an "@", so such a fill is dropped.
 */
export function notAutofill(next, prev = "") {
  const v = String(next || "");
  return v.includes("@") && v.length - String(prev || "").length > 3 ? prev : v;
}

export default function Watchlist({ symbols, quotes, scan, selected, onSelect, onChange, mode, scanning, onRescan, lists = null, onListAction = null }) {
  const [order, setOrder] = useState("mine");
  const rowFor = (s) => (scan || []).find((r) => r.symbol === s);
  // a live read of each stock against the index: where to look for a long, where for a short
  const nifty = quotes["NIFTY 50"];
  const scores = Object.fromEntries(symbols.map((s) => [s, mode === "kite" ? radarScore(quotes[s], nifty) : null]));
  const hasRadar = symbols.some((s) => scores[s]);
  const shown = hasRadar ? radarOrder(symbols, scores, order) : symbols;
  return (
    <aside className="wl" aria-label="Watchlist">
      <div className="wl__head">
        <h2>Watchlist</h2>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRescan} disabled={scanning || symbols.length === 0}>
          {scanning ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {mode !== "demo" && lists && onListAction && <Lists lists={lists} onAction={onListAction} />}
      {mode !== "demo" && <SymbolSearch onPick={(s) => onChange([...symbols, s])} disabled={mode !== "kite"} taken={symbols} />}

      {hasRadar && (
        <div className="wl__order" role="group" aria-label="Order the watchlist by how each stock is trading right now">
          {ORDERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={order === id} onClick={() => setOrder(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {symbols.length === 0 && (
        <p className="adm-small wl__empty">{mode === "kite" ? "Your watchlist is empty. Search above to add stocks." : "Nothing here yet."}</p>
      )}

      <ul className="wl__list">
        {shown.map((s) => (
          <WatchRow
            key={s}
            s={s}
            q={quotes[s]}
            r={rowFor(s)}
            radar={scores[s]}
            selected={selected === s}
            onSelect={onSelect}
            onRemove={mode !== "demo" ? (x) => onChange(symbols.filter((y) => y !== x)) : null}
            scanning={scanning}
          />
        ))}
      </ul>
    </aside>
  );
}
