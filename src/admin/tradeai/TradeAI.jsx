// TradeAI — the agentic chat about your trading, on its own page (opened from the /me card in a new
// tab), laid out like a modern AI chat: your chats on the left (saved in the database, grouped by
// day, searchable, pinnable, renamable), one calm column of conversation, and a composer at the foot.
//
// Each question is planned, the desk's data is gathered (positions, P&L history, live calls, levels,
// patterns, habits, odds, outlook, the market, news when asked) and the default AI model (Claude
// Sonnet 5.5 unless another is picked on the AI page) answers through the AI Engine — falling back to
// the other saved companies and to the desk's own arithmetic, so it always answers. Answers are rich Markdown (headings, tables, coloured
// figures) with key numbers, a forecast and actions. The empty chat suggests what you are most
// likely to ask now (your open positions first); every answer ends with related questions.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useDialog } from "../dialog/DialogProvider";
import Shell from "../Shell";
import Markdown, { inline } from "./markdown";
import { GoalChip } from "../stock/trade/DailyGoal";
import { ACCEPT, LONG_PASTE, MAX_BYTES, MAX_FILES, dropFile, isImage, nameOf, prepareImage, sizeText, uploadFile } from "./attach";
import "./tradeai.css";
import { snack } from "../ux/snack";

const KIND = { corrective: "Fix now", proactive: "Prepare", watch: "Watch" };
const SUGGEST_ICON = { position: "📈", order: "⏳", review: "📋", probable: "🎯", alert: "🔔", time: "🕘", market: "🌐" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) {
    try {
      const v = window.localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch (_) {
      return d;
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, JSON.stringify(v));
    } catch (_) {
      /* a private window: fine */
    }
  },
};

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
}
function firstName(user) {
  const raw = ((user && user.name) || "").trim().split(/\s+/)[0] || "there";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
function groupOf(iso, now = new Date()) {
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "Previous 7 days";
  if (diff < 30) return "Previous 30 days";
  return "Older";
}
const signClass = (v) => (/^\s*[+▲]/.test(v) ? "is-up" : /^\s*[−▼]|^\s*-\s?[₹\d]/.test(v) ? "is-down" : "");

/* ---------------------------------------------------------------------------------- icons */
const I = ({ d, size = 18, fill = "none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const IcNew = () => <I d={<path d="M12 5v14M5 12h14" />} />;
const IcSide = () => <I d={<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>} />;
const IcSearch = () => <I size={16} d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>} />;
const IcSend = () => <I d={<path d="M12 19V5M5 12l7-7 7 7" />} />;
const IcPlus = () => <I size={22} d={<path d="M12 5v14M5 12h14" />} />;
const IcFile = () => <I size={16} d={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>} />;
const IcX = () => <I size={14} d={<path d="M6 6l12 12M18 6 6 18" />} />;
const IcStop = () => <I fill="currentColor" d={<rect x="7" y="7" width="10" height="10" rx="2" />} />;
const IcCopy = () => <I size={16} d={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>} />;
const IcCheck = () => <I size={16} d={<path d="m5 12 5 5 9-10" />} />;
const IcEdit = () => <I size={16} d={<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />} />;
const IcRetry = () => <I size={16} d={<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>} />;
const IcPin = () => <I size={15} d={<path d="M9 4h6l-1 6 4 3H6l4-3-1-6ZM12 13v7" />} />;
const IcTrash = () => <I size={15} d={<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>} />;
const IcMore = () => <I size={16} d={<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>} />;
const IcDown = () => <I d={<path d="M12 5v14M5 12l7 7 7-7" />} />;
const IcArrow = () => <I size={16} d={<path d="M5 12h14M13 6l6 6-6 6" />} />;
const IcRefresh = () => <I size={15} d={<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>} />;
const IcMic = () => <I size={17} d={<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>} />;
const IcGear = () => <I size={16} d={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>} />;
const IcExport = () => <I size={16} d={<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>} />;

// how a question is answered (server/ai/route.js): Auto picks for each question
const MODES = [
  { id: "auto", label: "Auto", tip: "Each question goes the best way: data at once with no model, light questions briefly, advice with the full data, depth with longer thinking — all on the default model." },
  { id: "fast", label: "Fast", tip: "The quickest answer: the desk's data at once, or a brief answer from the default model." },
  { id: "deep", label: "Deep", tip: "The most thorough: the default model thinks longer and writes a fuller answer. Slower." },
];
const ROUTE_ETA = { instant: "from the desk's data — no AI model", fast: "a brief answer · usually 3–12 s", advice: "the full data · usually 6–25 s", deep: "longer thinking · usually 20–60 s" };
const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/* ------------------------------------------------------------------------------ copy button */
function CopyBtn({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      snack("Copied to the clipboard.", { tone: "ok", key: "copied", ms: 2500 });
    } catch (_) {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
      } catch (__) {
        /* nothing more to try */
      }
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" className="tai-icon" onClick={copy} aria-label={done ? "Copied" : label} data-tip={done ? "Copied" : label}>
      {done ? <IcCheck /> : <IcCopy />}
    </button>
  );
}

/* --------------------------------------------------------------------------------- composer */
/** "@SB…" while typing: NSE stocks to pick from. */
function useMention(value) {
  const [list, setList] = useState([]);
  const m = /(^|\s)@([A-Za-z0-9&-]{1,20})$/.exec(value);
  const term = m ? m[2] : "";
  useEffect(() => {
    if (!term) {
      setList([]);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      api(`/api/admin/market/search?q=${encodeURIComponent(term)}`)
        .then((d) => alive && setList(((d && d.results) || []).slice(0, 6)))
        .catch(() => alive && setList([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [term]);
  return { term, list };
}

/** The chips of the attached files: a thumbnail or a file icon, the name, what is happening to it, and a way to take it off. */
function FileChips({ files, onRemove }) {
  if (!files || !files.length) return null;
  return (
    <ul className="tai-files" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.key} className={`tai-file is-${f.status}`}>
          {f.thumb ? <img src={f.thumb} alt="" className="tai-file__thumb" /> : <span className="tai-file__ico" aria-hidden="true"><IcFile /></span>}
          <span className="tai-file__txt">
            <b>{f.name}</b>
            <small>{f.status === "up" ? "Reading…" : f.status === "err" ? f.error : f.kind === "image" ? `Picture · ${sizeText(f.size)}` : `${f.chars ? `${f.chars.toLocaleString("en-IN")} characters` : sizeText(f.size)}${f.truncated ? " · shortened" : ""}`}</small>
          </span>
          {f.status === "up" && <i className="tai-file__spin" aria-hidden="true" />}
          {onRemove && (
            <button type="button" className="tai-file__x" onClick={() => onRemove(f.key)} aria-label={`Remove ${f.name}`}>
              <IcX />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Composer({ value, onChange, onSend, onStop, busy, disabled, big, inputRef, hint, mode, onMode, choices = null, model = "", onModel, effort = "auto", onEffort, defaultName = "", files = [], onFiles = null, onRemoveFile = null }) {
  const [listening, setListening] = useState(false);
  const [drag, setDrag] = useState(false);
  const picker = useRef(null);
  const uploading = files.some((f) => f.status === "up");
  const ready = files.filter((f) => f.status === "ok").length;
  const canSend = !disabled && !uploading && Boolean(value.trim() || ready);
  const [pick, setPick] = useState(0);
  const rec = useRef(null);
  const { term, list } = useMention(value);
  const showList = Boolean(term && list.length);
  // the box grows with the text, smoothly (the height is measured, then eased to — CSS transition on height), up to 40% of the screen,
  // and only then scrolls inside
  const fit = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const prev = el.offsetHeight;
    el.style.height = "auto";
    const max = Math.max(120, Math.min(340, Math.round(window.innerHeight * 0.4)));
    const next = Math.min(el.scrollHeight, max);
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    if (prev && Math.abs(prev - next) > 1) {
      el.style.height = `${prev}px`;
      void el.offsetHeight; // the starting height is committed before the new one is set, so the change is eased
    }
    el.style.height = `${next}px`;
  }, [inputRef]);
  useLayoutEffect(() => {
    fit();
  }, [value, fit]);
  // the width can change after the text did (the page settling, the window resized, the chats panel opened): fit again
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    let w = el.offsetWidth;
    const again = () => {
      if (el.offsetWidth !== w) {
        w = el.offsetWidth;
        fit();
      }
    };
    window.addEventListener("resize", again);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(again) : null;
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener("resize", again);
      if (ro) ro.disconnect();
    };
  }, [inputRef, fit]);
  const take = (list) => {
    const picked = [...(list || [])];
    if (picked.length && onFiles) onFiles(picked);
  };
  const onPaste = (e) => {
    const cd = e.clipboardData;
    if (!cd || !onFiles) return;
    const fs = [...(cd.files || [])];
    if (fs.length) {
      e.preventDefault();
      onFiles(fs.map((f, i) => (f.name && !/^image\.(png|jpe?g)$/i.test(f.name) ? f : new File([f], nameOf(f, i), { type: f.type }))));
      return;
    }
    const t = cd.getData ? cd.getData("text") : "";
    if (t && t.length > LONG_PASTE) {
      e.preventDefault();
      onFiles([new File([t], "pasted-text.txt", { type: "text/plain" })]);
    }
  };
  const hasFiles = (e) => Boolean(e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files"));
  useEffect(() => setPick(0), [term]);
  useEffect(() => () => rec.current && rec.current.abort && rec.current.abort(), []);
  const choose = (sym) => {
    onChange(value.replace(/@([A-Za-z0-9&-]{1,20})$/, `${sym} `));
    if (inputRef.current) inputRef.current.focus();
  };
  const listen = () => {
    if (!SR) return;
    if (listening && rec.current) {
      rec.current.stop();
      return;
    }
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(" ")
        .trim();
      if (said) onChange(`${value ? `${value.trim()} ` : ""}${said}`);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  return (
    <div className={`tai-cw ${big ? "tai-cw--big" : ""}`}>
    <form
      className={`tai-comp ${big ? "tai-comp--big" : ""} ${drag ? "is-drag" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && canSend) onSend(value);
      }}
      onDragEnter={(e) => {
        if (onFiles && hasFiles(e)) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragOver={(e) => {
        if (onFiles && hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false);
      }}
      onDrop={(e) => {
        if (!onFiles || !hasFiles(e)) return;
        e.preventDefault();
        setDrag(false);
        take(e.dataTransfer.files);
      }}
    >
      {drag && <div className="tai-drop" aria-hidden="true">Drop to attach — pictures, PDF, Word, Excel, CSV, text</div>}
      <FileChips files={files} onRemove={onRemoveFile} />
      {showList && (
        <ul className="tai-mention" role="listbox" aria-label="Stocks">
          {list.map((x, i) => (
            <li key={x.symbol} role="option" aria-selected={i === pick}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(x.symbol)}>
                <b>{x.symbol}</b>
                <small>{x.name}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        maxLength={4000}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (showList && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setPick((p) => (p + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
            return;
          }
          if (showList && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            choose(list[pick].symbol);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!busy && canSend) onSend(value);
          }
        }}
        placeholder={big ? "Ask about your positions, a stock, the market or your results… (@ for a stock, or attach a file)" : "Reply to TradeAI… (@ for a stock, or attach a file)"}
        aria-label="Your question"
        disabled={disabled}
      />
      <div className="tai-comp__row">
        {onFiles && (
          <>
            <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
            <button type="button" className="tai-icon tai-attach" onClick={() => picker.current && picker.current.click()} disabled={busy || files.length >= MAX_FILES} aria-label="Attach files" data-tip={`Attach pictures, PDF, Word, Excel, PowerPoint, CSV or text files (up to ${MAX_FILES}, ${Math.round(MAX_BYTES / 1048576)} MB each) — or drop or paste them here. A picture is read by a paid model that can see; the free ones read text.`}>
              <IcPlus />
            </button>
          </>
        )}
        <span className="tai-comp__spacer" />
        {value.length > 3400 && <span className="tai-comp__count">{value.length}/4000</span>}
        {SR && !busy && (
          <button type="button" className={`tai-icon tai-mic ${listening ? "is-on" : ""}`} onClick={listen} aria-label={listening ? "Stop listening" : "Speak your question"} aria-pressed={listening} data-tip={listening ? "Listening… press to stop" : "Speak your question"}>
            <IcMic />
          </button>
        )}
        {busy ? (
          <button type="button" className="tai-send is-stop" onClick={onStop} aria-label="Stop the answer" data-tip="Stop (Esc)">
            <IcStop />
          </button>
        ) : (
          <button type="submit" className="tai-send" disabled={!canSend} aria-label="Send" data-tip={uploading ? "Reading your files…" : "Send (Enter)"}>
            <IcSend />
          </button>
        )}
      </div>
    </form>
    {(onMode || (choices && onModel && onEffort) || hint) && (
      <div className="tai-meta">
        {onMode && (
          <div className="tai-modes" role="group" aria-label="How to answer">
            {MODES.map((x) => (
              <button key={x.id} type="button" aria-pressed={mode === x.id} onClick={() => onMode(x.id)} data-tip={x.tip}>
                {x.id === "fast" ? "⚡ " : x.id === "deep" ? "🧠 " : ""}
                {x.label}
              </button>
            ))}
          </div>
        )}
        {choices && onModel && onEffort && (
          <div className="tai-ctl">
            <select className="tai-ctl__sel" value={choices.models.some((m) => `${m.provider}|${m.model}` === model) ? model : ""} onChange={(e) => onModel(e.target.value)} aria-label="AI model for this chat" data-tip="The AI model that answers: the default one, or any model of a company whose key is saved on the AI page.">
              <option value="">Default{defaultName ? ` — ${defaultName}` : " model"}</option>
              {choices.models.map((m) => (
                <option key={`${m.provider}|${m.model}`} value={`${m.provider}|${m.model}`}>
                  {m.name} · {m.company}
                </option>
              ))}
            </select>
            <select className="tai-ctl__sel" value={effort} onChange={(e) => onEffort(e.target.value)} aria-label="Thinking level" data-tip={(choices.efforts.find((x) => x.id === effort) || {}).text || "How hard the model thinks and how far the agent may read: your control over tokens."}>
              {choices.efforts.map((x) => (
                <option key={x.id} value={x.id}>
                  Thinking: {x.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {hint && (
          <span className="tai-info" tabIndex={0} role="img" aria-label={hint} data-tip={hint}>
            i
          </span>
        )}
      </div>
    )}
    </div>
  );
}

/* ----------------------------------------------------------------------------- an answer */
function useReveal(text, on) {
  const [n, setN] = useState(on ? 0 : String(text || "").length);
  useEffect(() => {
    const len = String(text || "").length;
    if (!on || reduced()) {
      setN(len);
      return undefined;
    }
    // by the clock, on a timer (animation frames stop in a hidden tab): it always finishes in
    // under two seconds, however busy the page is
    const t0 = Date.now();
    const ms = Math.min(1800, 450 + len * 1.6);
    const id = setInterval(() => {
      const i = Math.min(len, Math.ceil((len * (Date.now() - t0)) / ms));
      setN(i);
      if (i >= len) clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  }, [text, on]);
  return n;
}

function Process({ meta }) {
  const used = meta.used || [];
  const n = (meta.by || []).length;
  const sec = Number.isFinite(meta.ms) ? Math.round(meta.ms / 100) / 10 : null;
  const u = meta.usage || {};
  const tokens = u.input || u.output ? ` · ${(u.input || 0).toLocaleString("en-IN")} in / ${(u.output || 0).toLocaleString("en-IN")} out tokens` : "";
  const agentSteps = (meta.agent && meta.agent.steps) || [];
  const agentRead = agentSteps.reduce((a, x) => a + x.calls.filter((c) => c.ok).length, 0);
  const label =
    meta.tier === "instant"
      ? `⚡ Instant — from the desk’s data (${used.length ? used.join(", ") : "the desk"}), no AI model${sec !== null ? ` · ${sec}s` : ""}`
      : meta.reused
        ? `♻ Reused — the same question on ${meta.sameData ? "the same data" : "nearly the same data (within 3 minutes)"}, answered ${meta.reusedAt ? new Date(meta.reusedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "earlier"} — no new AI call (Retry asks again)`
        : meta.engineOnly
        ? "Answered with the desk’s own arithmetic (no AI model answered)"
        : `Read ${used.length ? used.join(", ") : "the desk"} · ${n > 1 ? `${n} models${meta.mergedBy ? ` · merged by ${meta.mergedBy}` : ""}` : `answered by ${(meta.by || [])[0] || "a model"}${meta.tier === "deep" ? " · thinking longer" : ""}`}${meta.fallback ? " · after a fallback" : ""}${meta.effort ? ` · thinking: ${meta.effort}` : ""}${agentSteps.length ? ` · agent: ${agentSteps.length} step${agentSteps.length === 1 ? "" : "s"}${agentRead ? `, read ${agentRead} more` : ""}` : ""}${tokens}`;
  return (
    <details className="tai-proc">
      <summary>
        <span className="tai-proc__ok">✓</span>
        <span className="tai-proc__t">{label}</span>
        {Number.isFinite(meta.sec) && <span className="tai-proc__s">{meta.sec}s</span>}
      </summary>
      <div className="tai-proc__body">
        {meta.steps && meta.steps.length > 0 && (
          <ol>
            {meta.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {agentSteps.length > 0 && (
          <ul className="tai-proc__agent">
            {agentSteps.map((x) => (
              <li key={x.n}>
                <b>Agent step {x.n}:</b> {x.thought || "checked what was still missing."}
                {x.calls.length > 0 && <small> Read: {x.calls.map((c) => `${c.tool}${c.symbol ? ` ${c.symbol}` : ""}${c.ok ? "" : " (nothing there)"}`).join(", ")}.</small>}
              </li>
            ))}
          </ul>
        )}
        {meta.models && meta.models.length > 0 && (
          <ul className="tai-proc__models">
            {meta.models.map((m, i) => (
              <li key={i} className={m.ok ? "is-ok" : "is-bad"}>
                {m.ok ? "✓" : "✕"} {m.name} <small>{(m.ms / 1000).toFixed(1)}s{m.error ? ` · ${m.error}` : ""}</small>
              </li>
            ))}
          </ul>
        )}
        <p>Through the AI Engine: the owner’s brains and the trading-skills rules went with every request.</p>
      </div>
    </details>
  );
}

function Answer({ m, fresh, last, onAsk, onRetry, busy }) {
  const r = m.reply || { answer: m.text, datapoints: [], actions: [], forecast: null, followups: [], related: [], meta: {} };
  const meta = r.meta || {};
  const text = String(r.answer || "");
  const n = useReveal(text, fresh);
  const done = n >= text.length;
  const related = r.related && r.related.length ? r.related : r.followups || [];
  const groups = ["corrective", "proactive", "watch"].map((k) => [k, (r.actions || []).filter((a) => a.kind === k)]).filter(([, l]) => l.length);
  const conf = { low: 1, medium: 2, high: 3 }[r.confidence] || 1;
  return (
    <article className={`tai-msg tai-msg--ai ${fresh ? "is-fresh" : ""}`}>
      <img className="tai-avatar" src="/drishti-logo.svg" alt="" width="30" height="30" />
      <div className="tai-ans">
        <Process meta={meta} />
        <Markdown text={done ? text : text.slice(0, n)} className={done ? "" : "is-typing"} />
        {done && (
          <div className="tai-extra">
            {r.datapoints && r.datapoints.length > 0 && (
              <section className="tai-dp" aria-label="Key numbers">
                {r.datapoints.map((d, i) => (
                  <div key={i} style={{ animationDelay: `${i * 40}ms` }}>
                    <span>{d.label}</span>
                    <b className={signClass(d.value)}>{d.value}</b>
                  </div>
                ))}
              </section>
            )}
            {r.forecast && r.forecast.lean && r.forecast.lean !== "n/a" && (
              <section className={`tai-fc is-${r.forecast.lean}`} aria-label="Forecast">
                <span className="tai-fc__arrow" aria-hidden="true">
                  {r.forecast.lean === "up" ? "▲" : r.forecast.lean === "down" ? "▼" : "◆"}
                </span>
                <div>
                  <b>
                    Leans {r.forecast.lean}
                    {r.forecast.horizon ? <small> · {r.forecast.horizon}</small> : null}
                  </b>
                  {r.forecast.scenarios && r.forecast.scenarios.length > 0 && (
                    <ul>
                      {r.forecast.scenarios.map((s, i) => (
                        <li key={i}>{inline(s, `fc${i}`)}</li>
                      ))}
                    </ul>
                  )}
                  <span className="tai-conf" aria-label={`Confidence ${r.confidence || "low"}`}>
                    Confidence
                    {[1, 2, 3].map((x) => (
                      <i key={x} className={x <= conf ? "is-on" : ""} />
                    ))}
                    <small>{r.confidence || "low"} — how well the evidence agrees, not a promise</small>
                  </span>
                </div>
              </section>
            )}
            {groups.length > 0 && (
              <section className="tai-acts" aria-label="Actions">
                {groups.map(([k, list]) => (
                  <div key={k} className={`tai-acts__g is-${k}`}>
                    <span className="tai-acts__k">{KIND[k]}</span>
                    <ul>
                      {list.map((a, i) => (
                        <li key={i}>{inline(a.text, `a${k}${i}`)}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}
            <div className="tai-bar">
              <CopyBtn text={text} />
              {last && (
                <button type="button" className="tai-icon" onClick={onRetry} disabled={busy} aria-label="Retry" data-tip="Ask again">
                  <IcRetry />
                </button>
              )}
              <span className="tai-bar__note">{meta.engineOnly ? "Desk’s arithmetic" : "A second opinion, not advice"}</span>
            </div>
            {last && related.length > 0 && (
              <section className="tai-rel" aria-label="Related questions">
                <h4>Related</h4>
                <ul>
                  {related.map((q, i) => (
                    <li key={q} style={{ animationDelay: `${i * 60}ms` }}>
                      <button type="button" onClick={() => onAsk(q)} disabled={busy}>
                        <span className="tai-rel__i" aria-hidden="true">↳</span>
                        <span>{q}</span>
                        <IcArrow />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Question({ m, onEdit, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  if (editing)
    return (
      <article className="tai-msg tai-msg--me is-editing">
        <form
          className="tai-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) {
              setEditing(false);
              onEdit(draft);
            }
          }}
        >
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={1500} aria-label="Edit your question" autoFocus />
          <span>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={!draft.trim() || busy}>
              Send
            </button>
          </span>
        </form>
      </article>
    );
  return (
    <article className="tai-msg tai-msg--me">
      {m.files && m.files.length > 0 && (
        <ul className="tai-qfiles" aria-label="Attached files">
          {m.files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.thumb ? <img src={f.thumb} alt="" /> : <IcFile />}
              <span>{f.name}</span>
            </li>
          ))}
        </ul>
      )}
      {m.text ? <div className="tai-q">{m.text}</div> : null}
      <div className="tai-bar tai-bar--me">
        <CopyBtn text={m.text} />
        <button
          type="button"
          className="tai-icon"
          onClick={() => {
            setDraft(m.text);
            setEditing(true);
          }}
          disabled={busy}
          aria-label="Edit"
          data-tip="Edit and ask again"
        >
          <IcEdit />
        </button>
      </div>
    </article>
  );
}

function Working({ job }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    // counted on this page (the server's clock may differ from this computer's)
    const t0 = Date.now();
    const id = setInterval(() => setSec(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [job.id]);
  const steps = job.steps || [];
  const now = steps[steps.length - 1] || "Working out what this needs";
  const route = job.route;
  return (
    <article className="tai-msg tai-msg--ai is-working" aria-live="polite">
      <img className="tai-avatar is-spin" src="/drishti-logo.svg" alt="" width="30" height="30" />
      <div className="tai-ans">
        <p className="tai-shimmer">
          {now}
          <span className="tai-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
        {steps.length > 1 && (
          <ol className="tai-steps">
            {steps.slice(0, -1).map((s, i) => (
              <li key={i}>
                <span>✓</span> {s}
              </li>
            ))}
          </ol>
        )}
        <small className="tai-dim">
          {sec}s
          {route ? ` · ${route.tier === "instant" ? "instant" : route.model ? route.model : route.tier} · ${ROUTE_ETA[route.tier] || ""}` : " · working out the fastest way to answer"}
        </small>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------------------------- sidebar */
function ChatItem({ c, open, onOpen, onRename, onPin, onDelete }) {
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(c.title);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  if (edit)
    return (
      <li className="tai-item is-edit">
        <input
          value={name}
          autoFocus
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setEdit(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              setEdit(false);
              onRename(name);
            }
            if (e.key === "Escape") setEdit(false);
          }}
          aria-label="Chat name"
        />
      </li>
    );
  return (
    <li className={`tai-item ${open ? "is-on" : ""}`} ref={ref}>
      <button type="button" className="tai-item__go" onClick={onOpen} title={c.preview || c.title}>
        {c.pinned && (
          <span className="tai-item__pin" aria-label="Pinned">
            <IcPin />
          </span>
        )}
        <span className="tai-item__t">{c.title || "Chat"}</span>
      </button>
      <button type="button" className="tai-item__more" onClick={() => setMenu((x) => !x)} aria-label={`More for ${c.title}`} aria-expanded={menu}>
        <IcMore />
      </button>
      {menu && (
        <div className="tai-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setName(c.title);
              setEdit(true);
            }}
          >
            <IcEdit /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              onPin(!c.pinned);
            }}
          >
            <IcPin /> {c.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setMenu(false);
              onDelete();
            }}
          >
            <IcTrash /> Delete
          </button>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------------------------ page */
export default function TradeAI() {
  const { user } = useAuth() || {};
  const ask = useDialog();
  const isOwner = Boolean(user && user.role === "superadmin");
  const [convs, setConvs] = useState(null);
  const [q, setQ] = useState("");
  const [conv, setConv] = useState(null);
  const [text, setText] = useState("");
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");
  const [fresh, setFresh] = useState(null);
  const [side, setSide] = useState(() => (typeof window !== "undefined" && window.innerWidth < 1024 ? false : store.get("tai.side", true)));
  const [sugg, setSugg] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [titleEdit, setTitleEdit] = useState(false);
  const [top, setTop] = useState(56);
  const [mode, setModeState] = useState(() => store.get("tai.mode", "auto"));
  const [tset, setTset] = useState(null); // how TradeAI answers: settings, the default model and its fallbacks
  const [setOpen, setSetOpen] = useState(false);
  const setMode = (m) => {
    setModeState(m);
    store.set("tai.mode", m);
  };
  // the trader's control over tokens: which model answers, and how hard it thinks (kept on this device)
  const [picked, setPickedState] = useState(() => store.get("tai.model", ""));
  const [effort, setEffortState] = useState(() => store.get("tai.effort", "auto"));
  const setPicked = (m) => {
    setPickedState(m);
    store.set("tai.model", m);
  };
  const setEffort = (e) => {
    setEffortState(e);
    store.set("tai.effort", e);
  };
  useEffect(() => {
    api("/api/admin/tradeai/settings")
      .then(setTset)
      .catch(() => setTset(null));
  }, []);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const openRef = useRef(null);
  const stopRef = useRef(false);
  const narrow = () => typeof window !== "undefined" && window.innerWidth < 1024;

  // the chat fills the window under the site's header, and the page itself does not scroll
  useLayoutEffect(() => {
    const head = document.querySelector(".adm-head");
    const measure = () => setTop(head ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 56);
    measure();
    document.documentElement.classList.add("tai-lock");
    window.addEventListener("resize", measure);
    let ro = null;
    if (head && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(head);
    }
    return () => {
      document.documentElement.classList.remove("tai-lock");
      window.removeEventListener("resize", measure);
      if (ro) ro.disconnect();
    };
  }, []);

  const setUrl = (id) => {
    try {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set("c", id);
      else u.searchParams.delete("c");
      window.history.replaceState(null, "", u.toString());
    } catch (_) {
      /* fine */
    }
  };

  const loadList = useCallback((query = "") => {
    return api(`/api/admin/tradeai/convs${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((d) => setConvs(Array.isArray(d && d.convs) ? d.convs : []))
      .catch(() => setConvs((c) => c || []));
  }, []);
  const loadSugg = useCallback(() => {
    setSugg(null);
    api("/api/admin/tradeai/suggest")
      .then((d) => setSugg(Array.isArray(d && d.suggestions) ? d : { suggestions: [] }))
      .catch(() => setSugg({ suggestions: [] }));
  }, []);

  // search the chats as you type (titles and messages)
  useEffect(() => {
    const id = setTimeout(() => loadList(q.trim()), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [q, loadList]);

  const follow = useCallback(
    async (j0, convId) => {
      let j = j0;
      setJob(j);
      stopRef.current = false;
      let polls = 0;
      while (!j.finishedAt && !stopRef.current) {
        // an instant answer is back in about a second: look often at first, then calmly
        await sleep(polls < 6 ? 350 : 900);
        polls += 1;
        try {
          j = await api(`/api/admin/tradeai/job/${j.id}`);
        } catch (e) {
          setErr(e.message);
          break;
        }
        setJob(j);
      }
      if (j.error) setErr(j.error);
      const c = await api(`/api/admin/tradeai/convs/${convId}`).catch(() => null);
      if (c && openRef.current === convId) {
        setConv(c);
        const lastMsg = c.messages[c.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && !j.cancelled && !stopRef.current) setFresh(lastMsg.id);
      }
      setJob(null);
      loadList();
    },
    [loadList]
  );

  const openChat = useCallback(
    async (id) => {
      setErr("");
      if (narrow()) setSide(false);
      try {
        const c = await api(`/api/admin/tradeai/convs/${id}`);
        openRef.current = c.id;
        setConv(c);
        setFresh(null);
        setUrl(c.id);
        setAtBottom(true);
        if (c.job) follow({ id: c.job, finishedAt: null, steps: [], startedAt: null }, c.id);
      } catch (e) {
        setErr(e.message);
        setUrl(null);
      }
    },
    [follow]
  );

  // first load: the chat in the address (?c=), else a new chat with suggestions
  useEffect(() => {
    let id = null;
    try {
      id = new URL(window.location.href).searchParams.get("c");
    } catch (_) {
      id = null;
    }
    if (id && /^[a-f0-9]{6,32}$/.test(id)) openChat(id);
    loadSugg();
  }, [openChat, loadSugg]);

  const fresh0 = () => {
    if (job) return;
    openRef.current = null;
    setConv(null);
    setErr("");
    setFresh(null);
    setText("");
    setUrl(null);
    if (narrow()) setSide(false);
    loadSugg();
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  /* ---- attached files: read by the server as soon as they are added (attach.js); the question carries their ids */
  const [attached, setAttached] = useState([]); // [{ key, name, kind, status: "up" | "ok" | "err", id, size, thumb, chars, truncated, error }]
  const attachedRef = useRef([]);
  attachedRef.current = attached;
  const patchFile = (key, patch) => setAttached((l) => l.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const addFiles = async (list) => {
    const room = MAX_FILES - attachedRef.current.length;
    const picked = list.slice(0, Math.max(0, room));
    if (list.length > picked.length) snack(`Up to ${MAX_FILES} files go with one question.`, { tone: "warn", key: "attach-max" });
    for (const f0 of picked) {
      const key = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const img = isImage(f0);
      const thumb = img && typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(f0) : "";
      setAttached((l) => [...l, { key, name: nameOf(f0), kind: img ? "image" : "text", status: "up", size: f0.size, thumb }]);
      if (f0.size > MAX_BYTES) {
        patchFile(key, { status: "err", error: `Larger than ${Math.round(MAX_BYTES / 1048576)} MB` });
        continue;
      }
      (async () => {
        try {
          const f = img ? await prepareImage(f0) : f0;
          const named = f.name === nameOf(f0) ? f : new File([f], nameOf(f0), { type: f.type });
          const d = await uploadFile(named);
          patchFile(key, { status: "ok", id: d.id, kind: d.kind, chars: d.chars, truncated: d.truncated, size: d.bytes || f.size });
        } catch (e) {
          patchFile(key, { status: "err", error: e.message });
        }
      })();
    }
  };
  const removeFile = (key) => {
    const f = attachedRef.current.find((x) => x.key === key);
    if (f && f.thumb && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(f.thumb);
    if (f && f.id) dropFile(f.id);
    setAttached((l) => l.filter((x) => x.key !== key));
  };

  const send = async (raw, from = null) => {
    const files = attachedRef.current.filter((f) => f.status === "ok");
    if (attachedRef.current.some((f) => f.status === "up")) return;
    const question = String(raw || "").trim();
    if ((!question && !files.length) || job) return;
    setErr("");
    setText("");
    setAttached([]);
    setFresh(null);
    setAtBottom(true);
    const base = conv || { id: null, title: (question || (files[0] && files[0].name) || "Files").slice(0, 60), messages: [] };
    const msgs = from !== null ? base.messages.slice(0, from) : base.messages;
    setConv({ ...base, messages: [...msgs, { id: `tmp-${Date.now()}`, role: "user", text: question, at: new Date().toISOString(), ...(files.length ? { files: files.map((f) => ({ name: f.name, kind: f.kind, chars: f.chars, truncated: f.truncated, thumb: f.thumb })) } : {}) }] });
    try {
      const d = await api("/api/admin/tradeai/ask", { method: "POST", body: { conv: base.id, text: question, from, mode, ...(files.length ? { attachments: files.map((f) => f.id) } : {}), ...(isOwner ? { effort, ...(picked ? { model: { provider: picked.split("|")[0], model: picked.split("|").slice(1).join("|") } } : {}) } : {}) } });
      openRef.current = d.conv;
      setUrl(d.conv);
      if (!base.id) {
        setConv((c) => ({ ...c, id: d.conv }));
        loadList();
      }
      await follow(d.job, d.conv);
    } catch (e) {
      setErr(e.message);
      setJob(null);
    }
  };

  const stop = async () => {
    if (!job) return;
    stopRef.current = true;
    await api(`/api/admin/tradeai/job/${job.id}/stop`, { method: "POST" }).catch(() => null);
  };

  const fail = (e) => {
    setErr(e.message);
    return null;
  };
  const rename = async (id, title) => {
    const d = await api(`/api/admin/tradeai/convs/${id}`, { method: "PUT", body: { title } }).catch(fail);
    if (d) setConvs(d.convs);
    if (conv && conv.id === id) setConv((c) => ({ ...c, title: title.trim() }));
  };
  const pin = async (id, pinned) => {
    const d = await api(`/api/admin/tradeai/convs/${id}/pin`, { method: "PUT", body: { pinned } }).catch(fail);
    if (d) setConvs(d.convs);
  };
  const del = async (c) => {
    const yes = await ask({ tone: "danger", title: "Delete this chat?", body: `“${c.title}” is deleted from the database for good.`, confirmText: "Delete the chat", cancelText: "Keep it" });
    if (!yes) return;
    const d = await api(`/api/admin/tradeai/convs/${c.id}`, { method: "DELETE" }).catch(fail);
    if (d) setConvs(d.convs);
    if (conv && conv.id === c.id) fresh0();
  };

  // keyboard: Esc stops (or closes the chats on a phone), Ctrl+Shift+O a new chat, "/" the composer
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
      if (e.key === "Escape") {
        if (job) stop();
        else if (side && narrow()) setSide(false);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        fresh0();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        if (inputRef.current) inputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // follow the conversation down while you are at the bottom
  const msgs = (conv && conv.messages) || [];
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: reduced() ? "auto" : "smooth" });
  }, [msgs.length, job, atBottom]);
  useEffect(() => {
    if (!fresh) return undefined;
    const el = scrollRef.current;
    const id = setInterval(() => el && atBottom && (el.scrollTop = el.scrollHeight), 120);
    const off = setTimeout(() => clearInterval(id), 2500);
    return () => {
      clearInterval(id);
      clearTimeout(off);
    };
  }, [fresh, atBottom]);

  const toggleSide = () =>
    setSide((s) => {
      if (!narrow()) store.set("tai.side", !s);
      return !s;
    });

  const groups = useMemo(() => {
    const out = [];
    const now = new Date();
    for (const c of convs || []) {
      const g = c.pinned ? "Pinned" : groupOf(c.updatedAt, now);
      let grp = out.find((x) => x.name === g);
      if (!grp) {
        grp = { name: g, items: [] };
        out.push(grp);
      }
      grp.items.push(c);
    }
    return out;
  }, [convs]);

  const busy = Boolean(job);
  const lastAi = msgs.map((m) => m.role).lastIndexOf("assistant");
  const dangling = !busy && msgs.length > 0 && msgs[msgs.length - 1].role === "user" && conv && conv.id;
  const retryFrom = (i) => {
    // the question before answer i, asked again
    for (let k = i - 1; k >= 0; k -= 1) if (msgs[k].role === "user") return send(msgs[k].text, k);
    return null;
  };
  const hint = isOwner ? "Reads your positions & P&L (read-only) · never down" : "Never down · account data is the owner’s only";
  const exportChat = () => {
    if (!conv || !conv.messages.length) return;
    const md = [`# ${conv.title}`, "", ...conv.messages.map((m) => `## ${m.role === "user" ? "You" : "TradeAI"} · ${new Date(m.at).toLocaleString("en-IN")}\n\n${m.text}\n`)].join("\n");
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(conv.title || "TradeAI chat").replace(/[^a-z0-9 _-]/gi, "").slice(0, 60) || "TradeAI chat"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const saveSet = async (patch) => {
    try {
      setTset(await api("/api/admin/tradeai/settings", { method: "PUT", body: patch }));
    } catch (e) {
      setErr(e.message);
    }
  };
  const instantChips = [
    isOwner && "Show my positions",
    isOwner && "How am I doing against my daily target?",
    "Show the option chain of NIFTY",
    sugg && sugg.suggestions && (sugg.suggestions.find((x) => x.symbol) || {}).symbol ? `Intraday plan for ${sugg.suggestions.find((x) => x.symbol).symbol}` : null,
  ].filter(Boolean);
  const pickedName = isOwner && picked && tset && tset.choices ? (tset.choices.models.find((m) => `${m.provider}|${m.model}` === picked) || {}).name : null;
  const model = tset && tset.lead && tset.usePaid ? pickedName || tset.lead.name : "desk's data only";
  const badge = tset ? `${mode === "fast" ? "Fast" : mode === "deep" ? "Deep" : "Auto"} · ${model}${isOwner && effort !== "auto" ? ` · thinking ${effort}` : ""}` : "Auto";

  return (
    <Shell crumb="TradeAI" fluid>
      <div className={`tai-app ${side ? "is-side" : ""}`} style={{ top }}>
        <aside className="tai-side" aria-label="Your chats">
          <div className="tai-side__top">
            <button type="button" className="tai-new" onClick={fresh0} disabled={busy} data-tip="New chat (Ctrl Shift O)">
              <IcNew /> New chat
            </button>
            <button type="button" className="tai-icon" onClick={toggleSide} aria-label="Hide the chats">
              <IcSide />
            </button>
          </div>
          <label className="tai-search">
            <IcSearch />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
          </label>
          <nav className="tai-list">
            {convs === null && (
              <ul className="tai-skel" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} />
                ))}
              </ul>
            )}
            {convs && !convs.length && <p className="tai-dim tai-list__empty">{q ? "No chat matches." : "Your chats will appear here — saved in the database, until you delete them."}</p>}
            {groups.map((g) => (
              <div key={g.name} className="tai-group">
                <h5>{g.name}</h5>
                <ul>
                  {g.items.map((c) => (
                    <ChatItem key={c.id} c={c} open={conv && conv.id === c.id} onOpen={() => openChat(c.id)} onRename={(t) => rename(c.id, t)} onPin={(p) => pin(c.id, p)} onDelete={() => del(c)} />
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <p className="tai-side__foot">
            {convs ? `${convs.length} chat${convs.length === 1 ? "" : "s"}` : ""} · saved in the database
          </p>
        </aside>
        <button type="button" className="tai-scrim" aria-label="Close the chats" onClick={() => setSide(false)} tabIndex={-1} />

        <section className="tai-main" aria-label="TradeAI">
          <header className="tai-top">
            {!side && (
              <button type="button" className="tai-icon" onClick={toggleSide} aria-label="Show the chats">
                <IcSide />
              </button>
            )}
            {conv && conv.id && titleEdit ? (
              <input
                className="tai-title-in"
                defaultValue={conv.title}
                autoFocus
                maxLength={80}
                onBlur={() => setTitleEdit(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target.value.trim()) {
                    setTitleEdit(false);
                    rename(conv.id, e.target.value);
                  }
                  if (e.key === "Escape") setTitleEdit(false);
                }}
                aria-label="Chat name"
              />
            ) : (
              <button type="button" className="tai-title" onClick={() => conv && conv.id && setTitleEdit(true)} disabled={!conv || !conv.id} data-tip={conv && conv.id ? "Rename" : undefined}>
                {conv ? conv.title : "TradeAI"}
              </button>
            )}
            <span className="tai-grow" />
            {isOwner && <GoalChip />}
            <span className="tai-badge" data-tip="Data questions are answered at once from the desk; everything else by the default AI model — brief for light questions, longer thinking for Deep. If it fails, the other saved companies are tried; if every model fails, the desk’s own arithmetic answers.">
              <i /> {badge}
            </span>
            {conv && conv.messages && conv.messages.length > 0 && (
              <button type="button" className="tai-icon" onClick={exportChat} aria-label="Export this chat" data-tip="Download this chat as a Markdown file">
                <IcExport />
              </button>
            )}
            {isOwner && (
              <span className="tai-setwrap">
                <button
                  type="button"
                  className="tai-icon"
                  onClick={() => {
                    setSetOpen((o) => !o);
                    api("/api/admin/tradeai/settings").then(setTset).catch(() => {});
                  }}
                  aria-expanded={setOpen}
                  aria-label="How TradeAI answers" data-tip="How TradeAI answers: the default mode and the AI model's daily limit">
                  <IcGear />
                </button>
                {setOpen && tset && (
                  <div className="tai-set" role="dialog" aria-label="How TradeAI answers">
                    <h4>How TradeAI answers</h4>
                    <label className="tai-set__row">
                      <span>Default mode</span>
                      <select value={tset.mode} onChange={(e) => saveSet({ mode: e.target.value })}>
                        {MODES.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="tai-set__row">
                      <span>Thinking level, when a chat picks none</span>
                      <select value={tset.effort || "auto"} onChange={(e) => saveSet({ effort: e.target.value })}>
                        {((tset.choices && tset.choices.efforts) || []).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="tai-set__row tai-set__check">
                      <input type="checkbox" checked={tset.usePaid} onChange={(e) => saveSet({ usePaid: e.target.checked })} />
                      <span>Use the AI model{tset.lead ? ` (${tset.lead.name}, the default model)` : " — no key saved on the AI page"}; off, TradeAI answers from the desk’s data only</span>
                    </label>
                    <label className="tai-set__row">
                      <span>Model answers a day, at most</span>
                      <input type="number" min="0" max="2000" step="10" defaultValue={tset.paidDailyCap} onBlur={(e) => saveSet({ paidDailyCap: Number(e.target.value) })} />
                    </label>
                    <p className="tai-dim">
                      Model answers today: {tset.paidToday}.
                      {tset.today ? ` ${tset.today.questions} question${tset.today.questions === 1 ? "" : "s"}: ${tset.today.instant} instant, ${tset.today.reused} reused, ${tset.today.model} by the model (${tset.today.agentSteps} agent step${tset.today.agentSteps === 1 ? "" : "s"}) · ${tset.today.tokensIn.toLocaleString("en-IN")} in / ${tset.today.tokensOut.toLocaleString("en-IN")} out tokens.` : ""} The default model is picked on the AI page; a chat can pick another beside the question.
                    </p>
                    <p className="tai-dim">The agent has {tset.readers || 0} readers (the exit coach, the tape, the level map, the Lab, the shared research, the web…). Low thinking asks once; Medium lets it read once more; High up to three times.</p>
                    {tset.models && tset.models.length > 0 && (
                      <>
                        <h5>Models, in order (measured answer time)</h5>
                        <ol className="tai-set__fast">
                          {tset.models.map((f) => (
                            <li key={f.name}>
                              {f.name} <small>{f.fallback ? "fallback · " : "default · "}{f.avgSec !== null ? `${f.avgSec}s` : "not measured yet"}</small>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                )}
              </span>
            )}
            {conv && (
              <button type="button" className="tai-icon" onClick={fresh0} disabled={busy} aria-label="New chat" data-tip="New chat">
                <IcNew />
              </button>
            )}
          </header>

          <div
            className="tai-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
            }}
          >
            {!conv ? (
              <div className="tai-welcome">
                <div className="tai-mark" aria-hidden="true">
                  <img src="/drishti-logo.svg" alt="" width="64" height="64" />
                </div>
                <h1>
                  {greeting()}, {firstName(user)}
                </h1>
                <p className="tai-welcome__sub">What would you like to know about your trading today?</p>
                <Composer value={text} onChange={setText} onSend={(v) => send(v)} onStop={stop} busy={busy} big inputRef={inputRef} files={attached} onFiles={addFiles} onRemoveFile={removeFile} hint={hint} mode={mode} onMode={setMode} choices={isOwner && tset ? tset.choices : null} model={picked} onModel={setPicked} effort={effort} onEffort={setEffort} defaultName={tset && tset.lead ? tset.lead.name : ""} />
                {instantChips.length > 0 && (
                  <div className="tai-instant" aria-label="Instant answers">
                    <span>⚡ Instant</span>
                    {instantChips.map((t) => (
                      <button key={t} type="button" onClick={() => send(t)} disabled={busy}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                <section className="tai-sugg" aria-label="Suggested questions">
                  <header>
                    <h2>{sugg && sugg.positions ? `Suggested now — from your ${sugg.positions} open position${sugg.positions === 1 ? "" : "s"} and the market` : "Suggested for you now"}</h2>
                    <button type="button" className="tai-icon" onClick={loadSugg} aria-label="Refresh the suggestions" data-tip="Refresh">
                      <IcRefresh />
                    </button>
                  </header>
                  {!sugg ? (
                    <ul className="tai-sugg__list is-loading" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => (
                        <li key={i} />
                      ))}
                    </ul>
                  ) : (
                    <ul className="tai-sugg__list">
                      {sugg.suggestions.map((s, i) => (
                        <li key={s.text} style={{ animationDelay: `${i * 50}ms` }}>
                          <button type="button" onClick={() => send(s.text)} className={`is-${s.kind}`}>
                            <span className="tai-sugg__i" aria-hidden="true">
                              {SUGGEST_ICON[s.kind] || "💬"}
                            </span>
                            <span className="tai-sugg__t">{s.text}</span>
                            <span className="tai-sugg__why">{s.why}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : (
              <div className="tai-thread">
                {msgs.map((m, i) =>
                  m.role === "user" ? (
                    <Question key={m.id || i} m={m} busy={busy} onEdit={(t) => send(t, i)} />
                  ) : (
                    <Answer key={m.id || i} m={m} fresh={fresh === m.id} last={i === lastAi && i === msgs.length - 1} busy={busy} onAsk={(t) => send(t)} onRetry={() => retryFrom(i)} />
                  )
                )}
                {job && (!conv.id || job.conv === conv.id) && <Working job={job} />}
                {dangling && (
                  <div className="tai-note">
                    <span>No answer is kept for this question{err ? "" : " (it was stopped, or the page was closed while it ran)"}.</span>
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => send(msgs[msgs.length - 1].text, msgs.length - 1)}>
                      <IcRetry /> Retry
                    </button>
                  </div>
                )}
                {err && <p className="tai-err">{err}</p>}
              </div>
            )}
          </div>

          {conv && !atBottom && (
            <button type="button" className="tai-down" onClick={() => setAtBottom(true)} aria-label="Jump to the latest">
              <IcDown />
            </button>
          )}
          {conv && (
            <div className="tai-foot">
              <Composer value={text} onChange={setText} onSend={(v) => send(v)} onStop={stop} busy={busy} inputRef={inputRef} files={attached} onFiles={addFiles} onRemoveFile={removeFile} hint={hint} mode={mode} onMode={setMode} choices={isOwner && tset ? tset.choices : null} model={picked} onModel={setPicked} effort={effort} onEffort={setEffort} defaultName={tset && tset.lead ? tset.lead.name : ""} />
              <p className="tai-dim">TradeAI can be wrong and never places orders — a second opinion, not advice. You decide.</p>
            </div>
          )}
          {!conv && err && <p className="tai-err tai-err--welcome">{err}</p>}
        </section>
      </div>
    </Shell>
  );
}
