// Upload a loan's documents and review what was found (28 Nov 2026) — nothing is saved until "Save to the loan book".
//
//   1. choose the files, several together: loan agreement, sanction letter, account statement, repayment schedule,
//      certificates… (PDF also locked or scanned, Excel, CSV, Word, photos; a locked PDF asks for its password)
//   2. the desk reads each by itself at once; NVIDIA's free AI then reads their words (identity numbers blanked first) and
//      their scanned pages and photos (sent whole: a picture cannot be blanked). Both can be switched off before choosing.
//   3. one review of them all: the schedule with its sums checked, every detail filled in with where it came from (and what
//      another document says instead), all of it editable, the loan it belongs to, and which months are already paid
//   4. Save keeps the loan, its details and every file
//
// Files are worked through one at a time; what you have typed is never overwritten by a later reading.

import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Alert } from "../ui";
import { DateField } from "../DatePicker";
import { bankLoans, dayName, rateText, rupees } from "./loanData";
import { URL_, useHidden } from "./shared";
import { ACCEPT, MAX_FILE, MAX_FILES, MAX_TOTAL, asKept, readPage, sendFile } from "./intake";
import { FileList, PaidChoice, ScheduleCard, Source } from "./ReviewParts";
import { DetailBoxes, showDetail } from "./DetailsPanel";

export { ACCEPT, sendFile, shrinkPicture } from "./intake";

const FIELDS = [
  ["name", "Loan name", "text"],
  ["kind", "Type", "kind"],
  ["openingDate", "Opening date", "date"],
  ["totalAmount", "Total amount (₹)", "money"],
  ["rate", "Interest rate (% a year)", "money"],
  ["emiAmount", "EMI amount (₹)", "money"],
  ["firstEmiDate", "First EMI date", "date"],
];
const WAITING = ["waiting", "reading"];
const isPhoto = (f) => /^image\//.test(f.blob.type);

export default function Upload({ data, loanId = "", onClose, onSaved }) {
  const [files, setFiles] = useState([]);
  const [infos, setInfos] = useState({}); // token → what the desk has from that one file
  const [review, setReview] = useState(null); // everything the chosen files give, as one
  const [useAi, setUseAi] = useState(true);
  const [useScans, setUseScans] = useState(true);
  const [left, setLeft] = useState(0); // the free AI's steps still to do
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [target, setTarget] = useState(loanId);
  const [typed, setTyped] = useState({}); // the loan's own boxes, only those changed by hand
  const [typedDetail, setTypedDetail] = useState({});
  const [remarks, setRemarks] = useState("");
  const [useChoice, setUseChoice] = useState(null); // null: use the schedule whenever it is complete
  const [paidPick, setPaidPick] = useState(null); // null: what a statement shows, else none
  const [more, setMore] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef(null);
  const alive = useRef(true);
  const list = useRef([]);
  const queue = useRef([]);
  const working = useRef(false);
  const seq = useRef(0);
  const ids = useRef(0);
  const aim = useRef({ loanId, chosen: Boolean(loanId), schedule: "" });
  const options = useRef({ words: true, scans: true });
  const h = useHidden();
  const ai = data.ai || { ready: false, setup: "" };
  options.current = { words: useAi, scans: useScans };

  useEffect(() => {
    alive.current = true;
    if (ref.current && ref.current.scrollIntoView) ref.current.scrollIntoView({ block: "nearest" });
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, []);

  const change = (fn) => {
    list.current = fn(list.current);
    if (alive.current) setFiles(list.current);
  };
  const patch = (id, p) => change((all) => all.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const keepInfo = (v) => alive.current && setInfos((all) => ({ ...all, [v.token]: v }));
  const countLeft = () => alive.current && setLeft(queue.current.filter((j) => j.type !== "read").length);

  /** Everything the chosen files give, read again as one. Only the newest answer is shown. */
  const refresh = async () => {
    const tokens = list.current.filter((f) => f.include && f.token).map((f) => f.token);
    const mine = (seq.current += 1);
    if (!tokens.length) {
      if (alive.current) setReview(null);
      return;
    }
    try {
      const r = await api(`${URL_}/documents/combine`, { method: "POST", body: { tokens, loanId: aim.current.loanId, scheduleToken: aim.current.schedule } });
      if (!alive.current || mine !== seq.current) return;
      setReview(r);
      // until you choose, the loan the documents match is the one they are saved to
      if (!aim.current.chosen && (r.matchId || "") !== aim.current.loanId) {
        aim.current.loanId = r.matchId || "";
        setTarget(aim.current.loanId);
      }
    } catch (e) {
      if (alive.current && mine === seq.current) setErr(e.message);
    }
  };

  /** The free AI's work on one file: its words, then each scanned page not yet read. */
  const aiJobs = (f, info, { words, scans }) => {
    const jobs = [];
    if (!info.ai.ready) return jobs;
    if (words && info.words && !info.file.unread) jobs.push({ type: "ai", id: f.id });
    if (scans) {
      const pages = info.scan.pages.filter((p) => p.ok && !info.scan.read.includes(p.page));
      pages.forEach((p, i) => jobs.push({ type: "page", id: f.id, page: p.page, at: i + 1, of: pages.length }));
    }
    return jobs;
  };

  const readOne = async (f, job) => {
    patch(f.id, { status: "reading", error: "" });
    try {
      const body = await asKept(f.blob);
      const info = await sendFile(body, { loanId: aim.current.chosen ? aim.current.loanId : "", password: job.password, keep: job.keep });
      if (!alive.current || !list.current.some((x) => x.id === f.id)) {
        api(`${URL_}/documents/${info.token}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      keepInfo(info);
      patch(f.id, { status: "read", token: info.token });
      queue.current.push(...aiJobs(f, info, options.current));
      countLeft();
      await refresh();
    } catch (e) {
      patch(f.id, { status: e.code === "password" ? "password" : "error", error: e.message });
    }
  };

  const aiOne = async (f, job) => {
    patch(f.id, { doing: job.type === "ai" ? "the free AI is reading its words…" : `the free AI is reading scanned page ${job.at} of ${job.of}…` });
    try {
      const info = job.type === "ai" ? await api(`${URL_}/documents/${f.token}/ai`, { method: "POST" }) : await readPage(f.token, job.page, isPhoto(f) ? f.blob : null);
      keepInfo(info);
      // two pages in a row that could not be read: the rest of this file is left, and can be asked for again
      const misses = job.type === "page" && info.ai.error && !info.scan.read.includes(job.page) ? (f.misses || 0) + 1 : 0;
      if (misses >= 2) queue.current = queue.current.filter((j) => !(j.id === f.id && j.type === "page"));
      patch(f.id, { doing: "", misses });
      await refresh();
    } catch (e) {
      queue.current = queue.current.filter((j) => !(j.id === f.id && j.type !== "read"));
      patch(f.id, { doing: "" });
      if (alive.current) setErr(`${f.name}: ${e.message}`);
    }
  };

  /** One thing at a time: every file is read by the desk first; the free AI's turns follow. */
  const pump = async () => {
    if (working.current) return;
    working.current = true;
    while (alive.current && queue.current.length) {
      const at = Math.max(0, queue.current.findIndex((j) => j.type === "read"));
      const [job] = queue.current.splice(at, 1);
      const f = list.current.find((x) => x.id === job.id);
      if (!f) continue;
      if (job.type === "read") await readOne(f, job);
      else await aiOne(f, job);
      countLeft();
    }
    working.current = false;
  };

  const add = (chosen) => {
    const all = Array.from(chosen || []);
    if (!all.length) return;
    setErr("");
    const room = MAX_FILES - list.current.length;
    let total = list.current.reduce((a, f) => a + f.size, 0);
    const added = [];
    let full = "";
    for (const blob of all) {
      if (added.length >= room) {
        full = `Up to ${MAX_FILES} documents are reviewed together: save these first, then add the rest.`;
        break;
      }
      if (total + blob.size > MAX_TOTAL) {
        full = "Together these are over 40 MB: save the first ones, then add the rest.";
        break;
      }
      total += blob.size;
      ids.current += 1;
      const tooBig = blob.size > MAX_FILE && !/^image\//.test(blob.type);
      added.push({ id: ids.current, blob, name: blob.name, size: blob.size, include: true, token: "", doing: "", status: tooBig ? "error" : "waiting", error: tooBig ? "The file is larger than 7 MB. Upload a smaller one, or only the pages that matter." : "" });
    }
    if (full) setErr(full);
    change((was) => [...was, ...added]);
    queue.current.push(...added.filter((f) => f.status === "waiting").map((f) => ({ type: "read", id: f.id })));
    pump();
  };

  const again = (f, job) => {
    patch(f.id, { status: "waiting", error: "" });
    queue.current.push({ type: "read", id: f.id, ...job });
    pump();
  };

  const take = (f) => {
    queue.current = queue.current.filter((j) => j.id !== f.id);
    if (f.token) api(`${URL_}/documents/${f.token}`, { method: "DELETE" }).catch(() => {});
    change((all) => all.filter((x) => x.id !== f.id));
    countLeft();
    refresh();
  };

  const include = (f, on) => {
    patch(f.id, { include: on });
    refresh();
  };

  const readAll = () => {
    for (const f of list.current) if (f.token && infos[f.token]) queue.current.push(...aiJobs(f, infos[f.token], { words: !infos[f.token].ai.done, scans: true }));
    countLeft();
    pump();
  };

  const stopAi = () => {
    queue.current = queue.current.filter((j) => j.type === "read");
    countLeft();
  };

  const hint = async (token, values) => {
    setErr("");
    setBusy("hint");
    try {
      keepInfo(await api(`${URL_}/documents/${token}/hint`, { method: "POST", body: values }));
      setUseChoice(null);
      await refresh();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const close = () => {
    queue.current = [];
    for (const f of list.current) if (f.token) api(`${URL_}/documents/${f.token}`, { method: "DELETE" }).catch(() => {});
    list.current = [];
    onClose();
  };

  const banks = bankLoans(data);
  const loan = banks.find((l) => l.id === target);
  const defs = data.detailDefs || [];
  const s = review ? review.schedule : null;
  const use = Boolean(s && s.found && !(s.needs || []).length && (useChoice === null ? true : useChoice));
  const nowMonth = data.today.slice(0, 7);
  const months = use ? [...new Set(s.rows.map((r) => r.date.slice(0, 7)))].filter((m) => m <= nowMonth) : [];
  const paid = (review && review.paid) || { months: [], how: "" };
  const pick = paidPick !== null ? (paidPick === "statement" && !paid.months.length ? "" : paidPick) : paid.months.length ? "statement" : "";
  const many = Boolean(review && review.files.length > 1);

  const coreValue = (k) => {
    if (typed[k] !== undefined) return typed[k];
    const v = review && review.values[k] ? String(review.values[k].value) : "";
    return k === "kind" && !v ? "other" : v;
  };
  const setCore = (k) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setTyped((x) => ({ ...x, [k]: v }));
  };
  // a detail: what you typed; else the documents' — except that a loan keeps its own, unless it is the lender's newer figure
  const had = (loan && loan.details) || {};
  const found = (review && review.details) || {};
  const detailValue = (d) => {
    if (typedDetail[d.key] !== undefined) return typedDetail[d.key];
    if (had[d.key] && !(d.group === "latest" && found[d.key])) return String(had[d.key].value);
    return found[d.key] ? String(found[d.key].value) : "";
  };
  const withValue = new Set(defs.filter((d) => found[d.key] || had[d.key] || typedDetail[d.key]).map((d) => d.key));
  const detailValues = Object.fromEntries(defs.map((d) => [d.key, detailValue(d)]));
  const setDetail = (k, v) => setTypedDetail((x) => ({ ...x, [k]: v }));
  const detailNote = (d) => {
    const doc = found[d.key];
    const value = detailValues[d.key];
    if (typedDetail[d.key] !== undefined && (!doc || String(doc.value) !== typedDetail[d.key])) return <small className="lo-src">typed by you{doc ? ` · the documents say ${h(showDetail(d, doc.value))}` : ""}</small>;
    if (doc && value === String(doc.value)) return <Source v={doc} name={d.key} many={many} show={(k, v) => showDetail(d, v)} onUse={setDetail} />;
    if (had[d.key])
      return (
        <>
          <small className="lo-src">already on the loan</small>
          {doc && (
            <span className="lo-other">
              <small>
                {doc.file} says {h(showDetail(d, doc.value))}
              </small>
              <button type="button" className="lo-link" onClick={() => setDetail(d.key, String(doc.value))} aria-label={`Use ${doc.value} for ${d.label}`}>
                Use this
              </button>
            </span>
          )}
        </>
      );
    return null;
  };

  // with these months ticked, does the book agree with the lender's own figure of what is owed?
  let check = null;
  if (use && found.outstanding && pick) {
    const ticked = new Set([...(pick === "statement" ? paid.months : months.filter((m) => m <= pick)), ...((loan && loan.rows) || []).filter((r) => r.paid).map((r) => r.month)]);
    const owed = Math.max(0, s.amount - s.rows.filter((r) => ticked.has(r.date.slice(0, 7))).reduce((a, r) => a + r.principal, 0));
    const stated = Number(found.outstanding.value);
    const asOn = found.asOnDate ? ` as on ${dayName(found.asOnDate.value)}` : "";
    const ok = Math.abs(owed - stated) < 5;
    check = { ok, text: ok ? `With these ticked, ${rupees(owed)} of principal is left: the same as ${found.outstanding.file}${asOn}.` : `With these ticked, ${rupees(owed)} of principal is left; ${found.outstanding.file} says ${rupees(stated)}${asOn}. Check which EMIs are ticked, or whether there was a part-payment.` };
  }

  const differs = loan && review ? [["totalAmount", loan.totalAmount, rupees], ["rate", loan.rate, rateText], ["emiAmount", loan.emiAmount, rupees], ["openingDate", loan.openingDate, dayName]].filter(([k, mine]) => review.values[k] && String(review.values[k].value) !== String(mine)) : [];
  const waiting = files.filter((f) => WAITING.includes(f.status)).length;
  const leftOut = files.filter((f) => !f.include || f.status === "password" || f.status === "error").length;
  const kept = review ? review.files.length : 0;
  const unreadByAi = files.some((f) => f.token && infos[f.token] && infos[f.token].ai.ready && ((infos[f.token].words && !infos[f.token].file.unread && !infos[f.token].ai.done) || infos[f.token].scan.pages.some((p) => p.ok && !infos[f.token].scan.read.includes(p.page))));
  const aiBusy = left > 0 || files.some((f) => f.doing);

  const save = async () => {
    setErr("");
    setBusy("save");
    queue.current = [];
    countLeft();
    try {
      const details = {};
      for (const d of defs) if (typedDetail[d.key] !== undefined || (withValue.has(d.key) && detailValues[d.key] !== "")) details[d.key] = detailValues[d.key];
      const body = { tokens: review.files.map((f) => f.token), loanId: target, scheduleToken: (s && s.token) || "", useSchedule: use, paidUpTo: pick && pick !== "statement" ? pick : "", paidMonths: pick === "statement" ? paid.months : [], details };
      if (!target) {
        const loanBody = Object.fromEntries(FIELDS.map(([k]) => [k, coreValue(k)]));
        body.loan = { ...loanBody, remarks, firstEmiDate: use ? s.first : loanBody.firstEmiDate };
      }
      const d = await api(`${URL_}/documents/apply-all`, { method: "POST", body });
      for (const f of list.current) if (f.token && !body.tokens.includes(f.token)) api(`${URL_}/documents/${f.token}`, { method: "DELETE" }).catch(() => {});
      list.current = [];
      onSaved(d);
    } catch (e) {
      if (!alive.current) return;
      setErr(e.message);
      setBusy("");
    }
  };

  const shownDetails = more ? new Set(defs.map((d) => d.key)) : withValue;

  return (
    <section className="lo-card lo-upload" ref={ref} aria-label="Upload a loan document">
      <header className="lo-upload__head">
        <div>
          <h3>{review ? "Check what was found, then save" : "Upload loan documents"}</h3>
          <p className="lo-note">{review ? "Nothing is in your loan book yet. Every box is filled from your documents and can be changed. Save keeps the files too, to view or download any time." : "Add them all together: loan agreement, sanction letter, account statement, repayment schedule, certificates or any other loan paper. They are read for you and joined into one loan."}</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={close} disabled={busy === "save"}>
          Close
        </button>
      </header>

      {!files.length && banks.length > 0 && (
        <label className="lo-field">
          <span>For which loan?</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              aim.current = { ...aim.current, loanId: e.target.value, chosen: Boolean(e.target.value) };
            }}
          >
            <option value="">Let the documents say</option>
            {banks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {files.length > 0 && <FileList files={files} infos={infos} onInclude={include} onRemove={take} onPassword={(f, password) => again(f, { password })} onKeep={(f) => again(f, { keep: true })} busy={busy === "save"} />}

      {files.length < MAX_FILES && (
        <label
          className={`lo-drop ${over ? "is-over" : ""} ${files.length ? "is-more" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept={ACCEPT}
            aria-label="Choose the loan documents"
            onChange={(e) => {
              const chosen = Array.from(e.target.files || []);
              e.target.value = "";
              add(chosen);
            }}
          />
          <b>{files.length ? "Add more documents" : "Choose files, or drop them here (several at once)"}</b>
          <span>PDF (also password-protected or scanned), Excel, CSV, Word, photos and screenshots · up to {MAX_FILES} files, 7 MB each</span>
        </label>
      )}

      {ai.ready ? (
        !review && (
          <div className="lo-aiopts">
            <label className="lo-check">
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
              <span>
                <b>Also read them with NVIDIA’s free AI</b> ({ai.model}): no paid AI is ever used here. A document’s words go to NVIDIA with account numbers, PAN, Aadhaar, phone, email and labelled names and addresses blanked; a name written elsewhere can remain.
              </span>
            </label>
            <label className="lo-check">
              <input type="checkbox" checked={useScans} onChange={(e) => setUseScans(e.target.checked)} />
              <span>
                <b>Read scanned pages and photos too.</b> A picture has no words to blank: each page goes to NVIDIA whole, with everything printed on it. Untick to keep scans as files only.
              </span>
            </label>
          </div>
        )
      ) : (
        <p className="lo-note">
          The desk reads typed documents by itself; a scan or a photo needs the free AI. {ai.setup} <a href="/me/ai">Open the AI page</a>.
        </p>
      )}

      {review && (aiBusy || unreadByAi) && (
        <div className="lo-ai" role="status">
          {aiBusy ? (
            <>
              <span>NVIDIA’s free AI is reading{left ? ` (${left} more step${left === 1 ? "" : "s"} after this one)` : ""}. This can take a few minutes. What is found fills in below, and what you type stays.</span>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={stopAi} disabled={!left}>
                Stop after this one
              </button>
            </>
          ) : (
            <>
              <span>Some words or scanned pages have not been read by the free AI. Words go blanked; a scanned page or photo goes whole.</span>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={readAll} disabled={Boolean(busy)}>
                Read them with free AI
              </button>
            </>
          )}
        </div>
      )}

      {review && (
        <>
          {review.warnings.length > 0 && (
            <div className="lo-otherloan" role="alert">
              <b>These may not all be about one loan</b>
              <ul className="lo-warns">
                {review.warnings.map((w) => (
                  <li key={w.token}>{h(w.why)} Untick “Part of this loan” to leave it out.</li>
                ))}
              </ul>
            </div>
          )}
          {review.summaries.length > 0 && (
            <ul className="lo-summaries">
              {review.summaries.map((x) => (
                <li key={x.token}>
                  <b>{x.file}</b> <span>{h(x.text)}</span>
                </li>
              ))}
            </ul>
          )}

          {review.schedules.length > 1 && (
            <fieldset className="lo-group lo-pick">
              <legend>{review.schedules.length} documents hold a schedule. Use the one in</legend>
              {review.schedules.map((x) => (
                <label key={x.token} className="lo-check">
                  <input
                    type="radio"
                    name="lo-schedule"
                    checked={s.token === x.token}
                    onChange={() => {
                      aim.current.schedule = x.token;
                      setUseChoice(null);
                      refresh();
                    }}
                  />
                  <span>
                    <b>{x.file}</b>: {x.count} instalments, {dayName(x.first)} to {dayName(x.last)}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <ScheduleCard key={s.token || "none"} s={s} use={use} onUse={setUseChoice} onHint={hint} busy={Boolean(busy)} />

          <label className="lo-field">
            <span>Save it to</span>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                aim.current = { ...aim.current, loanId: e.target.value, chosen: true };
                refresh();
              }}
            >
              <option value="">A new loan</option>
              {banks.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {review.matchId && banks.some((l) => l.id === review.matchId) && <small>These documents look like they belong to {banks.find((l) => l.id === review.matchId).name}.</small>}
          </label>

          {!target ? (
            <div className="lo-fields">
              {FIELDS.map(([k, label, type]) => {
                const fromSchedule = k === "firstEmiDate" && use;
                return (
                  <div key={k} className="lo-field">
                    {type !== "date" && <label htmlFor={`lo-up-${k}`}>{label}</label>}
                    {type === "kind" ? (
                      <select id={`lo-up-${k}`} value={coreValue("kind")} onChange={setCore("kind")}>
                        {data.kinds.filter((x) => x.id !== "family").map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    ) : type === "date" ? (
                      <DateField label={label} value={fromSchedule ? s.first : coreValue(k)} onChange={setCore(k)} disabled={fromSchedule} id={`lo-up-${k}`} />
                    ) : (
                      <input id={`lo-up-${k}`} inputMode={type === "money" ? "decimal" : undefined} value={coreValue(k)} onChange={setCore(k)} />
                    )}
                    <Source v={review.values[k]} name={k} many={many} onUse={(key, v) => setTyped((x) => ({ ...x, [key]: v }))} />
                  </div>
                );
              })}
              <div className="lo-field lo-field--wide">
                <label htmlFor="lo-up-remarks">Remarks</label>
                <input id="lo-up-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
              </div>
            </div>
          ) : (
            <div className="lo-existing">
              <p>
                {kept === 1 ? "The file is" : `The ${kept} files are`} kept with <b>{loan ? loan.name : "the loan"}</b>
                {use ? ", and its months take the schedule’s figures (ticks and remarks stay)." : "."}
              </p>
              {differs.length > 0 && (
                <ul className="lo-warns">
                  {differs.map(([k, mine, fmt]) => (
                    <li key={k}>
                      {k === "totalAmount" ? "Total amount" : k === "rate" ? "Interest rate" : k === "emiAmount" ? "EMI amount" : "Opening date"}: the documents say {h(String(fmt(review.values[k].value)))}, the book has {h(String(fmt(mine)))}. {use && k !== "openingDate" ? "The schedule’s figure is used." : "The book is not changed; edit the loan if the documents are right."}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {defs.length > 0 && (
            <section className="lo-found" aria-label="Details found in the documents">
              <header>
                <h4>
                  All the details found ({withValue.size})
                </h4>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setMore((x) => !x)} aria-expanded={more}>
                  {more ? "Show only what was found" : "Add other details"}
                </button>
              </header>
              {shownDetails.size ? (
                <DetailBoxes defs={defs} groups={data.detailGroups || []} values={detailValues} shown={shownDetails} onChange={setDetail} note={detailNote} idPrefix="lo-up-d" />
              ) : (
                <p className="lo-note">No charges, dates or other details were found yet. A sanction letter, agreement or statement usually states them.</p>
              )}
            </section>
          )}

          <PaidChoice paid={paid} months={months} value={pick} onChange={setPaidPick} check={check} />

          {(review.terms.length > 0 || review.watch.length > 0) && (
            <details className="lo-terms">
              <summary>
                <b>Clauses and charges found</b> ({review.terms.length})
              </summary>
              {review.watch.length > 0 && (
                <ul className="lo-warns">
                  {review.watch.map((w) => (
                    <li key={w}>{h(w)}</li>
                  ))}
                </ul>
              )}
              <ul>
                {review.terms.map((t, i) => (
                  <li key={i}>
                    <b>{t.title}</b>
                    {t.detail ? <span>{h(t.detail)}</span> : null}
                    {t.quote ? <q>{h(t.quote)}</q> : null}
                    <small className={`lo-src ${t.from === "ai" && !t.checked ? "is-warn" : ""}`}>
                      {t.from === "ai" ? (t.checked ? "found by the free AI · the words are in the document" : "from the free AI · these exact words are not in the document") : "from the document’s own words"}
                      {many && t.file ? ` · ${t.file}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {(waiting > 0 || leftOut > 0 || aiBusy) && (
            <p className="lo-note">
              {waiting > 0 ? `${waiting} more document${waiting === 1 ? " is" : "s are"} still being read: Save opens when ${waiting === 1 ? "it is" : "they are"} done. ` : ""}
              {leftOut > 0 ? `${leftOut} file${leftOut === 1 ? " is" : "s are"} not part of this save and will not be kept. ` : ""}
              {aiBusy ? "Saving now leaves the rest of the free AI’s reading undone." : ""}
            </p>
          )}
          <div className="lo-acts">
            <button type="button" className="adm-btn adm-btn--solid" onClick={save} disabled={Boolean(busy) || waiting > 0}>
              {busy === "save" ? "Saving…" : "Save to the loan book"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={close} disabled={busy === "save"}>
              Discard
            </button>
            {kept > 1 && <small className="lo-note">One save keeps all {kept} documents.</small>}
          </div>
        </>
      )}
      <Alert>{err}</Alert>
    </section>
  );
}
