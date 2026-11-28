// Date pickers in the style of Google's Material design, used everywhere in the private area in
// place of the browser's own calendar: an outlined field that opens a rounded calendar card with
// circular days, today ringed, the chosen day filled, a year grid, and Clear / Cancel / OK.
//   DateField       one date            value "YYYY-MM-DD"
//   DateRangeField  a first and last day { from, to } — two months side by side on a wide screen,
//                   the days between them shaded
//   TimeField       hours and minutes   value "HH:MM"
// Keyboard: arrows move a day / week, Page Up / Down a month, Home / End the week, Enter picks,
// Escape closes. On a phone the calendar opens as a sheet from the bottom.

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./datepicker.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? s : "");
const parts = (s) => s.split("-").map(Number);
const todayIso = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (s, n) => {
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
const addMonths = (s, n) => {
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const len = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, len));
};
const weekday = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
/** "12 Nov 2026" */
export const fmtDate = (s) => {
  if (!parse(s)) return "";
  const [y, m, d] = parts(s);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};
const fmtHead = (s) => {
  if (!parse(s)) return "";
  const [, m, d] = parts(s);
  return `${WD_LONG[weekday(s)].slice(0, 3)}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
};

const IconCal = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
const Chevron = ({ dir }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "M15 6l-6 6 6 6" : dir === "right" ? "M9 6l6 6-6 6" : "M7 10l5 5 5-5"} />
  </svg>
);

/** Closes on a click outside (the field and its calendar, wherever the calendar is drawn) or Escape. */
function usePopover(open, onClose, boxRef, popRef) {
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      if (popRef && popRef.current && popRef.current.contains(e.target)) return;
      onClose();
    };
    const key = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onClose, boxRef, popRef]);
}

/* -------------------------------------------------------------------------------- one month */
function Month({ view, sel, range, hover, setHover, min, max, focus, setFocus, onPick, labelId }) {
  const [y, m] = parts(view);
  const first = iso(y, m - 1, 1);
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = weekday(first);
  const today = todayIso();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= len; d += 1) cells.push(iso(y, m - 1, d));
  while (cells.length % 7) cells.push(null);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const lo = range ? range.from : "";
  const hi = range ? range.to || (lo && hover && hover > lo ? hover : "") : "";
  return (
    <table className="dp-grid" role="grid" aria-labelledby={labelId}>
      <thead>
        <tr>
          {WD.map((w, i) => (
            <th key={i} scope="col" abbr={WD_LONG[i]}>
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => {
              if (!c) return <td key={ci} />;
              const off = (min && c < min) || (max && c > max);
              const isSel = c === sel || (range && (c === range.from || c === range.to));
              const inBand = range && lo && hi && c > lo && c < hi;
              const edge = range && lo && hi && (c === lo || c === hi) && lo !== hi ? (c === lo ? "is-start" : "is-end") : "";
              return (
                <td key={ci} className={`${inBand ? "is-band" : ""} ${edge}`} role="gridcell" aria-selected={isSel}>
                  <button
                    type="button"
                    className={`dp-day ${isSel ? "is-sel" : ""} ${c === today ? "is-today" : ""}`}
                    disabled={Boolean(off)}
                    tabIndex={c === focus ? 0 : -1}
                    data-day={c}
                    onClick={() => onPick(c)}
                    onMouseEnter={() => setHover && setHover(c)}
                    onFocus={() => setFocus(c)}
                    aria-label={`${WD_LONG[weekday(c)]}, ${fmtDate(c)}${c === today ? " (today)" : ""}`}
                  >
                    {Number(c.slice(8))}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------- the calendar card */
function Calendar({ mode, value, range, min, max, onDone, onCancel, title }) {
  const asked = mode === "range" ? range.from || range.to || todayIso() : value || todayIso();
  const start = min && asked < min ? min : max && asked > max ? max : asked; // open on a day that can be picked
  const [view, setView] = useState(`${start.slice(0, 7)}-01`);
  const [focus, setFocus] = useState(start);
  const [sel, setSel] = useState(value || "");
  const [r, setR] = useState({ from: range ? range.from || "" : "", to: range ? range.to || "" : "" });
  const [hover, setHover] = useState("");
  const [years, setYears] = useState(false);
  const wide = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(min-width: 720px)").matches;
  const two = mode === "range" && wide;
  const box = useRef(null);
  const labelId = useId();
  const clampDay = useCallback((d) => (min && d < min ? min : max && d > max ? max : d), [min, max]);

  // keep the focused day visible, and move real focus to it
  useEffect(() => {
    const last = two ? addMonths(view, 1) : view;
    if (focus.slice(0, 7) < view.slice(0, 7)) setView(`${focus.slice(0, 7)}-01`);
    else if (focus.slice(0, 7) > last.slice(0, 7)) setView(two ? addMonths(`${focus.slice(0, 7)}-01`, -1) : `${focus.slice(0, 7)}-01`);
  }, [focus, view, two]);
  // real focus follows a keyboard move (also into another month, whose days are drawn a moment later);
  // it is never pulled off the arrows or the other buttons
  const byKey = useRef(false);
  useEffect(() => {
    if (years || !box.current) return;
    const b = box.current.querySelector(`[data-day="${focus}"]`);
    if (!b) return;
    const a = document.activeElement;
    if (a !== b && (byKey.current || (box.current.contains(a) && a.hasAttribute("data-day")))) b.focus();
    byKey.current = false;
  }, [focus, view, years]);
  useEffect(() => {
    const b = box.current && box.current.querySelector(`[data-day="${focus}"]`);
    if (b) b.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (d) => {
    setFocus(d);
    if (mode !== "range") {
      setSel(d);
      return;
    }
    if (!r.from || (r.from && r.to)) setR({ from: d, to: "" });
    else if (d < r.from) setR({ from: d, to: r.from });
    else setR({ from: r.from, to: d });
  };
  const key = (e) => {
    const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = null;
    if (map[e.key] !== undefined) next = addDays(focus, map[e.key]);
    else if (e.key === "PageUp") next = addMonths(focus, e.shiftKey ? -12 : -1);
    else if (e.key === "PageDown") next = addMonths(focus, e.shiftKey ? 12 : 1);
    else if (e.key === "Home") next = addDays(focus, -weekday(focus));
    else if (e.key === "End") next = addDays(focus, 6 - weekday(focus));
    if (next) {
      e.preventDefault();
      const to = clampDay(next);
      byKey.current = to !== focus;
      setFocus(to);
    }
  };
  // The arrows turn the page and take the keyboard's day with it. Left behind in the old month, that
  // day made the "keep it visible" rule above turn the page straight back.
  const turn = (n) => {
    setView(addMonths(view, n));
    setFocus(clampDay(addMonths(focus, n)));
  };
  const [vy, vm] = parts(view);
  const thisYear = Number(todayIso().slice(0, 4));
  const yMin = min ? Number(min.slice(0, 4)) : thisYear - 30;
  const yMax = max ? Number(max.slice(0, 4)) : thisYear + 5;
  const yearList = [];
  for (let y = yMax; y >= yMin; y -= 1) yearList.push(y);
  const headText = mode === "range" ? (r.from ? `${fmtDate(r.from)} – ${r.to ? fmtDate(r.to) : "…"}` : "Pick the first day") : sel ? fmtHead(sel) : "Pick a date";
  const months = two ? [view, addMonths(view, 1)] : [view];
  const canPrev = !min || addMonths(view, -1).slice(0, 7) >= min.slice(0, 7);
  const lastShown = two ? addMonths(view, 1) : view;
  const canNext = !max || addMonths(lastShown, 1).slice(0, 7) <= max.slice(0, 7);

  return (
    <div className={`dp-card ${two ? "is-two" : ""}`} ref={box} role="dialog" aria-modal="true" aria-label={title || (mode === "range" ? "Choose a date range" : "Choose a date")} onKeyDown={key}>
      <header className="dp-head">
        <small>{title || (mode === "range" ? "Select range" : "Select date")}</small>
        <b>{headText}</b>
      </header>
      <div className="dp-nav">
        <button type="button" className="dp-my" onClick={() => setYears((x) => !x)} aria-expanded={years} id={labelId}>
          {MONTHS[vm - 1]} {vy} <Chevron dir="down" />
        </button>
        {!years && (
          <span className="dp-arrows">
            <button type="button" className="dp-icon" onClick={() => turn(-1)} disabled={!canPrev} aria-label="Previous month">
              <Chevron dir="left" />
            </button>
            <button type="button" className="dp-icon" onClick={() => turn(1)} disabled={!canNext} aria-label="Next month">
              <Chevron dir="right" />
            </button>
          </span>
        )}
      </div>
      {years ? (
        <div className="dp-years" role="listbox" aria-label="Year">
          {yearList.map((y) => (
            <button
              key={y}
              type="button"
              role="option"
              aria-selected={y === vy}
              className={`${y === vy ? "is-sel" : ""} ${y === thisYear ? "is-today" : ""}`}
              onClick={() => {
                const v = `${y}-${pad(vm)}-01`;
                setView(v);
                setFocus(clampDay(v));
                setYears(false);
              }}
            >
              {y}
            </button>
          ))}
        </div>
      ) : (
        <div className="dp-months" onMouseLeave={() => setHover("")}>
          {months.map((mv, i) => (
            <div key={mv} className="dp-month">
              {two && <p className="dp-mtitle">{`${MONTHS[parts(mv)[1] - 1]} ${parts(mv)[0]}`}</p>}
              <Month view={mv} sel={mode === "range" ? "" : sel} range={mode === "range" ? r : null} hover={hover} setHover={mode === "range" ? setHover : null} min={min} max={max} focus={focus} setFocus={setFocus} onPick={pick} labelId={i === 0 ? labelId : undefined} />
            </div>
          ))}
        </div>
      )}
      <footer className="dp-foot">
        <button
          type="button"
          className="dp-text"
          onClick={() => {
            setSel("");
            setR({ from: "", to: "" });
          }}
        >
          Clear
        </button>
        <span className="dp-grow" />
        <button type="button" className="dp-text" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="dp-text is-ok" onClick={() => onDone(mode === "range" ? { from: r.from, to: r.to || r.from } : sel)}>
          OK
        </button>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------------------- the fields */
function Field({ label, text, placeholder, open, setOpen, children, className = "", disabled, id }) {
  const wrap = useRef(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const close = useCallback(() => {
    setOpen(false);
    if (btn.current) btn.current.focus();
  }, [setOpen]);
  usePopover(open, close, wrap, pop);
  // open towards the side with room; on a phone, as a sheet drawn in the app's root (a parent that
  // moves or animates would otherwise hold a fixed sheet inside itself)
  const [right, setRight] = useState(false);
  const [sheet, setSheet] = useState(null);
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    setRight(r.left + (className.includes("range") && window.innerWidth >= 720 ? 640 : 340) > window.innerWidth);
    const phone = window.matchMedia && window.matchMedia("(max-width: 599px)").matches;
    setSheet(phone ? wrap.current.closest(".adm") || document.body : null);
  }, [open, className]);
  const body = (
    // preventDefault: a form's <label> around the field would otherwise pass a click on the calendar's
    // blank parts on to the field's button, which closes it
    <div className={`dp-pop ${right ? "is-right" : ""} ${sheet ? "is-sheet" : ""}`} ref={pop} onClick={(e) => e.preventDefault()}>
      <div className="dp-scrim" aria-hidden="true" onClick={close} />
      {children(close)}
    </div>
  );
  return (
    <div className={`dp-field ${open ? "is-open" : ""} ${className}`} ref={wrap}>
      <button type="button" className="dp-input" ref={btn} onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} id={id}>
        {label && <span className="dp-label">{label}</span>}
        <span className={`dp-value ${text ? "" : "is-empty"}`}>{text || placeholder}</span>
        <IconCal />
      </button>
      {open && (sheet ? createPortal(body, sheet) : body)}
    </div>
  );
}

/** One date. value / onChange: "YYYY-MM-DD" ("" when cleared). */
export function DateField({ value, onChange, min, max, label, placeholder = "dd mmm yyyy", className, disabled, title, id }) {
  const [open, setOpen] = useState(false);
  const v = parse(value);
  return (
    <Field label={label} text={fmtDate(v)} placeholder={placeholder} open={open} setOpen={setOpen} className={className} disabled={disabled} id={id}>
      {(close) => (
        <Calendar
          mode="single"
          value={v}
          min={parse(min)}
          max={parse(max)}
          title={title || label}
          onCancel={close}
          onDone={(d) => {
            onChange(d || "");
            close();
          }}
        />
      )}
    </Field>
  );
}

/** A first and last day. value / onChange: { from, to } ("YYYY-MM-DD" each). */
export function DateRangeField({ value, onChange, min, max, label = "Dates", placeholder = "Pick the dates", className, disabled, title }) {
  const [open, setOpen] = useState(false);
  const from = parse(value && value.from);
  const to = parse(value && value.to);
  const text = from ? `${fmtDate(from)} – ${fmtDate(to || from)}` : "";
  return (
    <Field label={label} text={text} placeholder={placeholder} open={open} setOpen={setOpen} className={`dp-field--range ${className || ""}`} disabled={disabled}>
      {(close) => (
        <Calendar
          mode="range"
          range={{ from, to }}
          min={parse(min)}
          max={parse(max)}
          title={title}
          onCancel={close}
          onDone={(r) => {
            onChange(r && r.from ? r : { from: "", to: "" });
            close();
          }}
        />
      )}
    </Field>
  );
}

/** Hours and minutes, as two Material-style selects. value / onChange: "HH:MM". */
export function TimeField({ value, onChange, label, id }) {
  const [h, m] = /^\d{2}:\d{2}$/.test(String(value || "")) ? value.split(":") : ["09", "15"];
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => pad(i)), []);
  const mins = useMemo(() => Array.from({ length: 60 }, (_, i) => pad(i)), []);
  return (
    <div className="dp-field dp-time" role="group" aria-label={label || "Time"}>
      <div className="dp-input is-static">
        {label && <span className="dp-label">{label}</span>}
        <span className="dp-time__sel">
          <select id={id} value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} aria-label="Hour">
            {hours.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <b>:</b>
          <select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} aria-label="Minute">
            {mins.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </span>
      </div>
    </div>
  );
}

export default DateField;
