// src/reader/Contents.jsx
// Contents and in-book search, in one drawer.
// A left-hand panel on wide screens, a full-height sheet on phones.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { searchBook } from "../library/api";
import { IconCheck, IconClose, IconBookmarkFill, IconTrash } from "./icons";

const GROUPS = [
  { kind: "front", label: "प्रारंभ" },
  { kind: "chapter", label: "अध्याय" },
  { kind: "back", label: "अंत" },
];

function useFocusReturn() {
  useEffect(() => {
    const prev = document.activeElement;
    return () => {
      if (prev && prev.focus) prev.focus({ preventScroll: true });
    };
  }, []);
}

/* -------------------------------------------------------------- contents */
function GoTo({ pages, onGoPage, onGoPercent }) {
  const [v, setV] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const raw = v.trim().replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d));
    if (!raw) return;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return;
    if (raw.endsWith("%") || !pages) onGoPercent(Math.min(100, Math.max(0, n)));
    else onGoPage(Math.round(n));
  };

  return (
    <form className="goto" onSubmit={submit}>
      <label className="goto__label" htmlFor="goto-in">
        {pages ? `पन्ना संख्या (1–${pages}) या प्रतिशत` : "प्रतिशत लिखिए, जैसे 40%"}
      </label>
      <div className="goto__row">
        <input
          id="goto-in"
          className="goto__input"
          inputMode="decimal"
          autoComplete="off"
          placeholder={pages ? "जैसे 112 या 40%" : "जैसे 40%"}
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
        <button type="submit" className="rd__btn goto__go">
          जाएँ
        </button>
      </div>
    </form>
  );
}

function TocList({ book, currentId, done, onGo, goto }) {
  const currentRef = useRef(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div className="rdp__scroll" data-lenis-prevent>
      {goto}
      {GROUPS.map((g) => {
        const items = book.chapters.filter((c) => c.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind} className="toc__group">
            <h3 className="toc__label">{g.label}</h3>
            <ol className="toc__list">
              {items.map((c) => {
                const here = c.id === currentId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      ref={here ? currentRef : null}
                      className={`toc__item ${here ? "is-here" : ""}`}
                      aria-current={here ? "true" : undefined}
                      onClick={() => onGo(c.id)}
                    >
                      <span className="toc__num">{c.num || "·"}</span>
                      <span className="toc__title">{c.title}</span>
                      <span className="toc__meta">
                        {done[c.id] && !here ? (
                          <IconCheck width={15} height={15} aria-label="पढ़ा हुआ" />
                        ) : c.minutes ? (
                          `${c.minutes} मि.`
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- search */
function SearchPane({ book, onGo }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState({ phase: "idle", hits: [], done: 0 });
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setState({ phase: "idle", hits: [], done: 0 });
      return undefined;
    }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setState({ phase: "busy", hits: [], done: 0 });
      try {
        const hits = await searchBook(book, term, {
          signal: ctl.signal,
          onProgress: (done) => !ctl.signal.aborted && setState((s) => ({ ...s, done })),
        });
        if (!ctl.signal.aborted) setState({ phase: "done", hits, done: book.chapters.length });
      } catch {
        if (!ctl.signal.aborted) setState({ phase: "error", hits: [], done: 0 });
      }
    }, 260);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q, book]);

  const titleOf = useMemo(() => {
    const m = new Map(book.chapters.map((c) => [c.id, c]));
    return (id) => {
      const c = m.get(id);
      return c ? (c.num ? `${c.num} · ${c.title}` : c.title) : id;
    };
  }, [book]);

  return (
    <>
      <div className="srch__bar">
        <input
          ref={inputRef}
          className="srch__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          lang="hi"
          placeholder="किताब में खोजें — कोई शब्द या वाक्य"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="किताब में खोजें"
        />
      </div>

      <div className="rdp__scroll" data-lenis-prevent>
        {state.phase === "idle" && (
          <p className="srch__note">कम से कम दो अक्षर लिखिए। पूरी किताब में खोजा जाएगा।</p>
        )}
        {state.phase === "busy" && (
          <p className="srch__note" role="status">
            खोज रहे हैं… {state.done}/{book.chapters.length}
          </p>
        )}
        {state.phase === "error" && <p className="srch__note">खोज पूरी नहीं हो सकी। फिर कोशिश कीजिए।</p>}
        {state.phase === "done" && state.hits.length === 0 && (
          <p className="srch__note">“{q.trim()}” कहीं नहीं मिला।</p>
        )}

        {state.hits.length > 0 && (
          <>
            {state.phase === "done" && (
              <p className="srch__count" role="status">
                {state.hits.length} परिणाम
              </p>
            )}
            <ul className="srch__list">
              {state.hits.map((h) => (
                <li key={`${h.chapter}:${h.at}`}>
                  <button
                    type="button"
                    className="srch__hit"
                    onClick={() => onGo(h.chapter, { pos: h.pos })}
                  >
                    <span className="srch__where">{titleOf(h.chapter)}</span>
                    <span className="srch__snip" lang="hi">
                      {h.before}
                      <mark>{h.match}</mark>
                      {h.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------- bookmarks & notes */
function MarksPane({ notes, labelOf, pageOf, onGo }) {
  const marks = [...notes.marks].sort((a, b) => b.at - a.at);
  const marksList = [...notes.bookmarks].sort((a, b) => b.at - a.at);
  const none = !marks.length && !marksList.length;

  return (
    <div className="rdp__scroll" data-lenis-prevent>
      {none && (
        <p className="srch__note">
          अभी कोई चिह्न नहीं है। पन्ने पर ऊपर का बुकमार्क दबाइए, या किसी अनुच्छेद को दबाकर रखिए — वह यहाँ
          जुड़ जाएगा।
        </p>
      )}

      {marksList.length > 0 && (
        <section className="toc__group">
          <h3 className="toc__label">बुकमार्क</h3>
          <ul className="srch__list">
            {marksList.map((b) => (
              <li key={b.id} className="mkrow">
                <button type="button" className="srch__hit" onClick={() => onGo(b.chapter, { pos: b.pos })}>
                  <span className="srch__where">
                    <IconBookmarkFill width={13} height={13} /> {labelOf(b.chapter)}
                  </span>
                  <span className="srch__snip">{pageOf(b.chapter, b.pos)}</span>
                </button>
                <button
                  type="button"
                  className="mkrow__x"
                  onClick={() => notes.removeBookmark(b.id)}
                  aria-label="बुकमार्क हटाएँ"
                >
                  <IconTrash width={17} height={17} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {marks.length > 0 && (
        <section className="toc__group">
          <h3 className="toc__label">रेखांकन और टिप्पणियाँ</h3>
          <ul className="srch__list">
            {marks.map((m) => (
              <li key={m.id} className="mkrow">
                <button
                  type="button"
                  className="srch__hit"
                  onClick={() => onGo(m.chapter, { pos: m.pos || 0 })}
                >
                  <span className="srch__where">
                    <i className={`mkdot mk__dot--${m.color}`} /> {labelOf(m.chapter)}
                  </span>
                  <span className={`srch__snip mkq hl-${m.color}`} lang="hi">
                    {m.text.length > 130 ? `${m.text.slice(0, 130)}…` : m.text}
                  </span>
                  {m.note ? <span className="mkrow__note">{m.note}</span> : null}
                </button>
                <button
                  type="button"
                  className="mkrow__x"
                  onClick={() => notes.removeMarkById(m.id)}
                  aria-label="चिह्न हटाएँ"
                >
                  <IconTrash width={17} height={17} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- panel */
export default function Contents({
  book,
  currentId,
  done,
  initialTab = "toc",
  notes,
  pages = 0,
  onGoPage,
  onGoPercent,
  pageOf = () => "",
  onGo,
  onClose,
}) {
  const [tab, setTab] = useState(initialTab);
  useFocusReturn();

  const labelOf = useMemo(() => {
    const m = new Map(book.chapters.map((c) => [c.id, c]));
    return (id) => {
      const c = m.get(id);
      return c ? (c.num ? `${c.num} · ${c.title}` : c.title) : id;
    };
  }, [book]);

  return (
    <div className="rdp rdp--left" role="dialog" aria-modal="true" aria-label="अनुक्रम और खोज">
      <div className="rdp__head">
        <div className="rdp__tabs" role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={tab === "toc"}
            className={tab === "toc" ? "is-on" : ""}
            onClick={() => setTab("toc")}
          >
            अनुक्रम
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === "search"}
            className={tab === "search" ? "is-on" : ""}
            onClick={() => setTab("search")}
          >
            खोजें
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === "marks"}
            className={tab === "marks" ? "is-on" : ""}
            onClick={() => setTab("marks")}
          >
            चिह्न
            {notes && notes.bookmarks.length + notes.marks.length > 0 ? (
              <b className="rdp__count">{notes.bookmarks.length + notes.marks.length}</b>
            ) : null}
          </button>
        </div>
        <button type="button" className="rdp__x" onClick={onClose} aria-label="बंद करें">
          <IconClose />
        </button>
      </div>

      {tab === "toc" ? (
        <TocList
          book={book}
          currentId={currentId}
          done={done}
          onGo={onGo}
          goto={<GoTo pages={pages} onGoPage={onGoPage} onGoPercent={onGoPercent} />}
        />
      ) : tab === "search" ? (
        <SearchPane book={book} onGo={onGo} />
      ) : (
        <MarksPane notes={notes} labelOf={labelOf} pageOf={pageOf} onGo={onGo} />
      )}
    </div>
  );
}
