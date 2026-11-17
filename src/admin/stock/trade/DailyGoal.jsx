// The daily goal on screen: today's target (3% of the morning's available margin), the daily stop,
// and the guard against giving profits back — always in the terminal's top bar, as a live banner and
// sound when a reminder is raised, and in full (with its settings) on the Positions view.
//
// The numbers and reminders come from the server (server/trading/discipline.js), which also checks
// them every 15 seconds with no page open and messages Telegram / WhatsApp. Nothing here places an
// order: the reminders tell the trader what happened and what to do.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { GearButton } from "../../ui";
import { everyVisible } from "../../visible";
import { bookStore, useLiveGoal } from "./liveBook";
import "./goal.css";

const rs = (x) => `₹${Math.round(Math.abs(Number(x) || 0)).toLocaleString("en-IN")}`;
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${rs(x)}`;
const MUTE_KEY = "vpt.goal.mute";
const SNOOZE_KEY = "vpt.goal.snooze";
const ALERTING = new Set(["giveback", "red-after-green", "stop-hit"]);

const read = (k, d) => {
  try {
    const v = window.localStorage.getItem(k);
    return v === null ? d : JSON.parse(v);
  } catch (_) {
    return d;
  }
};
const write = (k, v) => {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {
    /* kept for this visit only */
  }
};

/** A short sound for a new reminder: falling for danger, rising for the target, two notes otherwise. */
export function chime(level) {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    const tones = level === "danger" ? [660, 440, 660, 440] : level === "success" ? [523, 659, 784] : [880, 660];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.17);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch (_) {
    /* no sound on this device */
  }
}

const calm = (g) => JSON.stringify({ ...g, pnl: 0, progressPct: 0, peak: 0, at: 0 });
const sameBut = (a, b) => calm(a) === calm(b);

/**
 * Today's goal. The server pushes each new standing over the trading stream the moment it is worked
 * out (every 5 seconds in market hours, on the live P&L) — `push` takes it; a read every minute while
 * the tab is in view (and at once when it is shown again) is only the fallback. New reminders go to
 * `onEvent` once each, with a sound unless muted and a desktop notification when the tab is in the
 * background and the browser allows it.
 */
export function useDailyGoal(enabled, onEvent, every = 60000) {
  const [goal, setGoal] = useState(null);
  const seen = useRef(null); // ids of reminders already told (null until the first read)
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const on = useRef(enabled);
  on.current = enabled;
  const take = useCallback((g) => {
    if (!on.current || !g) return g;
    // a standing that differs only in the P&L figures (which the live book already shows) keeps the
    // same object, so the page is not redrawn every few seconds for nothing
    setGoal((cur) => {
      const book = bookStore.get();
      return cur && book && book.available && sameBut(cur, g) ? cur : g;
    });
    const events = g.events || [];
    if (seen.current === null) {
      seen.current = new Set(events.map((e) => e.id)); // what happened before the page opened is not re-told
      return g;
    }
    const fresh = events.filter((e) => !seen.current.has(e.id)).reverse();
    for (const e of fresh) {
      seen.current.add(e.id);
      if (!read(MUTE_KEY, false)) chime(e.level);
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState === "hidden") new Notification(e.title, { body: e.text, tag: e.kind });
      } catch (_) {
        /* no desktop notifications here */
      }
      if (cb.current) cb.current(e);
    }
    return g;
  }, []);
  const load = useCallback(
    () =>
      api("/api/admin/trading/discipline")
        .then(take)
        .catch(() => null),
    [take]
  );
  useEffect(() => {
    if (!enabled) {
      setGoal(null);
      seen.current = null;
      return undefined;
    }
    load();
    return everyVisible(load, every);
  }, [enabled, load, every]);
  return { goal, reload: load, push: take };
}

/** −stop … 0 … +target on one line: today's P&L, the day's best and the amount to keep. */
export function GoalBar({ g, compact = false }) {
  const lo = -g.stop;
  const hi = g.target;
  const at = (x) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
  const zero = at(0);
  const now = Math.max(lo, Math.min(hi, g.pnl));
  const fillLeft = now >= 0 ? zero : at(now);
  const fillWidth = `calc(${now >= 0 ? at(now) : zero} - ${fillLeft})`;
  return (
    <div className={`dg-bar ${compact ? "dg-bar--compact" : ""}`} role="img" aria-label={`Today ${signed(g.pnl)}: stop ${rs(g.stop)}, target ${rs(g.target)}${g.peak > 0 ? `, best ${signed(g.peak)}` : ""}`}>
      <div className="dg-bar__track">
        <span className={`dg-bar__fill ${g.pnl >= 0 ? "is-up" : "is-down"}`} style={{ left: fillLeft, width: fillWidth }} />
        <i className="dg-bar__zero" style={{ left: zero }} />
        {g.floor > 0 && <i className="dg-bar__floor" style={{ left: at(g.floor) }} title={`Keep at least ${rs(g.floor)}`} />}
        {g.peak > 0 && <i className="dg-bar__peak" style={{ left: at(Math.min(g.peak, hi)) }} title={`Today's best ${signed(g.peak)}`} />}
      </div>
      {!compact && (
        <div className="dg-bar__ends">
          <span>stop −{rs(g.stop)}</span>
          <span>0</span>
          <span>target +{rs(g.target)}</span>
        </div>
      )}
    </div>
  );
}

const toneOf = (g) => (!g || !g.available ? "flat" : g.state === "target-hit" ? "success" : g.level === "danger" ? "danger" : g.level === "warning" ? "warning" : g.pnl > 0 ? "up" : g.pnl < 0 ? "down" : "flat");

/** The top bar's pill: today's P&L against the target, always in view. */
export function GoalPill({ goal: given, onClick }) {
  const goal = useLiveGoal(given); // the P&L moves with every tick, between the server's readings
  if (!goal || !goal.available || !goal.enabled) return null;
  const t = toneOf(goal);
  return (
    <button type="button" className={`tm-pill tm-pill--btn dg-pill dg-pill--${t}`} onClick={onClick} data-tip={`Daily goal: target ${rs(goal.target)} (${goal.config.targetPct}% of ${rs(goal.base)} available margin), stop ${rs(goal.stop)}. ${goal.title}. ${goal.action}`}>
      <span className="dg-pill__k">{goal.state === "target-hit" ? "🎯" : goal.level === "danger" ? "🛑" : goal.level === "warning" ? "⚠" : "Goal"}</span>
      <b>
        {signed(goal.pnl)}
        <span className="tm-x"> / {rs(goal.target)}</span>
      </b>
      <span className="dg-pill__bar" aria-hidden="true">
        <i style={{ width: `${Math.max(0, Math.min(100, goal.progressPct))}%` }} />
      </span>
    </button>
  );
}

/** The live banner under the top bar while a reminder holds; "Got it" quiets it until it repeats. */
export function GoalBanner({ goal, onOpen }) {
  const [snooze, setSnooze] = useState(() => read(SNOOZE_KEY, {}));
  const [compact, setCompact] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef(null);
  const pos = (goal && goal.positions) || [];
  const show = Boolean(goal && goal.available && goal.enabled && (ALERTING.has(goal.state) || (goal.state === "target-hit" && goal.open > 0) || goal.state === "near-target" || pos.length > 0));
  const key = goal ? `${goal.day}:${goal.state}:${pos.map((p) => p.key).join(",")}` : "";
  const until = snooze[key];
  const visible = show && !(until && Date.now() < until);
  // the strip shrinks to one line once the page is scrolled, and tells the page how tall it is (--dg-h) so
  // anything else that sticks under the top bar can sit below it instead of behind it
  useEffect(() => {
    if (!visible) return undefined;
    const onScroll = () => setCompact(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [visible]);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!visible || !el) {
      root.style.removeProperty("--dg-h");
      return undefined;
    }
    const set = () => root.style.setProperty("--dg-h", `${el.offsetHeight}px`);
    set();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(set);
      ro.observe(el);
    }
    return () => {
      if (ro) ro.disconnect();
      root.style.removeProperty("--dg-h");
    };
  }, [visible, compact]);
  if (!visible) return null;
  const quiet = () => {
    const next = { [key]: Date.now() + (goal.config.repeatMin || 10) * 60000 };
    setLeaving(true);
    window.setTimeout(() => {
      setSnooze(next);
      write(SNOOZE_KEY, next);
      setLeaving(false);
    }, 220);
  };
  const dayLevel = goal.state !== "ok" && goal.state !== "protect";
  const head = dayLevel ? goal.title : pos.length === 1 ? `${pos[0].symbol} is giving back its gain` : `${pos.length} positions are giving back their gains`;
  const body = dayLevel ? `${goal.text} ${goal.action}${pos.length ? ` Also: ${pos.map((p) => p.text).join(" ")}` : ""}` : pos.map((p) => p.text).join(" ");
  const t = dayLevel ? toneOf(goal) : "warning";
  return (
    <div ref={ref} className={`dg-banner dg-banner--${t} ${compact ? "is-compact" : ""} ${leaving ? "is-leaving" : ""}`} role="alert">
      <div className="dg-banner__main" title={compact ? `${head}. ${body}` : undefined}>
        <b>{head}</b>
        <span>{body}</span>
      </div>
      <div className="dg-banner__act">
        {onOpen && (
          <button type="button" className="adm-btn adm-btn--sm" onClick={onOpen}>
            Open positions
          </button>
        )}
        <button type="button" className="adm-btn adm-btn--sm adm-btn--ghost" onClick={quiet} data-tip={`Hide this for ${goal.config.repeatMin || 10} minutes. It comes back if it still holds.`}>
          Got it
        </button>
      </div>
    </div>
  );
}

const FIELDS = [
  ["targetPct", "Daily target", "% of margin", 0.25, 20, 0.25, "Stop trading for the day when today's P&L reaches this share of the morning's available margin."],
  ["stopPct", "Daily stop", "% of margin", 0.25, 20, 0.25, "Stop trading for the day when today's loss reaches this share of the margin. Half the target keeps a 2 : 1 balance."],
  ["protectFromPct", "Protect profits from", "% of margin", 0.1, 20, 0.1, "Once the day has been up this much, the guard against giving profits back starts."],
  ["keepPct", "Keep at least", "% of the day's best", 10, 95, 5, "Below this share of the day's best P&L, a reminder to book and stop."],
  ["posGivebackPct", "Position giveback", "% of its best gain", 10, 95, 5, "An open position that gives back this share of its best gain raises a reminder with a stop price that keeps the rest."],
  ["posMinGain", "Position gain worth guarding", "₹", 0, 10000000, 100, "Smaller gains are noise and raise no reminder."],
  ["repeatMin", "Repeat a reminder after", "minutes", 2, 120, 1, "A reminder that still holds is raised again after this long — on screen and on your phone."],
];

/** The full card on the Positions view: where today stands, what to do, and the settings. */
export function DailyGoalCard({ goal: given, onSaved }) {
  const goal = useLiveGoal(given);
  const cfg = goal && goal.config;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => read(MUTE_KEY, false));
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"));
  useEffect(() => {
    if (cfg && !open) setForm({ ...cfg });
  }, [cfg, open]);
  if (!goal) return null;
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/trading/discipline", { method: "PUT", body: form });
      setOpen(false);
      if (onSaved) onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const g = goal;
  const t = toneOf(g);
  return (
    <section className={`an-card dg dg--${t}`} aria-label="Daily goal">
      <header className="dg__head">
        <div>
          <h3>Daily goal and profit protection</h3>
          <p>{g.available ? `Target ${rs(g.target)} · stop ${rs(g.stop)} — ${g.config.targetPct}% and ${g.config.stopPct}% of ${rs(g.base)}, the available margin at the open.` : g.reason}</p>
        </div>
        <div className="dg__tools">
          <GearButton label={open ? "Close settings" : "Settings"} tip="The daily goal’s settings: target, stop, lock and reminders." open={open} onClick={() => setOpen((o) => !o)} />
        </div>
      </header>
      {g.available && g.enabled && (
        <>
          <div className="dg__now">
            <div className="dg__state">
              <span className={`dg__badge dg__badge--${t}`}>{g.state === "target-hit" ? "TARGET HIT" : g.state === "stop-hit" ? "STOP HIT" : g.state === "giveback" ? "GIVING BACK" : g.state === "red-after-green" ? "GREEN → RED" : g.state === "near-target" ? "NEAR TARGET" : g.state === "protect" ? "PROTECT" : "ON PLAN"}</span>
              <div>
                <b>{g.title}</b>
                <p>{g.text}</p>
                <p className="dg__action">{g.action}</p>
              </div>
            </div>
            <dl className="dg__nums">
              <div>
                <dt>Today</dt>
                <dd className={g.pnl > 0 ? "is-up" : g.pnl < 0 ? "is-down" : ""}>{signed(g.pnl)}</dd>
              </div>
              <div>
                <dt>Best today</dt>
                <dd>{signed(g.peak)}</dd>
              </div>
              <div>
                <dt>Keep at least</dt>
                <dd>{g.floor ? rs(g.floor) : `from +${rs(g.protectFrom)}`}</dd>
              </div>
              <div>
                <dt>Of the target</dt>
                <dd>{g.progressPct}%</dd>
              </div>
            </dl>
          </div>
          <GoalBar g={g} />
          {g.positions.length > 0 && (
            <ul className="dg__pos">
              {g.positions.map((p) => (
                <li key={p.key}>{p.text}</li>
              ))}
            </ul>
          )}
          {g.events.length > 0 && (
            <details className="dg__log">
              <summary>Today's reminders ({g.events.length})</summary>
              <ol>
                {g.events.map((e) => (
                  <li key={e.id} className={`dg__ev dg__ev--${e.level}`}>
                    <time>{new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</time>
                    <span>
                      <b>{e.title}</b> {e.text}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {g.available && !g.enabled && <p className="adm-alert adm-alert--info">The daily goal is switched off. Turn it on in Settings.</p>}
      {open && form && (
        <div className="dg__set">
          <div className="dg__grid">
            {FIELDS.map(([k, label, unit, min, max, step, tip]) => (
              <label key={k} className="tr-field" data-tip={tip}>
                <span>
                  {label} <small>({unit})</small>
                </span>
                <input type="number" inputMode="decimal" min={min} max={max} step={step} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="dg__checks">
            <label className="tr-check">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Daily goal on
            </label>
            <label className="tr-check" data-tip="Send each reminder to Telegram and WhatsApp too, when they are set up under Settings.">
              <input type="checkbox" checked={form.notify} onChange={(e) => setForm((f) => ({ ...f, notify: e.target.checked }))} /> Remind me on my phone
            </label>
            <label className="tr-check" data-tip="Copy today's target and stop into the risk guard: once either is reached, NEW trades are refused until tomorrow. Exits always go through. Nothing is sold for you.">
              <input type="checkbox" checked={form.applyToGuard} onChange={(e) => setForm((f) => ({ ...f, applyToGuard: e.target.checked }))} /> Lock new trades at the target and the stop
            </label>
            <label className="tr-check">
              <input
                type="checkbox"
                checked={!muted}
                onChange={(e) => {
                  setMuted(!e.target.checked);
                  write(MUTE_KEY, !e.target.checked);
                }}
              />{" "}
              Sound on this device
            </label>
            {perm !== "unsupported" && perm !== "granted" && (
              <button type="button" className="adm-btn adm-btn--sm" onClick={() => Notification.requestPermission().then(setPerm)} disabled={perm === "denied"} data-tip="Show reminders as desktop notifications while this tab is in the background.">
                {perm === "denied" ? "Desktop alerts blocked in the browser" : "Allow desktop alerts"}
              </button>
            )}
          </div>
          {err && <p className="adm-alert adm-alert--error">{err}</p>}
          <div className="dg__save">
            <button type="button" className="adm-btn adm-btn--solid" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save the daily goal"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A small self-reading chip (TradeAI's header), for pages outside the terminal. */
export function GoalChip() {
  // outside the terminal there is no trading stream: this chip reads by itself, every 15 s in view
  const { goal } = useDailyGoal(true, undefined, 15000);
  if (!goal || !goal.available || !goal.enabled) return null;
  const t = toneOf(goal);
  return (
    <span className={`dg-chip dg-chip--${t}`} data-tip={`${goal.title}. ${goal.action}`}>
      {goal.state === "target-hit" ? "🎯 " : goal.level === "danger" ? "🛑 " : goal.level === "warning" ? "⚠ " : ""}
      Today <b>{signed(goal.pnl)}</b> / target {rs(goal.target)}
    </span>
  );
}
