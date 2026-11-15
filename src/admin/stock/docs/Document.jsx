// "Document" — the manual of the whole advisor, written in plain English. It is one page with a
// contents list, a search box and anchors; the words live in chapters.js as plain data (blocks of
// headings, paragraphs, lists, tables, notes and "logic" cards), so this file only shows them.
//
// Search filters the blocks (not just the titles) and marks the words found. The contents list
// sits beside the text on a laptop and folds into a bar on a phone. Printing gives a clean copy.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { PARTS, CHAPTERS } from "./chapters";
import { downloadDocx } from "./docx";
import "./document.css";

/* ── inline text: **bold**, `code`, and a highlight for the search words ───────────── */

function marked(text, words, key) {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return String(text)
    .split(re)
    .map((part, i) => (i % 2 ? <mark key={`${key}-${i}`}>{part}</mark> : part));
}

function Inline({ text, words }) {
  const out = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  const src = String(text);
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(<React.Fragment key={`t${n++}`}>{marked(src.slice(last, m.index), words, `t${n}`)}</React.Fragment>);
    if (m[1] !== undefined) out.push(<strong key={`b${n++}`}>{marked(m[1], words, `b${n}`)}</strong>);
    else out.push(<code key={`c${n++}`}>{marked(m[2], words, `c${n}`)}</code>);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(<React.Fragment key={`t${n++}`}>{marked(src.slice(last), words, `t${n}`)}</React.Fragment>);
  return <>{out}</>;
}

/* ── plain text of a block, for search ───────────────────────────────────────────── */

export function blockText(b) {
  const parts = [];
  if (b.h) parts.push(b.h);
  if (b.p) parts.push(b.p);
  if (b.note) parts.push(b.note);
  if (b.warn) parts.push(b.warn);
  if (b.ul) parts.push(...b.ul);
  if (b.ol) parts.push(...b.ol);
  if (b.dl) b.dl.forEach(([t, d]) => parts.push(t, d));
  if (b.table) {
    parts.push(...b.table.head);
    b.table.rows.forEach((r) => parts.push(...r));
  }
  if (b.logic) {
    const l = b.logic;
    parts.push(l.title, l.who || "", l.when || "", l.limits || "", ...(l.steps || []));
  }
  return parts.join(" ").replace(/[*`]/g, "").toLowerCase();
}

/** Every word of the query must appear in the block (or in the chapter title). */
export function matches(text, words) {
  return words.every((w) => text.includes(w));
}

/* ── one block ─────────────────────────────────────────────────────────────────── */

function Block({ b, words }) {
  if (b.h) return <h3 className="doc-h3">{<Inline text={b.h} words={words} />}</h3>;
  if (b.p) return <p className="doc-p"><Inline text={b.p} words={words} /></p>;
  if (b.ul)
    return (
      <ul className="doc-ul">
        {b.ul.map((t, i) => (
          <li key={i}><Inline text={t} words={words} /></li>
        ))}
      </ul>
    );
  if (b.ol)
    return (
      <ol className="doc-ol">
        {b.ol.map((t, i) => (
          <li key={i}><Inline text={t} words={words} /></li>
        ))}
      </ol>
    );
  if (b.dl)
    return (
      <dl className="doc-dl">
        {b.dl.map(([t, d], i) => (
          <div key={i}>
            <dt><Inline text={t} words={words} /></dt>
            <dd><Inline text={d} words={words} /></dd>
          </div>
        ))}
      </dl>
    );
  if (b.table)
    return (
      <div className="doc-table" role="region" tabIndex={0} aria-label={b.table.label || "Table"}>
        <table>
          <thead>
            <tr>
              {b.table.head.map((h, i) => (
                <th key={i}><Inline text={h} words={words} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} data-label={b.table.head[j]}><Inline text={c} words={words} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (b.note) return <aside className="doc-note"><Inline text={b.note} words={words} /></aside>;
  if (b.warn) return <aside className="doc-note doc-note--warn"><Inline text={b.warn} words={words} /></aside>;
  if (b.logic) {
    const l = b.logic;
    return (
      <section className="doc-logic">
        <header>
          <span className="doc-logic__tag">How it works</span>
          <h4><Inline text={l.title} words={words} /></h4>
        </header>
        {(l.who || l.when) && (
          <dl className="doc-logic__meta">
            {l.who && (
              <div>
                <dt>Who does it</dt>
                <dd><Inline text={l.who} words={words} /></dd>
              </div>
            )}
            {l.when && (
              <div>
                <dt>When</dt>
                <dd><Inline text={l.when} words={words} /></dd>
              </div>
            )}
          </dl>
        )}
        {l.steps && (
          <ol className="doc-ol">
            {l.steps.map((t, i) => (
              <li key={i}><Inline text={t} words={words} /></li>
            ))}
          </ol>
        )}
        {l.limits && (
          <p className="doc-logic__limits">
            <b>Limits &amp; honest notes. </b>
            <Inline text={l.limits} words={words} />
          </p>
        )}
      </section>
    );
  }
  return null;
}

/* ── the page ──────────────────────────────────────────────────────────────────── */

/**
 * A long document with a contents list, search, anchors and a Word download. Used by the Document
 * (the whole manual) and by the AI Engine (everything about the AI).
 */
export function DocView({ parts, chapters, kicker, title, lead, endNote, onWord, extra = null }) {
  const [query, setQuery] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [active, setActive] = useState(chapters[0] ? chapters[0].id : "");
  const [top, setTop] = useState(false);
  const rootRef = useRef(null);
  const tocRef = useRef(null);

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter((w) => w.length > 1), [query]);

  // the searchable text of each chapter, built once
  const index = useMemo(
    () =>
      chapters.map((c) => ({
        c,
        title: `${c.title} ${c.intro || ""}`.toLowerCase(),
        blocks: c.blocks.map((b) => ({ b, text: blockText(b) })),
      })),
    [chapters]
  );

  const shown = useMemo(() => {
    if (!words.length) return index.map((x) => ({ c: x.c, blocks: x.c.blocks, hits: 0 }));
    return index
      .map((x) => {
        // a chapter whose title matches shows whole; otherwise only the blocks that match
        const whole = matches(x.title, words);
        const blocks = whole ? x.c.blocks : x.blocks.filter((y) => matches(y.text, words)).map((y) => y.b);
        return { c: x.c, blocks, hits: blocks.length, whole };
      })
      .filter((x) => x.blocks.length || x.whole);
  }, [index, words]);

  const hits = words.length ? shown.reduce((n, x) => n + x.blocks.length, 0) : 0;

  // which chapter is on screen (for the contents list)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id.replace(/^doc-/, ""), e.isIntersecting ? e.boundingClientRect.top : null));
        const live = [...seen.entries()].filter(([, t]) => t !== null).sort((a, b) => a[1] - b[1]);
        if (live.length) setActive(live[0][0]);
      },
      { rootMargin: "-72px 0px -60% 0px" }
    );
    root.querySelectorAll("section.doc-chapter").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown]);

  useEffect(() => {
    const onScroll = () => setTop(window.scrollY > 900);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // on a phone the contents open under the header: bring them into view
  useEffect(() => {
    if (!tocOpen || typeof window === "undefined" || window.innerWidth >= 1000) return;
    const el = tocRef.current;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [tocOpen]);

  // a link such as …#doc-trading opens that chapter
  useEffect(() => {
    const id = (window.location.hash || "").replace(/^#/, "");
    if (!id) return;
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  const jump = (id) => {
    setTocOpen(false);
    setQuery("");
    setTimeout(() => {
      const el = document.getElementById(`doc-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  };

  const wordsTotal = useMemo(() => chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + blockText(b).split(/\s+/).length, 0), 0), [chapters]);

  return (
    <div className="doc" ref={rootRef}>
      <header className="doc-hero">
        <p className="doc-hero__kicker">{kicker}</p>
        <h1>{title}</h1>
        <p className="doc-hero__lead">{lead}</p>
        <div className="doc-hero__facts">
          <span><b>{chapters.length}</b> chapters</span>
          <span><b>{wordsTotal.toLocaleString("en-IN")}</b> words</span>
          <span>Written from the code itself</span>
        </div>
        <div className="doc-tools">
          <label className="doc-search">
            <span className="doc-sr">Search the document</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search — for example stop-loss, RSI, free models, 3:45" autoComplete="off" spellCheck="false" />
          </label>
          <button type="button" className="adm-btn doc-tocbtn" aria-expanded={tocOpen} onClick={() => setTocOpen((o) => !o)}>
            Contents
          </button>
          {onWord && (
            <button type="button" className="adm-btn doc-printbtn" onClick={onWord} data-tip="Download this document as a Word file (.docx).">
              Word ⤓
            </button>
          )}
          <button type="button" className="adm-btn doc-printbtn" onClick={() => window.print()}>
            Print
          </button>
        </div>
        {extra}
        {words.length > 0 && (
          <p className="doc-hits" role="status">
            {hits ? `${hits} passage${hits === 1 ? "" : "s"} in ${shown.length} chapter${shown.length === 1 ? "" : "s"}` : "Nothing found — try fewer or simpler words."}
          </p>
        )}
      </header>

      <div className="doc-body">
        <nav ref={tocRef} className={`doc-toc ${tocOpen ? "is-open" : ""}`} aria-label="Contents">
          {parts.map((p) => (
            <div key={p.id} className="doc-toc__part">
              <h2>{p.title}</h2>
              <ol>
                {chapters.filter((c) => c.part === p.id).map((c) => (
                  <li key={c.id}>
                    <a href={`#doc-${c.id}`} className={active === c.id ? "is-on" : ""} onClick={(e) => { e.preventDefault(); jump(c.id); }}>
                      <span>{c.no}</span>
                      {c.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </nav>

        <article className="doc-text">
          {shown.map(({ c, blocks }) => (
            <section key={c.id} id={`doc-${c.id}`} className="doc-chapter">
              <header className="doc-chapter__head">
                <span className="doc-chapter__no">{c.no}</span>
                <h2>{c.title}</h2>
              </header>
              {c.intro && !words.length && <p className="doc-lead">{c.intro}</p>}
              {blocks.map((b, i) => (
                <Block key={i} b={b} words={words} />
              ))}
            </section>
          ))}
          {!words.length && (
            <footer className="doc-end">
              <p>{endNote}</p>
            </footer>
          )}
        </article>
      </div>

      {top && (
        <button type="button" className="doc-top" aria-label="Back to the top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          ↑
        </button>
      )}
    </div>
  );
}

/** The whole manual. */
export default function Document() {
  const word = () => downloadDocx("Drishti-complete-guide.docx", { title: "Drishti — the AI Trading Advisor for NSE", subtitle: "The complete guide", parts: PARTS, chapters: CHAPTERS });
  return (
    <DocView
      parts={PARTS}
      chapters={CHAPTERS}
      kicker="The manual"
      title="Drishti — the AI Trading Advisor for NSE · complete guide"
      lead="This is the one document that explains everything the advisor does: every screen, who does what, and the reasoning behind each number — when it runs, how it is worked out and where it stops. Read it from the top as a story, or search for a word."
      endNote="That is the whole desk. It is a tool to read the market and keep your own discipline — it never promises a profit and it never decides for you. Every call it makes can be wrong; the stop-loss, the daily limit and your own judgement are what protect your money."
      onWord={word}
    />
  );
}
