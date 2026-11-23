// जन्म कुंडली — the owner's birth chart, for superadmins only, in Hindi.
//
// The page holds nothing about the person: the chart, its reading and the papers behind it come from the server
// (server/kundali.js), which gives them to a superadmin's session and to nobody else. What is here is what is the same
// for every chart: how a Kundali is drawn, the dasha arithmetic (jyotish.js), and the page.
//
//   सार            the chart at a glance, and what is running today
//   कुंडलियाँ       lagna, navamsa and dashamsa, drawn from the stored positions
//   ग्रह · भाव · योग · बल
//   दशा            Vimshottari, worked out for today — every period can be opened
//   विश्लेषण · रंग · उपाय
//   दोष · गोचर · विस्तृत फल (21 Nov 2026): a chart may also carry doshas, the coming transits, a fuller reading of each
//                  yoga, of each dasha and antardasha, and the whole method of each remedy — each shown only when present
//   दस्तावेज़        the stored papers: read here, open in a tab, download, add, rename, remove; the chart file itself
//                  can be exported and imported (that is how it is carried to another server)
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { adminPath } from "../paths";
import { useDeskTheme } from "../stock/analyzer/theme";
import { useDialog } from "../dialog/DialogProvider";
import { Loading } from "../ui";
import KundaliChart from "./KundaliChart";
import { HOUSE_NAMES, ORDINALS, antardashas, hindiDate, planetName, pratyantars, progress, runningOn, signName, todayYmd } from "./jyotish";
import "./kundali.css";
import { useTopics } from "../live";

const PART = 2 * 1024 * 1024; // each upload part (the server takes up to 2.5 MB)
const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const hex16 = () => Array.from(window.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const when = (iso) => (iso ? new Date(iso).toLocaleDateString("hi-IN", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Bytes to the server (a file's part, or the chart file): not JSON, so not through api(). */
async function sendBytes(url, method, body) {
  const res = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "vpt", Accept: "application/json" }, body });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* not JSON */
  }
  if (!res.ok) throw new Error((data && data.message) || `सर्वर ने ${res.status} लौटाया`);
  return data;
}

const SECTIONS = [
  ["saar", "सार"],
  ["janm", "जन्म विवरण"],
  ["kundali", "कुंडलियाँ"],
  ["grah", "ग्रह"],
  ["bhav", "भाव"],
  ["yog", "योग"],
  ["dosh", "दोष"],
  ["dasha", "दशा"],
  ["gochar", "गोचर"],
  ["vishleshan", "विश्लेषण"],
  ["rang", "शुभ रंग"],
  ["upay", "उपाय"],
  ["jaanch", "जाँचें"],
  ["dastavez", "दस्तावेज़"],
];

function Rows({ rows }) {
  return (
    <dl className="kd-dl">
      {(rows || []).map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A reading may be one paragraph or several. */
const paras = (x) => (Array.isArray(x) ? x.filter(Boolean) : x ? [x] : []);
const isoOf = (ymd) => `${ymd[0]}-${String(ymd[1]).padStart(2, "0")}-${String(ymd[2]).padStart(2, "0")}`;

/** "Read more": a fold that opens by itself when the page is printed (see the page's beforeprint handler). */
function Fold({ label = "विस्तार से पढ़ें", children }) {
  return (
    <details className="kd-fold">
      <summary>{label}</summary>
      <div className="kd-fold__body">{children}</div>
    </details>
  );
}

function Section({ id, title, lead, children }) {
  return (
    <section className="kd-sec" id={`kd-${id}`} aria-labelledby={`kd-${id}-h`}>
      <header className="kd-sec__head">
        <h2 id={`kd-${id}-h`}>{title}</h2>
        {lead && <p>{lead}</p>}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ दशा */
function Period({ label, row, day, strong }) {
  if (!row) return null;
  const pct = Math.round(progress(row, day) * 100);
  return (
    <div className={`kd-now__p${strong ? " is-strong" : ""}`}>
      <span className="kd-now__k">{label}</span>
      <b>{planetName(row.lord)}</b>
      <small>
        {hindiDate(row.from)} – {hindiDate(row.to)}
      </small>
      <span className="kd-bar" role="img" aria-label={`${pct}% बीत चुका`}>
        <i style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function Dasha({ dasha, brief = false }) {
  const day = useMemo(() => todayYmd(), []);
  const on = useMemo(() => runningOn(dasha, day), [dasha, day]);
  const [open, setOpen] = useState(null); // the mahadasha whose antardashas are shown (its lord), else the running one
  const [openAd, setOpenAd] = useState(null);
  if (!on.list.length) return null;
  const md = on.list.find((r) => r.lord === open) || on.maha || on.list[0];
  const ads = antardashas(md);
  const ad = ads.find((r) => r.lord === openAd) || (md === on.maha ? on.antar : null);
  const pds = pratyantars(ad);
  const det = dasha.detail && dasha.detail[md.lord]; // the fuller reading of this mahadasha and its antardashas, when written
  const isNow = (row, running) => Boolean(running && row.lord === running.lord && row.from.join() === running.from.join());
  const birthYear = dasha.birth[0];
  const now = on.maha && (
    <div className="kd-now" aria-label="आज की दशा">
      <Period label="महादशा" row={on.maha} day={day} strong />
      <Period label="अंतर्दशा" row={on.antar} day={day} />
      <Period label="प्रत्यंतर" row={on.praty} day={day} />
    </div>
  );
  if (brief) return now || null;
  return (
    <>
      {now}
      <div className="kd-dasha">
        <div className="kd-card">
          <h3>महादशाएँ</h3>
          <ul className="kd-md">
            {on.list.map((r) => (
              <li key={r.lord} className={`${isNow(r, on.maha) ? "is-now" : ""}${r === md ? " is-open" : ""}`}>
                <button type="button" onClick={() => {
                    setOpen(r.lord);
                    setOpenAd(null);
                  }} aria-pressed={r === md}>
                  <b>{planetName(r.lord)}</b>
                  <span>
                    {r.atBirth ? "जन्म" : hindiDate(r.from)} – {hindiDate(r.to)}
                  </span>
                  <small>
                    {r.atBirth ? `जन्म पर शेष ${dasha.balance[0]} वर्ष ${dasha.balance[1]} माह ${dasha.balance[2]} दिन` : `${r.years} वर्ष`} · आयु {Math.max(0, r.from[0] - birthYear)}–{r.to[0] - birthYear}
                    {isNow(r, on.maha) ? " · अभी" : ""}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="kd-card">
          <h3>
            {planetName(md.lord)} महादशा की अंतर्दशाएँ
          </h3>
          {dasha.notes && dasha.notes[md.lord] && <p className="kd-note">{dasha.notes[md.lord]}</p>}
          <ul className="kd-ad">
            {ads.map((r) => (
              <li key={r.lord} className={`${isNow(r, on.antar) && md === on.maha ? "is-now" : ""}${ad && r.lord === ad.lord ? " is-open" : ""}`}>
                <button type="button" onClick={() => setOpenAd(r.lord)} aria-pressed={Boolean(ad && r.lord === ad.lord)}>
                  <b>
                    {planetName(md.lord)}–{planetName(r.lord)}
                  </b>
                  <span>
                    {hindiDate(r.from)} – {hindiDate(r.to)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="kd-card">
          <h3>{ad ? `${planetName(md.lord)}–${planetName(ad.lord)} के प्रत्यंतर` : "प्रत्यंतर"}</h3>
          {!ad && <p className="kd-note">किसी अंतर्दशा को चुनें — उसके नौ प्रत्यंतर यहाँ दिखेंगे।</p>}
          <ul className="kd-ad kd-ad--pd">
            {pds.map((r) => (
              <li key={r.lord} className={isNow(r, on.praty) && ad === on.antar ? "is-now" : ""}>
                <span>
                  <b>{planetName(r.lord)}</b>
                  <span>
                    {hindiDate(r.from)} – {hindiDate(r.to)}
                  </span>
                </span>
                {dasha.pd && dasha.pd[r.lord] && <small className="kd-ad__say">{dasha.pd[r.lord]}</small>}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {det && (
        <div className="kd-card kd-prose kd-dasha-read">
          <h3>{planetName(md.lord)} महादशा का फल</h3>
          {paras(det.md).map((t) => (
            <p key={t}>{t}</p>
          ))}
          {det.ad && (
            <>
              <h4>अंतर्दशाओं का फल</h4>
              <ol className="kd-adread">
                {ads
                  .filter((r) => det.ad[r.lord])
                  .map((r) => (
                    <li key={r.lord} className={`${isNow(r, on.antar) && md === on.maha ? "is-now" : ""}${ad && r.lord === ad.lord ? " is-open" : ""}`}>
                      <b>
                        {planetName(md.lord)}–{planetName(r.lord)}
                      </b>
                      <small>
                        {hindiDate(r.from)} – {hindiDate(r.to)}
                        {isNow(r, on.antar) && md === on.maha ? " · अभी चल रही है" : ""}
                      </small>
                      <p>{det.ad[r.lord]}</p>
                    </li>
                  ))}
              </ol>
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ दस्तावेज़ */
function Papers({ view, onView, hasChart }) {
  const ask = useDialog();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [shown, setShown] = useState(null); // { id, url, kind }
  const [naming, setNaming] = useState(null); // { id, value } while a paper's name is being changed
  const fileRef = useRef(null);
  const chartRef = useRef(null);
  const docs = view.documents || [];
  const limits = view.limits || {};

  // the paper being read is fetched with the session and shown from memory: its address is never one that can be shared
  const close = useCallback(() => {
    setShown((s) => {
      if (s && s.url) URL.revokeObjectURL(s.url);
      return null;
    });
  }, []);
  useEffect(() => close, [close]);

  const show = async (d) => {
    if (shown && shown.id === d.id) return close();
    close();
    setBusy(`show:${d.id}`);
    setMsg({ kind: "", text: "" });
    try {
      const res = await fetch(`/api/admin/kundali/documents/${d.id}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`सर्वर ने ${res.status} लौटाया`);
      const blob = await res.blob();
      setShown({ id: d.id, url: URL.createObjectURL(blob), kind: d.kind, label: d.label });
    } catch (err) {
      setMsg({ kind: "error", text: `दस्तावेज़ खुल नहीं सका: ${err.message}` });
    }
    setBusy("");
  };

  const upload = async (file) => {
    if (!file) return;
    setMsg({ kind: "", text: "" });
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) return setMsg({ kind: "error", text: "केवल PDF या चित्र (JPEG, PNG, WEBP) जोड़े जा सकते हैं।" });
    if (limits.maxFile && file.size > limits.maxFile) return setMsg({ kind: "error", text: `फ़ाइल ${size(limits.maxFile)} से बड़ी है।` });
    const id = hex16();
    const of = Math.max(1, Math.ceil(file.size / PART));
    try {
      let last = null;
      for (let i = 0; i < of; i++) {
        setBusy(`भेजा जा रहा है… ${Math.round((i / of) * 100)}%`);
        const q = new URLSearchParams({ id, part: String(i), of: String(of), name: file.name });
        last = await sendBytes(`/api/admin/kundali/upload?${q}`, "POST", file.slice(i * PART, (i + 1) * PART));
      }
      if (last && last.view) onView(last.view);
      setMsg({ kind: "ok", text: `“${file.name}” सुरक्षित रख ली गई।` });
    } catch (err) {
      setMsg({ kind: "error", text: `फ़ाइल जोड़ी नहीं जा सकी: ${err.message}` });
    }
    setBusy("");
  };

  const rename = async (e) => {
    e.preventDefault();
    const { id, value } = naming;
    const label = value.trim();
    setNaming(null);
    if (!label || label === (docs.find((d) => d.id === id) || {}).label) return;
    try {
      onView(await api(`/api/admin/kundali/documents/${id}`, { method: "PUT", body: { label } }));
    } catch (err) {
      setMsg({ kind: "error", text: `नाम बदला नहीं जा सका: ${err.message}` });
    }
  };

  const remove = async (d) => {
    const yes = await ask({
      tone: "danger",
      title: "यह दस्तावेज़ हटाएँ?",
      body: (
        <>
          <p>
            <b>{d.label}</b> इस सर्वर से हमेशा के लिए हट जाएगा।
          </p>
          <p>यदि इसकी प्रति आपके पास नहीं है तो पहले इसे डाउनलोड कर लें। कुंडली का विश्लेषण इससे नहीं हटता।</p>
        </>
      ),
      confirmText: "हटाएँ",
      cancelText: "रहने दें",
    });
    if (!yes) return;
    if (shown && shown.id === d.id) close();
    try {
      onView(await api(`/api/admin/kundali/documents/${d.id}`, { method: "DELETE" }));
      setMsg({ kind: "ok", text: `“${d.label}” हटा दिया गया।` });
    } catch (err) {
      setMsg({ kind: "error", text: `हटाया नहीं जा सका: ${err.message}` });
    }
  };

  const importChart = async (file) => {
    if (!file) return;
    setMsg({ kind: "", text: "" });
    if (limits.maxChart && file.size > limits.maxChart) return setMsg({ kind: "error", text: "यह कुंडली फ़ाइल नहीं लगती (बहुत बड़ी है)।" });
    if (hasChart) {
      const yes = await ask({ title: "कुंडली फ़ाइल बदलें?", body: <p>इस पृष्ठ की कुंडली और विश्लेषण नई फ़ाइल से बदल जाएँगे। दस्तावेज़ वैसे ही रहेंगे।</p>, confirmText: "बदलें", cancelText: "रहने दें" });
      if (!yes) return;
    }
    setBusy("कुंडली फ़ाइल पढ़ी जा रही है…");
    try {
      onView(await sendBytes("/api/admin/kundali/chart", "PUT", file));
      setMsg({ kind: "ok", text: "कुंडली फ़ाइल रख ली गई।" });
    } catch (err) {
      setMsg({ kind: "error", text: `कुंडली फ़ाइल नहीं रखी जा सकी: ${err.message}` });
    }
    setBusy("");
  };

  return (
    <>
      <p className="kd-lead">
        ये काग़ज़ इसी सर्वर पर रखे हैं और केवल सुपरएडमिन को दिखते हैं। इन्हें यहीं पढ़ें, नई टैब में खोलें या डाउनलोड करें। ये वेबसाइट के कोड का हिस्सा नहीं हैं।
      </p>
      {docs.length === 0 && <p className="kd-empty">अभी कोई दस्तावेज़ नहीं रखा गया है।</p>}
      <ul className="kd-papers">
        {docs.map((d) => (
          <li key={d.id}>
            <span className={`kd-papers__ic kd-papers__ic--${d.kind}`} aria-hidden="true">
              {d.kind === "pdf" ? "PDF" : "चित्र"}
            </span>
            <div className="kd-papers__id">
              {naming && naming.id === d.id ? (
                <form className="kd-papers__name" onSubmit={rename}>
                  <input value={naming.value} onChange={(e) => setNaming({ id: d.id, value: e.target.value })} maxLength={90} autoFocus aria-label="दस्तावेज़ का नाम" />
                  <button className="adm-btn adm-btn--solid adm-btn--sm">सहेजें</button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setNaming(null)}>
                    रहने दें
                  </button>
                </form>
              ) : (
                <b>{d.label}</b>
              )}
              <small>
                {size(d.size)} · {when(d.uploadedAt)} को रखा गया
              </small>
            </div>
            <span className="kd-papers__acts">
              <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => show(d)} disabled={busy === `show:${d.id}`} aria-expanded={Boolean(shown && shown.id === d.id)}>
                {shown && shown.id === d.id ? "बंद करें" : "यहीं पढ़ें"}
              </button>
              <a className="adm-btn adm-btn--ghost adm-btn--sm" href={`/api/admin/kundali/documents/${d.id}`} target="_blank" rel="noopener noreferrer">
                नई टैब में खोलें
              </a>
              <a className="adm-btn adm-btn--ghost adm-btn--sm" href={`/api/admin/kundali/documents/${d.id}?download=1`} download>
                डाउनलोड
              </a>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setNaming({ id: d.id, value: d.label })}>
                नाम बदलें
              </button>
              <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" onClick={() => remove(d)}>
                हटाएँ
              </button>
            </span>
          </li>
        ))}
      </ul>
      {shown && (
        <div className="kd-viewer" role="region" aria-label={`${shown.label} — दस्तावेज़`}>
          {shown.kind === "pdf" ? <iframe title={shown.label} src={shown.url} /> : <img src={shown.url} alt={shown.label} />}
        </div>
      )}
      <div className="kd-papers__add">
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" hidden onChange={(e) => {
            upload(e.target.files[0]);
            e.target.value = "";
          }} aria-label="दस्तावेज़ चुनें" />
        <button type="button" className="adm-btn adm-btn--solid" onClick={() => fileRef.current && fileRef.current.click()} disabled={Boolean(busy)}>
          दस्तावेज़ जोड़ें
        </button>
        <span className="kd-small">PDF या चित्र · एक फ़ाइल {limits.maxFile ? size(limits.maxFile) : "60 MB"} तक</span>
      </div>

      <div className="kd-chartfile">
        <h3>कुंडली फ़ाइल</h3>
        <p className="kd-small">
          इस पृष्ठ की कुंडली और विश्लेषण एक फ़ाइल में रखे हैं। उसे निर्यात करके सुरक्षित रखें; दूसरे सर्वर पर यही फ़ाइल आयात करने से यह पृष्ठ वहाँ भी बन जाता है।
          {view.chartAt ? ` पिछली बार ${when(view.chartAt)} को रखी गई।` : ""}
        </p>
        <div className="kd-papers__add">
          {hasChart && (
            <a className="adm-btn adm-btn--ghost" href="/api/admin/kundali/chart/export" download>
              कुंडली फ़ाइल निर्यात करें
            </a>
          )}
          <input ref={chartRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
              importChart(e.target.files[0]);
              e.target.value = "";
            }} aria-label="कुंडली फ़ाइल चुनें" />
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => chartRef.current && chartRef.current.click()} disabled={Boolean(busy)}>
            कुंडली फ़ाइल आयात करें
          </button>
        </div>
      </div>
      {busy && !busy.startsWith("show:") && (
        <p className="kd-status" role="status">
          {busy}
        </p>
      )}
      {msg.text && (
        <p className={`kd-status kd-status--${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ the page */
export default function Kundali() {
  const [theme, toggleTheme] = useDeskTheme();
  const [view, setView] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const before = document.title;
    const lang = document.documentElement.lang;
    document.title = "जन्म कुंडली";
    document.documentElement.lang = "hi";
    return () => {
      document.title = before;
      document.documentElement.lang = lang;
    };
  }, []);
  useEffect(() => {
    api("/api/admin/kundali")
      .then(setView)
      .catch((e) => setError(e.message || "कुंडली पढ़ी नहीं जा सकी।"));
  }, []);
  useTopics(["kundali"], () => {
    api("/api/admin/kundali")
      .then(setView)
      .catch(() => {});
  });

  const c = view && view.chart;
  const marks = useMemo(() => {
    const m = {};
    // Rahu and Ketu always move backwards: marking them would say nothing
    for (const p of (c && c.planets) || []) {
      const retro = p.retro && p.id !== "ra" && p.id !== "ke";
      if (retro || p.combust) m[p.id] = `${retro ? "व" : ""}${p.combust ? "अ" : ""}`;
    }
    return m;
  }, [c]);
  // a section that has nothing to show in this chart is left out of the jump bar too
  const sections = c ? SECTIONS.filter(([id]) => (id !== "dosh" || Array.isArray(c.doshas)) && (id !== "gochar" || Boolean(c.gochar))) : SECTIONS.filter(([id]) => id === "dastavez");
  // printing opens every "read more", and closes again the ones that were closed
  useEffect(() => {
    let opened = [];
    const before = () => {
      opened = [...document.querySelectorAll(".kd details:not([open])")];
      opened.forEach((d) => d.setAttribute("open", ""));
    };
    const after = () => {
      opened.forEach((d) => d.removeAttribute("open"));
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  const today = useMemo(() => isoOf(todayYmd()), []);

  return (
    <div className="kd" lang="hi">
      <header className="kd-top">
        <div className="kd-wrap kd-top__row">
          <Link to={adminPath()} className="kd-back">
            <span aria-hidden="true">←</span> मेरा क्षेत्र
          </Link>
          <span className="kd-top__title">
            <span className="kd-om" aria-hidden="true">
              ॐ
            </span>
            जन्म कुंडली
          </span>
          <span className="kd-top__acts">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => window.print()}>
              छापें
            </button>
            <button type="button" className="kd-icon" onClick={toggleTheme} aria-label={theme === "dark" ? "दिन का रूप" : "रात का रूप"}>
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </span>
        </div>
        <nav className="kd-wrap kd-jump" aria-label="इस पृष्ठ के भाग">
          {sections.map(([id, name]) => (
            <a key={id} href={`#kd-${id}`}>
              {name}
            </a>
          ))}
        </nav>
      </header>

      <main className="kd-wrap kd-main">
        {error && (
          <p className="kd-status kd-status--error" role="alert">
            {error}
          </p>
        )}
        {!view && !error && <Loading label="कुंडली खुल रही है…" />}

        {view && !c && (
          <section className="kd-hero">
            <p className="kd-eyebrow">केवल सुपरएडमिन के लिए</p>
            <h1>जन्म कुंडली</h1>
            <p className="kd-lead">
              अभी इस सर्वर पर कुंडली नहीं रखी गई है। कुंडली और उसका विश्लेषण वेबसाइट के कोड में नहीं, अलग सुरक्षित फ़ाइल में रहते हैं। नीचे “कुंडली फ़ाइल आयात करें” से वह फ़ाइल चुनें (जिस सर्वर पर यह पृष्ठ बना हुआ है, वहाँ से “निर्यात” की हुई), और अपनी पत्रिका की PDF “दस्तावेज़ जोड़ें” से रखें।
            </p>
          </section>
        )}

        {c && (
          <>
            <section className="kd-hero" id="kd-saar">
              <p className="kd-eyebrow">श्री गणेशाय नमः · केवल सुपरएडमिन के लिए</p>
              <h1>{(c.person && c.person.name) || "जन्म कुंडली"}</h1>
              <p className="kd-hero__sub">
                लग्न {signName(c.lagna.sign)} {c.lagna.deg} · {c.lagna.nak} चरण {c.lagna.pada}
              </p>
              <div className="kd-tiles">
                {(c.summary || []).map((s) => (
                  <div className="kd-tile" key={s.k}>
                    <span>{s.k}</span>
                    <b>{s.v}</b>
                    <small>{s.d}</small>
                  </div>
                ))}
              </div>
              {c.dasha && <Dasha dasha={c.dasha} brief />}
              {Array.isArray(c.keyPoints) && (
                <ul className="kd-points">
                  {c.keyPoints.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </section>

            <Section id="janm" title="जन्म विवरण और पंचांग">
              <div className="kd-grid3">
                <div className="kd-card">
                  <h3>जन्म</h3>
                  <Rows rows={c.birth && c.birth.rows} />
                </div>
                <div className="kd-card">
                  <h3>पंचांग</h3>
                  <Rows rows={c.panchang} />
                </div>
                <div className="kd-card">
                  <h3>अवकहड़ा</h3>
                  <Rows rows={c.avakhada} />
                </div>
              </div>
            </Section>

            <Section id="kundali" title="कुंडलियाँ" lead="उत्तर भारतीय शैली: खाने स्थिर हैं — ऊपर बीच का खाना लग्न है और भाव घड़ी की उलटी दिशा में चलते हैं; हर खाने में लिखा अंक वहाँ पड़ने वाली राशि है (1 मेष … 12 मीन)। छोटा “व” वक्री और “अ” अस्त ग्रह बताता है।">
              <div className="kd-grid3">
                {(c.charts || []).map((ch) => (
                  <figure className="kd-card kd-fig" key={ch.id}>
                    <figcaption>
                      <h3>{ch.title}</h3>
                      <small>{ch.sub}</small>
                    </figcaption>
                    <KundaliChart lagna={ch.lagna} at={ch.at} marks={ch.id === "D1" ? marks : {}} title={ch.title} />
                    {ch.note && <p className="kd-note">{ch.note}</p>}
                  </figure>
                ))}
              </div>
              {c.vargas && (
                <details className="kd-card kd-more">
                  <summary>सभी वर्ग कुंडलियों की तालिका (षोडशवर्ग)</summary>
                  <div className="kd-scroll">
                    <table className="kd-table kd-table--num">
                      <thead>
                        <tr>
                          <th scope="col">वर्ग</th>
                          {c.vargas.cols.map((x) => (
                            <th scope="col" key={x}>
                              {x}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {c.vargas.rows.map((r) => (
                          <tr key={r[0]}>
                            <th scope="row">{r[0]}</th>
                            {r.slice(1).map((n, i) => (
                              <td key={i} title={signName(n)}>
                                {n}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {c.vargas.note && <p className="kd-note">{c.vargas.note}</p>}
                </details>
              )}
            </Section>

            <Section id="grah" title="ग्रह स्थिति">
              <div className="kd-card kd-scroll">
                <table className="kd-table">
                  <thead>
                    <tr>
                      <th scope="col">ग्रह</th>
                      <th scope="col">राशि</th>
                      <th scope="col">अंश</th>
                      <th scope="col">नक्षत्र · चरण</th>
                      <th scope="col">भाव</th>
                      <th scope="col">स्थिति</th>
                      <th scope="col">राशि / नक्षत्र स्वामी</th>
                      <th scope="col">टिप्पणी</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.planets.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">
                          {planetName(p.id)}
                          {p.retro && <span className="kd-chip">वक्री</span>}
                          {p.combust && <span className="kd-chip kd-chip--warn">अस्त</span>}
                        </th>
                        <td>{signName(p.sign)}</td>
                        <td className="kd-num">{p.deg}</td>
                        <td>
                          {p.nak} · {p.pada}
                        </td>
                        <td>{ORDINALS[(p.house || 1) - 1]}</td>
                        <td>{p.state}</td>
                        <td>{p.lords}</td>
                        <td>{p.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {c.shadbala && (
                <div className="kd-card">
                  <h3>षड्बल</h3>
                  <ul className="kd-bala">
                    {c.shadbala.rows.map((r) => (
                      <li key={r.id}>
                        <b>{planetName(r.id)}</b>
                        <span className="kd-bar" role="img" aria-label={`आवश्यकता का ${r.ratio} गुना`}>
                          <i style={{ width: `${Math.min(100, (r.ratio / 1.8) * 100)}%` }} />
                          <em style={{ left: `${(1 / 1.8) * 100}%` }} />
                        </span>
                        <small>
                          {r.rupa} रूप · आवश्यक {r.need} · अनुपात {r.ratio}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <p className="kd-note">खड़ी रेखा न्यूनतम आवश्यक बल है। {c.shadbala.note}</p>
                </div>
              )}
            </Section>

            <Section id="bhav" title="बारह भाव" lead={c.housesNote}>
              <div className="kd-houses">
                {(c.houses || []).map((h) => (
                  <article className="kd-card kd-house" key={h.n}>
                    <header>
                      <span className="kd-house__n">{h.n}</span>
                      <div>
                        <h3>{HOUSE_NAMES[h.n - 1]}</h3>
                        <small>
                          {signName(h.sign)} · स्वामी {h.lord} — {h.lordIn}
                        </small>
                      </div>
                    </header>
                    <p className="kd-house__has">
                      <span>बैठे ग्रह</span> {h.has}
                    </p>
                    <p>{h.text}</p>
                    <footer>
                      <span>बिंदु {h.sav}</span>
                      <span>भावबल {h.bala}</span>
                      <span>क्रम {h.rank}</span>
                    </footer>
                  </article>
                ))}
              </div>
            </Section>

            <Section id="yog" title="योग" lead="हर योग के साथ उसका आधार लिखा है — किन ग्रहों से बना — ताकि उसे कुंडली में स्वयं देखा जा सके।">
              <div className="kd-yogas">
                {(c.yogas || []).map((y) => (
                  <article className="kd-card kd-yoga" key={y.name}>
                    <header>
                      <h3>{y.name}</h3>
                      <span className="kd-chip">{y.from}</span>
                    </header>
                    <p className="kd-yoga__basis">{y.basis}</p>
                    {y.effect && <p>{y.effect}</p>}
                    {y.strength && (
                      <p className="kd-fold__k">
                        <b>बल:</b> {y.strength}
                      </p>
                    )}
                    {(paras(y.detail).length > 0 || y.when || y.do) && (
                      <Fold>
                        {paras(y.detail).map((t) => (
                          <p key={t}>{t}</p>
                        ))}
                        {y.when && (
                          <p className="kd-fold__k">
                            <b>कब फलित:</b> {y.when}
                          </p>
                        )}
                        {y.do && (
                          <p className="kd-fold__k">
                            <b>क्या करें:</b> {y.do}
                          </p>
                        )}
                      </Fold>
                    )}
                  </article>
                ))}
              </div>
            </Section>

            {Array.isArray(c.doshas) && (
              <Section id="dosh" title="दोष विचार" lead={c.doshasNote}>
                <div className="kd-yogas">
                  {c.doshas.map((d) => (
                    <article className={`kd-card kd-yoga kd-dosh kd-dosh--${d.tone === "ok" ? "ok" : d.tone === "warn" ? "warn" : "info"}`} key={d.name}>
                      <header>
                        <h3>{d.name}</h3>
                        <span className={`kd-chip${d.tone === "ok" ? " kd-chip--ok" : d.tone === "warn" ? " kd-chip--warn" : ""}`}>{d.status}</span>
                      </header>
                      {d.basis && <p className="kd-yoga__basis">{d.basis}</p>}
                      {paras(d.detail).map((t) => (
                        <p key={t}>{t}</p>
                      ))}
                      {d.remedy && (
                        <p className="kd-fold__k">
                          <b>उपाय:</b> {d.remedy}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </Section>
            )}

            <Section id="dasha" title="विंशोत्तरी दशा" lead="किसी महादशा को चुनें तो उसकी अंतर्दशाएँ, और अंतर्दशा चुनें तो उसके प्रत्यंतर दिखते हैं। जो अभी चल रहा है वह चिह्नित है।">
              {c.dasha && <Dasha dasha={c.dasha} />}
              {c.dasha && Array.isArray(c.dasha.reading) && (
                <div className="kd-card kd-prose">
                  {c.dasha.reading.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </div>
              )}
              {c.sadesati && (
                <div className="kd-card">
                  <h3>साढ़े साती और ढैया</h3>
                  <div className="kd-scroll">
                    <table className="kd-table">
                      <tbody>
                        {c.sadesati.rows.map((r) => (
                          <tr key={r[0] + r[1]} className={r[2] === "चल रही है" ? "is-now" : ""}>
                            <th scope="row">{r[0]}</th>
                            <td>{r[1]}</td>
                            <td>{r[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="kd-note">{c.sadesati.note}</p>
                </div>
              )}
            </Section>

            {c.gochar && (
              <Section id="gochar" title="गोचर — आने वाले वर्ष" lead={c.gochar.intro}>
                <div className="kd-yogas">
                  {(c.gochar.rows || []).map((r) => {
                    const now = (r.spans || []).some(([a, b]) => a <= today && today < b);
                    // the chip holds the house alone ("द्वादश"); what follows a dash goes on the line below
                    const [house, more] = String(r.house || "").split(" — ");
                    return (
                      <article className={`kd-card kd-yoga kd-gochar${now ? " is-now" : ""}`} key={`${r.graha}${r.sign}`}>
                        <header>
                          <h3>
                            {r.graha} · {r.sign}
                          </h3>
                          <span className={`kd-chip${now ? " kd-chip--ok" : ""}`}>{now ? "अभी" : house}</span>
                        </header>
                        <p className="kd-yoga__basis">
                          {r.when}
                          {now && r.house ? ` · ${r.house}` : more ? ` · ${more}` : ""}
                        </p>
                        {paras(r.effect).map((t) => (
                          <p key={t}>{t}</p>
                        ))}
                      </article>
                    );
                  })}
                </div>
                {paras(c.gochar.notes).length > 0 && (
                  <div className="kd-card kd-prose">
                    {paras(c.gochar.notes).map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                  </div>
                )}
              </Section>
            )}

            <Section id="vishleshan" title="विश्लेषण">
              {(c.analysis || []).map((a) => (
                <article className={`kd-card kd-prose${a.id === "trading" ? " kd-prose--key" : ""}`} key={a.id} id={`kd-a-${a.id}`}>
                  <h3>{a.title}</h3>
                  {(a.paras || []).map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                  {Array.isArray(a.points) && (
                    <ul>
                      {a.points.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  )}
                  {(a.after || []).map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </article>
              ))}
            </Section>

            {c.colours && (
              <Section id="rang" title="शुभ रंग — और इस वेबसाइट के रंग" lead={c.colours.intro}>
                <div className="kd-card kd-scroll">
                  <table className="kd-table">
                    <thead>
                      <tr>
                        <th scope="col">ग्रह</th>
                        <th scope="col">कुंडली में भूमिका</th>
                        <th scope="col">रंग</th>
                        <th scope="col">निर्णय</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.colours.rows.map((r) => (
                        <tr key={r.planet}>
                          <th scope="row">{r.planet}</th>
                          <td>{r.role}</td>
                          <td>
                            <span className="kd-sw">
                              {r.swatches.map((x) => (
                                <i key={x} style={{ background: x }} />
                              ))}
                            </span>
                            {r.colours}
                          </td>
                          <td>
                            <span className={`kd-chip${/न रखें/.test(r.verdict) ? " kd-chip--off" : " kd-chip--ok"}`}>{r.verdict}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="kd-palette">
                  {c.colours.site.map((s) => (
                    <div className="kd-card kd-pal" key={s.name}>
                      <i style={{ background: s.hex }} />
                      <div>
                        <b>
                          {s.name} <code>{s.hex}</code>
                        </b>
                        <span>{s.use}</span>
                        <small>{s.why}</small>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="kd-card kd-prose">
                  {c.colours.notes.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </div>
              </Section>
            )}

            <Section id="upay" title="उपाय, मंत्र और रत्न" lead={c.remediesNote}>
              <div className="kd-yogas">
                {(c.remedies || []).map((r) => (
                  <article className="kd-card kd-upay" key={r.planet}>
                    <header>
                      <h3>{r.planet}</h3>
                      <small>{r.why}</small>
                    </header>
                    <ul>
                      {r.items.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <p className="kd-mantra">{r.mantra}</p>
                    {r.ratna && <p className="kd-note">रत्न: {r.ratna}</p>}
                    {(r.japa || r.vedic || r.daan || r.kashi || Array.isArray(r.aacharan)) && (
                      <Fold label="पूरी विधि">
                        <Rows
                          rows={[
                            ["जप", r.japa],
                            ["वैदिक मंत्र", r.vedic],
                            ["गायत्री", r.gayatri],
                            ["स्तोत्र", r.stotra],
                            ["दिन और समय", r.day],
                            ["दान", r.daan],
                            ["व्रत", r.vrat],
                            ["उपरत्न", r.uparatna],
                            ["रुद्राक्ष", r.rudraksha],
                            ["काशी में", r.kashi],
                          ].filter(([, v]) => v)}
                        />
                        {Array.isArray(r.aacharan) && (
                          <>
                            <h4>आचरण</h4>
                            <ul>
                              {r.aacharan.map((t) => (
                                <li key={t}>{t}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </Fold>
                    )}
                  </article>
                ))}
              </div>
              {c.sadhana && (
                <div className="kd-grid3 kd-sadhana">
                  {Array.isArray(c.sadhana.week) && (
                    <div className="kd-card">
                      <h3>साप्ताहिक साधना</h3>
                      <dl className="kd-dl kd-week">
                        {c.sadhana.week.map(([day, graha, what]) => (
                          <div key={day}>
                            <dt>
                              {day}
                              <small>{graha}</small>
                            </dt>
                            <dd>{what}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  {Array.isArray(c.sadhana.daily) && (
                    <div className="kd-card kd-prose">
                      <h3>दैनिक क्रम</h3>
                      <ol className="kd-steps">
                        {c.sadhana.daily.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {Array.isArray(c.sadhana.rules) && (
                    <div className="kd-card kd-prose">
                      <h3>उपाय के नियम</h3>
                      <ul>
                        {c.sadhana.rules.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <div className="kd-grid3">
                <div className="kd-card">
                  <h3>शुभ</h3>
                  <Rows rows={c.favourable} />
                </div>
                <div className="kd-card">
                  <h3>घात (पत्रिका के अनुसार)</h3>
                  <Rows rows={c.ghat} />
                </div>
                {c.numerology && (
                  <div className="kd-card">
                    <h3>अंक ज्योतिष</h3>
                    <Rows rows={c.numerology.rows} />
                    <p className="kd-note">{c.numerology.note}</p>
                  </div>
                )}
              </div>
            </Section>

            <Section id="jaanch" title="जाँचने योग्य बातें" lead={c.source && c.source.note}>
              <div className="kd-cautions">
                {(c.cautions || []).map((x) => (
                  <article className="kd-card kd-caution" key={x.title}>
                    <h3>{x.title}</h3>
                    <p>{x.text}</p>
                  </article>
                ))}
              </div>
              {c.source && (
                <p className="kd-small">
                  स्रोत: {c.source.name} · {c.source.pages} पृष्ठ · {c.source.printed} · अयनांश {c.source.ayanamsa}
                </p>
              )}
            </Section>
          </>
        )}

        {view && (
          <Section id="dastavez" title="दस्तावेज़">
            <Papers view={view} onView={setView} hasChart={Boolean(c)} />
          </Section>
        )}
      </main>
      <footer className="kd-wrap kd-foot">निजी पृष्ठ · केवल सुपरएडमिन · खोज में नहीं आता</footer>
    </div>
  );
}
