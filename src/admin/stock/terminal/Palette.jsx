// The command palette: one box for everything. Ctrl K (or ⌘ K) from anywhere.
//
//   a workspace or an action    "adv", "theme", "dock"
//   any stock                   "sbin", "hdfc bank"          → opens it on the Desk
//   a trade                     "buy sbin 10", "s infy 5 @ 1500"  → opens the order ticket
//   a price alert               "alert sbin 800", "alert infy below 1450"
//
// A typed trade only ever opens the ticket: nothing is sent until it is confirmed there,
// and only while the trading switch is on.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, peek } from "../../api";
import { useTrade } from "../trade/TradeContext";
import { useAlerts } from "./AlertsContext";
import { parseAlert, parseCommand, rank } from "./paletteMath";

export default function Palette({ views, actions, onView, onOpenStock, onClose }) {
  const trade = useTrade();
  const alerts = useAlerts();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [found, setFound] = useState([]);
  const [error, setError] = useState("");
  const input = useRef(null);
  const list = useRef(null);
  const watch = useMemo(() => {
    const s = peek("/api/admin/market/status", 60 * 60 * 1000);
    return s && Array.isArray(s.watchlist) ? s.watchlist : [];
  }, []);

  useEffect(() => {
    if (input.current) input.current.focus();
  }, []);

  const cmd = useMemo(() => parseCommand(q), [q]);
  const al = useMemo(() => parseAlert(q), [q]);
  const term = cmd || al ? "" : q.trim();

  // any NSE stock, from the server's instrument list
  useEffect(() => {
    if (term.length < 2) {
      setFound([]);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      api(`/api/admin/market/search?q=${encodeURIComponent(term)}`)
        .then((d) => alive && setFound(d.results || []))
        .catch(() => alive && setFound([]));
    }, 160);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [term]);

  const items = useMemo(() => {
    const out = [];
    if (cmd) {
      const off = !trade ? "Trading is for the account owner." : !trade.connected ? "Zerodha is not connected." : !trade.enabled ? "Trading is switched OFF. Turn it on in Positions." : "";
      out.push({
        id: "trade",
        group: "Trade",
        label: `${cmd.side === "BUY" ? "Buy" : "Sell"} ${cmd.quantity ? `${cmd.quantity} ` : ""}${cmd.symbol}${cmd.price ? ` at ₹${cmd.price}` : ""}`,
        hint: off || "Opens the order ticket. You confirm before anything is sent.",
        disabled: Boolean(off),
        run: () => trade.openTicket({ symbol: cmd.symbol, exchange: "NSE", side: cmd.side, quantity: cmd.quantity || undefined, price: cmd.price || undefined }),
      });
    }
    if (al && alerts) {
      out.push({
        id: "alert",
        group: "Alert",
        label: `Tell me when ${al.symbol} ${al.dir === "above" ? "rises to" : al.dir === "below" ? "falls to" : "reaches"} ₹${al.price}`,
        hint: "A sound and a note on this page when the price gets there.",
        keep: true,
        run: () => alerts.add(al),
      });
    }
    const base = [
      ...views.map((v, i) => ({ id: `v:${v.id}`, group: "Go to", label: v.label, keywords: v.tip, kbd: String(i + 1), run: () => onView(v.id) })),
      ...actions.map((a) => ({ group: "Do", ...a })),
      ...watch.map((s) => ({ id: `s:${s}`, group: "Watchlist", label: s, keywords: "stock open desk", run: () => onOpenStock(s) })),
    ];
    if (!cmd && !al) out.push(...(term ? rank(base, term, 10) : base.slice(0, views.length + actions.length)));
    for (const r of found) {
      if (watch.includes(r.symbol) || out.some((x) => x.id === `s:${r.symbol}`)) continue;
      out.push({ id: `r:${r.symbol}`, group: "NSE", label: r.symbol, hint: r.name, run: () => onOpenStock(r.symbol) });
    }
    return out.slice(0, 18);
  }, [cmd, al, term, found, views, actions, watch, trade, alerts, onView, onOpenStock]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    const el = list.current && list.current.querySelector('[aria-selected="true"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const run = async (it) => {
    if (!it || it.disabled) return;
    setError("");
    try {
      await it.run();
      onClose();
    } catch (e) {
      setError(e.message || "That did not work.");
    }
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[idx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="tr-modal tm-pal" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tm-pal__box">
        <div className="tm-pal__in">
          <span aria-hidden="true">⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="A stock, a workspace, “buy sbin 10”, “alert infy 1500”…"
            role="combobox"
            aria-expanded="true"
            aria-controls="tm-pal-list"
            aria-activedescendant={items[idx] ? `tm-pal-${idx}` : undefined}
            aria-label="Search or type a command"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="tm-pal__list" id="tm-pal-list" role="listbox" ref={list}>
          {items.length === 0 && <li className="tm-pal__none">{term.length >= 2 ? "Nothing matches. Stocks are searched once Zerodha is connected." : "Type to search."}</li>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : "";
            lastGroup = it.group;
            return (
              <React.Fragment key={it.id}>
                {head && (
                  <li className="tm-pal__group" role="presentation">
                    {head}
                  </li>
                )}
                <li id={`tm-pal-${i}`} role="option" aria-selected={i === idx} aria-disabled={it.disabled || undefined} className={it.disabled ? "is-off" : ""} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
                  <span>
                    <b>{it.label}</b>
                    {it.hint && <small>{it.hint}</small>}
                  </span>
                  {it.kbd && <kbd>{it.kbd}</kbd>}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        {error && (
          <p className="tr-note is-bad" role="alert">
            {error}
          </p>
        )}
        <footer className="tm-pal__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>buy sbin 10 · sell infy 5 @ 1500 · alert tcs 4000</span>
        </footer>
      </div>
    </div>
  );
}
