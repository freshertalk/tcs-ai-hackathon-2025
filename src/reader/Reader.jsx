// src/reader/Reader.jsx
// The reading room: /read/:slug and /read/:slug/:chapter
//
//   • one chapter in memory at a time, neighbours prefetched
//   • two ways to read — continuous scroll, or turned pages
//   • position is saved as you read and restored on return
//   • themes, type and layout are the reader's to set, and they stay set
//   • works with touch, keyboard and mouse; nothing needs a hover
//
// This route opts out of the site shell (preloader, custom cursor, inertial
// scroll, grain): a page of prose wants the platform's own scrolling.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import Seo from "../components/seo/Seo";
import { useBook } from "../library/hooks";
import { getChapter, getBookFresh, peekChapter, prefetchChapter } from "../library/api";
import { getProgress, saveProgress } from "../library/progress";

import useReaderPrefs, { FONTS, WIDTHS, SIZE, THEME_BG, PROGRESS } from "./prefs";
import useAnnotations from "./annotations";
import { numbering, lastPage, locatePage, guessWordsPerPage, learnWordsPerPage } from "./folio";
import ScrollView from "./ScrollView";
import PagedView from "./PagedView";
import Contents from "./Contents";
import Settings from "./Settings";
import MarkSheet from "./MarkSheet";
import { ReviewsSection } from "../reviews/Reviews";
import ReadWall from "./ReadWall";
import { dismissSuggestion, takeSuggestion, useSuggestion, watchBook } from "../sync/sync";
import { clamp01, fmtMinutes } from "./util";
import {
  IconBack,
  IconClose,
  IconNext,
  IconList,
  IconSearch,
  IconType,
  IconBookmark,
  IconBookmarkFill,
  IconReturn,
} from "./icons";

/* ----------------------------------------------------------- small parts */
/**
 * A line of text that always shows whole. When it fits, it just sits there;
 * when the screen is too narrow for it, it slides slowly to its end and back,
 * pausing at each end, so a long chapter title can be read in full instead of
 * being cut to "17 · जिस कि…".
 */
function Scrolling({ children }) {
  const box = useRef(null);
  const txt = useRef(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const b = box.current;
    const t = txt.current;
    if (!b || !t) return undefined;
    const measure = () => {
      const over = Math.ceil(t.scrollWidth - b.clientWidth);
      setShift(over > 2 ? over + 6 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    document.fonts?.ready?.then(measure);
    return () => ro.disconnect();
  }, [children]);

  return (
    <span ref={box} className={`mq ${shift ? "is-moving" : ""}`}>
      <span
        ref={txt}
        className="mq__t"
        style={shift ? { "--mq-shift": `-${shift}px`, "--mq-dur": `${Math.max(4, Math.round(3 + shift / 22))}s` } : undefined}
      >
        {children}
      </span>
    </span>
  );
}

function Skeleton({ label = "अध्याय खुल रहा है…" }) {
  return (
    <div className="rd__loading" role="status">
      <span className="rd__spinner" aria-hidden="true" />
      {/* a ring and nothing else on screen; the words are for screen readers */}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function Problem({ slug, retry }) {
  return (
    <div className="rd__loading rd__loading--err" role="alert">
      <p>यह अध्याय अभी खुल नहीं पाया।</p>
      <div className="rd__row">
        <button type="button" className="rd__btn" onClick={retry}>
          फिर कोशिश कीजिए
        </button>
        <Link className="rd__btn rd__btn--ghost" to={`/books/${slug}`}>
          किताब के पन्ने पर
        </Link>
      </div>
    </div>
  );
}

function FlowFooter({ book, next, onNext }) {
  if (next) {
    return (
      <div className="rd__next">
        <span className="rd__nextK">अगला अध्याय</span>
        <button type="button" className="rd__nextCard" onClick={onNext}>
          <span className="rd__nextNum">{next.num || "·"}</span>
          <span className="rd__nextTitle">{next.title}</span>
          <span className="rd__nextGo">
            {next.minutes} मिनट <IconNext width={18} height={18} />
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="rd__next rd__end">
      <span className="rd__endMark" aria-hidden="true">
        ❖
      </span>
      <p className="rd__endT">समाप्त</p>
      <p className="rd__endS">
        {book.title} · {book.author}
      </p>
      <div className="rd__row">
        <Link className="rd__btn" to={`/books/${book.slug}`}>
          किताब के पन्ने पर
        </Link>
        <Link className="rd__btn rd__btn--ghost" to="/library">
          रचनाएँ
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */
function ReaderShell({ book, chapterId }) {
  const slug = book.slug;
  const navigate = useNavigate();
  const location = useLocation();
  const { prefs, update, reset, resolvedTheme } = useReaderPrefs();
  const notes = useAnnotations(slug);
  const resume = useSuggestion(slug);
  useEffect(() => {
    watchBook(slug);
  }, [slug]);

  const chapters = book.chapters;
  const index = chapters.findIndex((c) => c.id === chapterId);
  const chapter = chapters[index];
  const prev = chapters[index - 1] || null;
  const next = chapters[index + 1] || null;

  /* running totals, for "how far through the whole book" */
  const totals = useMemo(() => {
    let sum = 0;
    const before = chapters.map((c) => {
      const b = sum;
      sum += c.words;
      return b;
    });
    return { before, total: Math.max(1, sum) };
  }, [chapters]);

  const overallAt = useCallback(
    (i, pos) => (totals.before[i] + clamp01(pos) * chapters[i].words) / totals.total,
    [chapters, totals]
  );

  const [view, setView] = useState(null); // { id, html, startPos }
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState(null); // 'toc' | 'search' | 'settings' | null
  const [pos, setPos] = useState(0);
  const [pageInfo, setPageInfo] = useState(null);
  const [preview, setPreview] = useState(null); // slider value while dragging
  const [fullscreen, setFullscreen] = useState(false);
  const [done, setDone] = useState(() => (getProgress(slug) || {}).done || {});
  const [sheet, setSheet] = useState(null); // { p, text } — a paragraph being marked
  const [back, setBack] = useState(null); // where the reader jumped from
  const [, bump] = useState(0);

  // how many pages each chapter came to in the layout we have now
  const countsRef = useRef({ sig: "", map: {} });
  const enterRef = useRef("fade");
  const shownRef = useRef(null);

  const apiRef = useRef(null);
  const posRef = useRef(0);
  const saveTimer = useRef(0);
  const pendingSave = useRef(null);
  const dragging = useRef(false);
  const seekTimer = useRef(0);

  const registerApi = useCallback((api) => {
    apiRef.current = api;
  }, []);

  /* ------------------------------------------------------ load a chapter */
  useEffect(() => {
    let live = true;
    setFailed(false);

    const begin = (html) => {
      if (!live) return;
      const st = location.state;
      const fromNav = st && st.chapter === chapterId && st.pos !== undefined;
      const saved = getProgress(slug);
      let startPos = 0;
      if (fromNav) startPos = st.pos;
      else if (saved && saved.chapter === chapterId) startPos = saved.pos || 0;

      // when the page was drawn straight from the cache the reading view
      // has already reported where it is; do not overwrite that
      if (shownRef.current !== chapterId) {
        posRef.current = startPos === "end" ? 1 : startPos;
        setPos(posRef.current);
      }
      setView({ id: chapterId, html, startPos });
      if (fromNav) navigate(location.pathname, { replace: true, state: null });

      // record arrival so "continue" points here even before they scroll
      saveProgress(slug, {
        chapter: chapterId,
        pos: posRef.current,
        overall: overallAt(index, posRef.current),
      });
    };

    const cached = peekChapter(book, chapterId);
    if (cached) begin(cached);
    else {
      setView(null);
      getChapter(book, chapterId)
        .then(begin)
        .catch(() => live && setFailed(true));
    }

    return () => {
      live = false;
    };
    // location.state is read at the moment the chapter changes, not tracked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, chapterId, attempt, book.version]);

  // be one step ahead of the reader
  useEffect(() => {
    if (!view) return undefined;
    const t = setTimeout(() => {
      // the next chapter's first page is drawn under the last leaf, so the
      // shell wants to know the moment it has arrived
      if (next) getChapter(book, next.id).then(() => bump((n) => n + 1), () => {});
      if (prev) prefetchChapter(book, prev.id);
    }, 600);
    return () => clearTimeout(t);
  }, [view, book, next, prev]);

  /* ------------------------------------------------- a newer edition? */
  // The publisher bumps book.version when the EPUB is replaced. A tab left
  // open can't see that by itself, so look again whenever it comes back to
  // the foreground, and now and then while it stays there.
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    const look = () =>
      getBookFresh(slug)
        .then((d) => d.version !== book.version && setNewer(true))
        .catch(() => {});
    const onVisible = () => document.visibilityState === "visible" && look();
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(look, 10 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [slug, book.version]);

  /* ------------------------------------- reading, not taking: no copying */
  // A browser has to be handed the text to show it, so this cannot be a lock.
  // It removes every ordinary way of taking the text — selecting, copying,
  // dragging, the context menu, printing — and says why when someone tries.
  useEffect(() => {
    const NOTICE = `${book.title} — ${book.author}। यह पुस्तक केवल यहीं पढ़ने के लिए है।`;
    const inField = (t) => t && t.closest && t.closest("input, textarea");
    const stop = (e) => {
      if (!inField(e.target)) e.preventDefault();
    };
    const onCopy = (e) => {
      if (inField(e.target)) return;
      e.preventDefault();
      try {
        e.clipboardData.setData("text/plain", NOTICE);
      } catch {
        /* older browsers: the preventDefault is enough */
      }
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && /^[psa]$/i.test(e.key) && !inField(e.target)) e.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("contextmenu", stop);
    document.addEventListener("dragstart", stop);
    document.addEventListener("selectstart", stop);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("contextmenu", stop);
      document.removeEventListener("dragstart", stop);
      document.removeEventListener("selectstart", stop);
      document.removeEventListener("keydown", onKey);
    };
  }, [book.title, book.author]);

  /* ------------------------------------ first-visit hint for page turning */
  const [hint, setHint] = useState(false);
  const hasView = Boolean(view);
  useEffect(() => {
    if (prefs.mode !== "paged" || !hasView) return undefined;
    let seen = false;
    try {
      seen = localStorage.getItem("vkt.reader.hint.v1") === "1";
    } catch {
      seen = true;
    }
    if (seen) return undefined;
    setHint(true);
    // shown once, however it ends: tapping it, or simply letting it fade
    try {
      localStorage.setItem("vkt.reader.hint.v1", "1");
    } catch {
      /* it may show again next visit — harmless */
    }
    const t = setTimeout(() => setHint(false), 5200);
    return () => clearTimeout(t);
  }, [prefs.mode, hasView]);

  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      localStorage.setItem("vkt.reader.hint.v1", "1");
    } catch {
      /* shown again next time — harmless */
    }
  }, []);

  /* ----------------------------------------------------- saving progress */
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (pendingSave.current) {
      saveProgress(slug, pendingSave.current);
      pendingSave.current = null;
    }
  }, [slug]);

  const persist = useCallback(
    (p, user) => {
      const reachedEnd = user && p >= 0.985;
      const patch = { chapter: chapterId, pos: p, overall: overallAt(index, p) };

      if (reachedEnd) {
        patch.done = { [chapterId]: 1 };
        setDone((d) => (d[chapterId] ? d : { ...d, [chapterId]: 1 }));
        // finished a chapter: "continue" should open the next one fresh
        if (next && p >= 0.99) {
          patch.chapter = next.id;
          patch.pos = 0;
          patch.overall = overallAt(index + 1, 0);
        }
      }
      pendingSave.current = patch;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 450);
    },
    [chapterId, index, next, overallAt, flush]
  );

  const onPos = useCallback(
    (p, info) => {
      const user = typeof info === "object" ? info.user : Boolean(info);
      posRef.current = p;
      setPos(p);
      if (info && typeof info === "object" && info.count) {
        if (countsRef.current.sig !== info.sig) countsRef.current = { sig: info.sig, map: {} };
        countsRef.current.map[chapterId] = info.count;
        setPageInfo({
          firstCol: info.firstCol,
          lastCol: info.lastCol,
          count: info.count,
          span: info.span,
          two: info.two,
          colW: info.colW,
          Ht: info.Ht,
          sig: info.sig,
        });
      }
      if (user) persist(p, true);
    },
    [persist, chapterId]
  );

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  /* ------------------------------------------------------- navigation */
  const goTo = useCallback(
    (id, opts = {}) => {
      setPanel(null);
      const at = opts.pos === undefined ? 0 : opts.pos;
      // a jump (contents, search, the seek bar) can be undone; turning a page cannot need to be
      if (opts.mark) setBack({ chapter: chapterId, pos: posRef.current });
      enterRef.current = opts.continued ? "none" : "fade";
      if (id === chapterId) {
        if (opts.pos !== undefined) apiRef.current?.seek(at === "end" ? 1 : at);
        return;
      }
      flush();
      navigate(`/read/${slug}/${id}`, { state: { chapter: id, pos: at } });
    },
    [chapterId, flush, navigate, slug]
  );

  const onEdge = useCallback(
    (dir, info) => {
      if (dir > 0) {
        if (next) {
          persist(1, true);
          goTo(next.id, { pos: 0, continued: Boolean(info && info.continued) });
        } else {
          persist(1, true);
          flush();
          setPanel("end");
        }
      } else if (prev) goTo(prev.id, { pos: "end" });
    },
    [next, prev, goTo, persist, flush]
  );

  const nextChapter = useCallback(() => {
    if (next) {
      persist(1, true);
      goTo(next.id, { pos: 0 });
    }
  }, [next, goTo, persist]);

  const prevChapter = useCallback(() => {
    if (prev) goTo(prev.id, { pos: 0 });
  }, [prev, goTo]);

  /* ---------------------------------------------------------- seek bar */
  const overall = overallAt(index, pos);
  const sliderValue = preview === null ? Math.round(overall * 1000) : preview;

  const commitSeek = useCallback(
    (value) => {
      const target = (value / 1000) * totals.total;
      let i = totals.before.length - 1;
      while (i > 0 && totals.before[i] > target) i--;
      const words = Math.max(1, chapters[i].words);
      const p = clamp01((target - totals.before[i]) / words);
      setPreview(null);
      goTo(chapters[i].id, { pos: i === index && p === 0 ? 0 : p, mark: true });
    },
    [chapters, totals, index, goTo]
  );

  // pointerup, pointercancel and touchend can all arrive for one gesture
  const finishDrag = useCallback(
    (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      commitSeek(Number(e.currentTarget.value));
    },
    [commitSeek]
  );

  const seekLabel = useMemo(() => {
    if (preview === null) return null;
    const target = (preview / 1000) * totals.total;
    let i = totals.before.length - 1;
    while (i > 0 && totals.before[i] > target) i--;
    const c = chapters[i];
    return c.num ? `${c.num} · ${c.title}` : c.title;
  }, [preview, totals, chapters]);

  /* ------------------------------------------------------ mode switch */
  const setMode = useCallback(
    (mode) => {
      if (mode === prefs.mode) return;
      // carry the exact position across, in the same render as the switch
      setView((v) => (v ? { ...v, startPos: posRef.current } : v));
      setPageInfo(null);
      setChrome(true);
      update({ mode });
    },
    [prefs.mode, update]
  );

  /* --------------------------------------------------------- fullscreen */
  const canFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  /* ----------------------------------------------------------- keyboard */
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") t.blur();
        return;
      }
      const paged = prefs.mode === "paged";
      const api = apiRef.current;

      switch (e.key) {
        case "Escape":
          if (panel) setPanel(null);
          else setChrome((c) => !c);
          break;
        case "ArrowRight":
          if (panel) return;
          e.preventDefault();
          if (paged) api?.step(1);
          else nextChapter();
          break;
        case "ArrowLeft":
          if (panel) return;
          e.preventDefault();
          if (paged) api?.step(-1);
          else prevChapter();
          break;
        case "PageDown":
        case " ":
          if (panel || !paged) return; // the platform scrolls for us
          e.preventDefault();
          api?.step(e.shiftKey && e.key === " " ? -1 : 1);
          break;
        case "PageUp":
          if (panel || !paged) return;
          e.preventDefault();
          api?.step(-1);
          break;
        case "t":
        case "T":
          setPanel((p) => (p === "toc" ? null : "toc"));
          break;
        case "s":
        case "S":
        case "/":
          e.preventDefault();
          setPanel("search");
          break;
        case "a":
        case "A":
          setPanel((p) => (p === "settings" ? null : "settings"));
          break;
        case "+":
        case "=":
          update({ size: Math.min(SIZE.max, prefs.size + 1) });
          break;
        case "-":
        case "_":
          update({ size: Math.max(SIZE.min, prefs.size - 1) });
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "b":
        case "B":
          bookmarkRef.current?.();
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.mode, prefs.size, panel, nextChapter, prevChapter, update, toggleFullscreen]);

  /* ------------------------------------------------------- screen wake */
  useEffect(() => {
    if (!prefs.awake || !("wakeLock" in navigator)) return undefined;
    let lock = null;
    let off = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
          if (off && lock) lock.release().catch(() => {});
        }
      } catch {
        /* denied (battery saver, etc.) — reading carries on regardless */
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      off = true;
      document.removeEventListener("visibilitychange", acquire);
      if (lock) lock.release().catch(() => {});
    };
  }, [prefs.awake]);

  /* --------------------------------------- page chrome: colours & scroll */
  useEffect(() => {
    const bg = THEME_BG[resolvedTheme];
    const body = document.body;
    const html = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = {
      body: body.style.background,
      html: html.style.background,
      meta: meta ? meta.getAttribute("content") : null,
    };
    body.style.background = bg;
    html.style.background = bg;
    if (meta) meta.setAttribute("content", bg);
    return () => {
      body.style.background = was.body;
      html.style.background = was.html;
      if (meta && was.meta !== null) meta.setAttribute("content", was.meta);
    };
  }, [resolvedTheme]);

  useEffect(() => {
    document.body.classList.add("is-reader");
    return () => document.body.classList.remove("is-reader", "is-reader-paged");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-reader-paged", prefs.mode === "paged");
  }, [prefs.mode]);

  // a panel open means the page behind it should not scroll. This is NOT the
  // site's "is-locked": that one also pins the body height, which would
  // clamp the scroll position and throw the reader back to the top.
  useEffect(() => {
    document.body.classList.toggle("is-reader-lock", Boolean(panel));
    return () => document.body.classList.remove("is-reader-lock");
  }, [panel]);

  /* ------------------------------------------ links inside the chapter */
  const onContentClick = useCallback(
    (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (href.startsWith("/read/")) {
        e.preventDefault();
        const m = href.match(/^\/read\/([^/]+)\/([^/#]+)/);
        if (m && m[1] === slug && chapters.some((c) => c.id === m[2])) goTo(m[2], { pos: 0 });
      } else if (href.startsWith("#")) {
        e.preventDefault();
        const el = document.getElementById(href.slice(1));
        if (el && prefs.mode === "scroll") el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    },
    [chapters, goTo, prefs.mode, slug]
  );

  /* ------------------------------------------------------------- render */
  const bookmarkRef = useRef(null);
  const font = FONTS.find((f) => f.id === prefs.font) || FONTS[0];
  const width = WIDTHS.find((w) => w.id === prefs.width) || WIDTHS[1];

  const style = {
    "--rd-size": `${prefs.size}px`,
    "--rd-lh": prefs.line,
    "--rd-w": `${Math.round(width.em * prefs.size)}px`,
    "--rd-align": prefs.align,
    "--rd-font": font.css,
  };

  const layoutKey = `${prefs.size}|${prefs.line}|${prefs.font}|${prefs.width}|${prefs.align}|${prefs.bold ? 1 : 0}`;
  const percent = Math.floor(overall * 100);
  const label = chapter.num ? `${chapter.num} · ${chapter.title}` : chapter.title;
  // Kindle-style "time left", from the words still ahead at the book's pace
  const leftInChapter = chapter.minutes ? Math.max(1, Math.ceil(chapter.minutes * (1 - pos))) : 0;
  const leftInBook = Math.max(0, Math.ceil(book.stats.minutes * (1 - overall)));
  const barsOn = chrome || Boolean(panel);

  const toggleChrome = useCallback(() => setChrome((c) => !c), []);

  /* ---- page numbers: exact where a chapter has been laid out, estimated elsewhere ---- */
  const numbersFor = (two, colW, Ht, sig, exceptId) => {
    const counts = countsRef.current.sig === sig ? countsRef.current.map : {};
    const fallback = guessWordsPerPage(colW, Ht, prefs.size, prefs.line);
    const wpp = learnWordsPerPage(chapters, counts, exceptId, fallback);
    return numbering(chapters, { two, counts, wpp });
  };

  // handed to the page view so it can print the running foot
  const folioOf = (two, dims, offset) => {
    const sig = `${layoutKey}|${dims.colW}|${dims.Ht}|${two ? 2 : 1}`;
    return numbersFor(two, dims.colW, dims.Ht, sig, chapterId)[index + offset] || null;
  };

  const nums = pageInfo ? numbersFor(pageInfo.two, pageInfo.colW, pageInfo.Ht, pageInfo.sig, chapterId) : null;
  const here = nums ? nums[index] : null;
  const pageNo = here && here.numbered && pageInfo ? here.first + pageInfo.firstCol : null;
  const totalPages = nums ? lastPage(nums) : 0;
  const paged = prefs.mode === "paged";

  const pageOf = (chId, p) => {
    const at = chapters.findIndex((c) => c.id === chId);
    const e = nums && nums[at];
    if (e && e.numbered) return `पन्ना ${e.first + Math.min(e.pages - 1, Math.floor(p * e.pages))}`;
    return `${Math.round(p * 100)}%`;
  };

  // what the small line at the foot says — a tap moves on to the next one
  const progressText = (() => {
    switch (prefs.progress) {
      case "chapter":
        return leftInChapter ? `अध्याय में ${leftInChapter} मि. शेष` : `${percent}%`;
      case "book":
        return leftInBook ? `किताब में ${fmtMinutes(leftInBook)} शेष` : `${percent}%`;
      case "percent":
        return `${percent}%`;
      default:
        return paged && pageNo ? `पन्ना ${pageNo} / ${totalPages}` : `${percent}%`;
    }
  })();
  const cycleProgress = () => {
    const at = PROGRESS.indexOf(prefs.progress);
    update({ progress: PROGRESS[(at + 1) % PROGRESS.length] });
  };

  /* ---- bookmarks and marks ---- */
  const span =
    paged && pageInfo ? pageInfo.span : [Math.max(0, pos - 0.012), Math.min(1.0001, pos + 0.012)];
  const bookmarked = notes.bookmarksIn(chapterId, span[0], span[1]).length > 0;
  bookmarkRef.current = () => notes.toggleBookmark(chapterId, span[0], span[1], label);

  const chapterMarks = useMemo(
    () => notes.marks.filter((m) => m.chapter === chapterId),
    [notes.marks, chapterId]
  );
  const spanStart = useRef(0);
  spanStart.current = span[0];

  const onPara = useCallback(
    (para) => {
      const exists = notes.marks.some((m) => m.chapter === chapterId && m.p === para.index);
      if (!exists) notes.setMark(chapterId, para.index, { color: "y", pos: spanStart.current }, para.text);
      setSheet({ p: para.index, text: para.text });
    },
    [notes, chapterId]
  );
  const sheetMark = sheet
    ? notes.marks.find((m) => m.chapter === chapterId && m.p === sheet.p) || null
    : null;

  // the way back from a jump fades on its own
  useEffect(() => {
    if (!back) return undefined;
    const t = setTimeout(() => setBack(null), 20000);
    return () => clearTimeout(t);
  }, [back]);

  /* ---- go to a page number / a percentage ---- */
  const onGoPage = (n) => {
    if (!nums) return;
    const hit = locatePage(nums, n);
    if (hit) goTo(chapters[hit.index].id, { pos: hit.pos, mark: true });
  };
  const onGoPercent = (pct) => commitSeek(Math.round(pct * 10));

  // the chapter after this one, if it is already in memory
  const nextHtml = next ? peekChapter(book, next.id) : null;

  // what is on screen this render: the chapter we have, or one straight from the cache
  let viewNow = view && view.id === chapterId ? view : null;
  if (!viewNow) {
    const cachedNow = peekChapter(book, chapterId);
    if (cachedNow) {
      const st = location.state;
      const fromNav = st && st.chapter === chapterId && st.pos !== undefined;
      const saved = getProgress(slug);
      const startPos = fromNav ? st.pos : saved && saved.chapter === chapterId ? saved.pos || 0 : 0;
      viewNow = { id: chapterId, html: cachedNow, startPos };
      shownRef.current = chapterId;
    }
  }

  return (
    <div
      className={`rd rd--${prefs.mode} ${barsOn ? "chrome-on" : "chrome-off"} ${prefs.bold ? "rd--bold" : ""}`}
      data-theme={resolvedTheme}
      style={style}
      onClick={onContentClick}
    >
      <Seo
        meta={{
          title: `${chapter.num ? `${chapter.num} · ` : ""}${chapter.title} — ${book.title} · ${book.author}`,
          description: book.description,
          path: `/read/${slug}/${chapterId}`,
          noindex: true,
          lang: book.language,
        }}
      />

      {/* a hairline of progress that stays when everything else tucks away */}
      <div className="rd__bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${overall})` }} />
      </div>

      {/* -------------------------------------------------------- top bar */}
      <header className="rd__top">
        {/* the way out: progress is saved as the reader unmounts */}
        <Link className="rd__exit" to="/" aria-label="किताब से बाहर निकलें" title="बाहर निकलें">
          <IconClose width={20} height={20} />
          <span>बाहर</span>
        </Link>
        <div className="rd__heading">
          <span className="rd__book">{book.title}</span>
          <span className="rd__chap">
            <Scrolling>{label}</Scrolling>
          </span>
        </div>
        <div className="rd__tools">
          <button
            type="button"
            className={`rd__ib rd__ib--mark ${bookmarked ? "is-on" : ""}`}
            onClick={() => bookmarkRef.current?.()}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "बुकमार्क हटाएँ" : "इस पन्ने पर बुकमार्क लगाएँ"}
            title="बुकमार्क (B)"
          >
            {bookmarked ? <IconBookmarkFill /> : <IconBookmark />}
          </button>
          <button
            type="button"
            className="rd__ib"
            onClick={() => setPanel("search")}
            aria-label="किताब में खोजें"
            title="खोजें (S)"
          >
            <IconSearch />
          </button>
          <button
            type="button"
            className="rd__ib"
            onClick={() => setPanel("toc")}
            aria-label="अनुक्रम"
            title="अनुक्रम (T)"
          >
            <IconList />
          </button>
          <button
            type="button"
            className="rd__ib"
            onClick={() => setPanel("settings")}
            aria-label="पढ़ने की सेटिंग"
            title="सेटिंग (A)"
          >
            <IconType />
          </button>
        </div>
      </header>

      {/* ----------------------------------------------------------- text */}
      <main className="rd__main" id="rd-main">
        {failed ? (
          <Problem slug={slug} retry={() => setAttempt((n) => n + 1)} />
        ) : !viewNow ? (
          <Skeleton />
        ) : prefs.mode === "paged" ? (
          <PagedView
            key={`${viewNow.id}:paged`}
            html={viewNow.html}
            nextHtml={nextHtml}
            startPos={viewNow.startPos}
            lang={book.language}
            layoutKey={layoutKey}
            turn={prefs.turn}
            sound={prefs.sound}
            haptic={prefs.haptic}
            enter={enterRef.current}
            hasPrev={Boolean(prev)}
            hasNext={Boolean(next)}
            folioOf={folioOf}
            author={book.author}
            title={book.title}
            marks={chapterMarks}
            bookmarked={bookmarked}
            onPos={onPos}
            onEdge={onEdge}
            onTap={toggleChrome}
            onRegisterApi={registerApi}
            onPara={onPara}
          />
        ) : (
          <ScrollView
            key={`${viewNow.id}:scroll`}
            html={viewNow.html}
            startPos={viewNow.startPos === "end" ? 1 : viewNow.startPos}
            lang={book.language}
            marks={chapterMarks}
            onPos={onPos}
            onChrome={setChrome}
            onTap={toggleChrome}
            onRegisterApi={registerApi}
            onPara={onPara}
            footer={<FlowFooter book={book} next={next} onNext={nextChapter} />}
          />
        )}
      </main>

      {/* a quiet line of status for when the bars are tucked away */}
      <div className="rd__status">
        <span>
          <Scrolling>{label}</Scrolling>
        </span>
        <button type="button" className="rd__cycle" onClick={cycleProgress} title="बदलने के लिए दबाइए">
          {progressText}
        </button>
      </div>

      {/* ------------------------------------------------------ bottom bar */}
      <footer className="rd__bottom">
        <button
          type="button"
          className="rd__ib"
          onClick={prevChapter}
          disabled={!prev}
          aria-label="पिछला अध्याय"
          title="पिछला अध्याय"
        >
          <IconBack />
        </button>

        <div className="rd__seek">
          <div className="rd__seekText">
            <span>
              <Scrolling>{seekLabel || label}</Scrolling>
            </span>
            {preview !== null ? (
              <span>{`${Math.floor(preview / 10)}%`}</span>
            ) : (
              <button
                type="button"
                className="rd__cycle"
                onClick={cycleProgress}
                title="बदलने के लिए दबाइए"
              >
                {progressText}
                {prefs.progress === "page" ? ` · ${percent}%` : ""}
              </button>
            )}
          </div>
          <input
            className="rd__range"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={sliderValue}
            aria-label="पूरी किताब में स्थान"
            aria-valuetext={`${percent} प्रतिशत`}
            style={{ "--p": `${sliderValue / 10}%` }}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPreview(v);
              clearTimeout(seekTimer.current);
              if (!dragging.current) seekTimer.current = setTimeout(() => commitSeek(v), 550);
            }}
            onPointerDown={() => {
              dragging.current = true;
              clearTimeout(seekTimer.current);
            }}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onTouchEnd={finishDrag}
          />
        </div>

        <button
          type="button"
          className="rd__ib"
          onClick={nextChapter}
          disabled={!next}
          aria-label="अगला अध्याय"
          title="अगला अध्याय"
        >
          <IconNext />
        </button>
      </footer>

      {newer && (
        <div className="rd__notice" role="status">
          <span>इस किताब का नया संस्करण आ गया है।</span>
          <button type="button" onClick={() => window.location.reload()}>
            ताज़ा करें
          </button>
        </div>
      )}

      {resume && !panel && !sheet && (
        <div className="rd__resume" role="status">
          <span>
            दूसरे डिवाइस पर आप{" "}
            {(() => {
              const c = chapters.find((x) => x.id === resume.chapter);
              return c ? (c.num ? `${c.num} · ${c.title}` : c.title) : "आगे";
            })()}{" "}
            तक पहुँचे थे
          </span>
          <button
            type="button"
            onClick={() => {
              const s = takeSuggestion(slug);
              if (s) goTo(s.chapter, { pos: s.pos, mark: true });
            }}
          >
            वहाँ चलें
          </button>
          <button type="button" className="rd__resumeX" aria-label="बंद करें" onClick={() => dismissSuggestion(slug)}>
            ✕
          </button>
        </div>
      )}

      {back && !panel && !sheet && !resume && (
        <button
          type="button"
          className="rd__back"
          onClick={() => {
            goTo(back.chapter, { pos: back.pos });
            setBack(null);
          }}
        >
          <IconReturn width={16} height={16} />
          पिछली जगह पर लौटें
        </button>
      )}

      {hint && prefs.mode === "paged" && !panel && (
        <button type="button" className="rd__hint" onClick={dismissHint} aria-label="समझ गया">
          <span>
            <b>←</b>
            पिछला पन्ना
          </span>
          <span>
            <b>⋯</b>
            मेन्यू
          </span>
          <span>
            <b>→</b>
            अगला पन्ना
          </span>
        </button>
      )}

      {/* a press-and-hold on a paragraph */}
      {sheet && (
        <>
          <button
            type="button"
            className="rdp__scrim"
            aria-label="बंद करें"
            onClick={() => setSheet(null)}
          />
          <MarkSheet
            key={`${chapterId}:${sheet.p}`}
            text={sheet.text}
            mark={sheetMark}
            onColor={(color) => notes.setMark(chapterId, sheet.p, { color }, sheet.text)}
            onNote={(note) => notes.setMark(chapterId, sheet.p, { note }, sheet.text)}
            onRemove={() => {
              notes.removeMark(chapterId, sheet.p);
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        </>
      )}

      {/* brightness and the warm wash sit above everything, panels included */}
      <div className="rd__dim" style={{ opacity: (1 - prefs.brightness) * 0.8 }} aria-hidden="true" />
      <div className="rd__warm" style={{ opacity: prefs.warm }} aria-hidden="true" />

      {/* --------------------------------------------------------- panels */}
      {panel && (
        <>
          <button
            type="button"
            className="rdp__scrim"
            aria-label="बंद करें"
            onClick={() => setPanel(null)}
          />
          {(panel === "toc" || panel === "search" || panel === "marks") && (
            <Contents
              key={panel}
              book={book}
              currentId={chapterId}
              done={done}
              initialTab={panel === "search" ? "search" : panel === "marks" ? "marks" : "toc"}
              notes={notes}
              pages={paged ? totalPages : 0}
              pageOf={pageOf}
              onGoPage={onGoPage}
              onGoPercent={onGoPercent}
              onGo={(id, opts) => goTo(id, { ...(opts || { pos: 0 }), mark: true })}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "settings" && (
            <Settings
              prefs={prefs}
              update={(patch) => (patch.mode ? setMode(patch.mode) : update(patch))}
              reset={reset}
              onClose={() => setPanel(null)}
              canFullscreen={canFullscreen}
              fullscreen={fullscreen}
              onFullscreen={toggleFullscreen}
            />
          )}
          {panel === "end" && (
            <div className="rdp rdp--center" role="dialog" aria-modal="true" aria-label="किताब समाप्त">
              <FlowFooter book={book} next={null} />
              <ReviewsSection book={book} variant="reader" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the route */
export default function Reader() {
  const { slug, chapter } = useParams();
  const { data: book, error } = useBook(slug);

  if (error) {
    return (
      <div className="rd rd--scroll" data-theme="paper">
        <Seo meta={{ title: "किताब नहीं मिली", path: `/read/${slug}`, noindex: true }} />
        <div className="rd__loading rd__loading--err" role="alert">
          <p>यह किताब नहीं मिली।</p>
          <Link className="rd__btn" to="/library">
            रचनाएँ देखिए
          </Link>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="rd rd--scroll" data-theme="paper">
        <Skeleton label="किताब खुल रही है…" />
      </div>
    );
  }

  const valid = chapter && book.chapters.some((c) => c.id === chapter);
  if (!valid) {
    // no chapter in the address: resume, or begin at the first real chapter
    const saved = getProgress(slug);
    const resume = saved && book.chapters.some((c) => c.id === saved.chapter) ? saved.chapter : null;
    // a first visit opens on the cover, like the physical book
    const first = book.chapters[0].id;
    return <Navigate replace to={`/read/${slug}/${resume || first}`} />;
  }

  return (
    <ReadWall book={book}>
      <ReaderShell key={slug} book={book} chapterId={chapter} />
    </ReadWall>
  );
}

