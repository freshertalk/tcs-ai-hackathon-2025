// src/reader/PagedView.jsx
// Page-by-page reading, laid out like a printed book.
//
//   narrow screens  → one page at a time
//   wide screens    → two pages side by side, an open book
//
// How it is built
//   Every page is its own small element that shows one column of the chapter.
//   The chapter is poured into CSS columns exactly one page tall; a page
//   element simply slides that strip so its own column is the one in view.
//   Because pages are separate elements they can be real leaves: the page
//   being turned is a 3D sheet hinged at the spine, with a front, a back, and
//   the next pages already waiting underneath.
//
//   Resizing, rotating a phone or changing the type just re-pours the same
//   text and the reader stays at the same place in the chapter.
//
// Turning
//   • tap the left / right of the page, or press ← → / PageUp / PageDown / Space
//   • drag the page with a finger or the mouse — the leaf follows, and lets go
//     either way depending on how far and how fast
//   • scroll the wheel or trackpad sideways
//
// Every printed page carries a running foot: the author's name and the page
// number on left-hand pages, the title and the number on right-hand ones.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { IconBack, IconNext } from "./icons";
import { prefersReducedMotion } from "./util";
import { pageSound } from "./sound";

const TWO_UP_AT = 900; // px of usable width before the book opens to two pages
const PAD_TOP = 30; // px of clear paper above the text, below the bar
const FOLIO_H = 56; // px kept under the text: air, then the running foot
const COL_GAP = 40; // between columns inside the strip; never visible
const SWIPE_MIN = 48; // px
const TAP_MAX = 10; // px of drift that is still a tap
const LONG_MS = 460; // press-and-hold, for marking a paragraph

const HL = ["hl", "hl-y", "hl-g", "hl-b", "hl-r", "has-note"];

const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const op = (el, v) => {
  if (el) el.style.opacity = String(v);
};

/* ----------------------------------------------------------- one page */
const Page = React.memo(function Page({
  src,
  html,
  lang,
  col,
  P,
  colW,
  pad,
  H,
  Ht,
  side,
  foot,
  footSide,
  measureRef,
  onLoad,
}) {
  return (
    <div className={`pg pg--${side}`} data-src={src} style={{ width: P, height: H }}>
      {html ? (
        <div className="pg__text" style={{ top: PAD_TOP, left: pad, width: colW, height: Ht }}>
          <div
            ref={measureRef}
            className="pg__cols"
            style={{
              width: colW,
              height: Ht,
              columnWidth: colW,
              columnGap: COL_GAP,
              "--rd-page-h": `${Ht}px`,
              transform: `translate3d(${-col * (colW + COL_GAP)}px,0,0)`,
            }}
          >
            <article
              className="rd-text"
              lang={lang}
              onLoadCapture={onLoad}
              // chapter html is sanitised in library/api.js before it is cached
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      ) : null}
      {foot ? (
        <div className={`pg__foot pg__foot--${footSide}`} style={{ left: pad, right: pad }}>
          {foot}
        </div>
      ) : null}
      <i className="pg__gutter" />
    </div>
  );
});

/* ------------------------------------------------------ paint a turn */
// p runs 0 → 1. Everything about how a leaf looks while it moves is here:
// the hinge rotation, the sheet darkening as it stands up, the shadow it
// throws on the page it uncovers, and on the one it lands on.
function paintTwo(R, dir, p) {
  const deg = p * 180;
  const s = Math.sin(p * Math.PI);
  const A = dir > 0 ? "R" : "L"; // the side that lifts
  const B = dir > 0 ? "L" : "R"; // the side it lands on
  const leaf = R["leaf" + A];
  const other = R["leaf" + B];
  if (!leaf || !other) return;

  // a sheet is never quite flat: its free edge trails, then catches up
  const bend = (dir > 0 ? -1 : 1) * s * 1.3;
  leaf.style.transform = `rotateY(${dir > 0 ? -deg : deg}deg) skewY(${bend}deg)`;
  leaf.style.zIndex = "4";
  other.style.zIndex = "2";

  op(R["fxFront" + A], deg < 90 ? (deg / 90) * 0.34 : 0.34);
  op(R["fxBack" + A], deg > 90 ? ((180 - deg) / 90) * 0.3 : 0.3);
  op(R["fxUnder" + A], s * 0.55);
  op(R["fxFront" + B], deg > 90 ? ((deg - 90) / 90) * 0.4 : 0);

  // light slides across the sheet as it bends away
  const sheen = R["sheen" + A];
  if (sheen) {
    sheen.style.opacity = String(s * 0.6);
    sheen.style.backgroundPosition = `${(1 - p) * 100}% 0`;
  }
}

function restTwo(R) {
  for (const k of ["leafL", "leafR"]) {
    const el = R[k];
    if (el) {
      el.style.transform = "";
      el.style.zIndex = "2";
    }
  }
  for (const k of ["fxFrontL", "fxFrontR", "fxBackL", "fxBackR", "fxUnderL", "fxUnderR", "sheenL", "sheenR"]) {
    op(R[k], 0);
  }
}

function paintOne(R, dir, p) {
  const s = Math.sin(p * Math.PI);
  if (!R.leaf) return;
  if (dir > 0) {
    const deg = p * 180;
    R.leaf.style.transform = `rotateY(${-deg}deg) skewY(${-s * 1.3}deg)`;
    R.leaf.style.zIndex = "4";
    op(R.fxFront, clamp(deg / 80, 0, 1) * 0.38);
    op(R.fxBack, deg > 90 ? ((180 - deg) / 90) * 0.3 : 0.3);
    op(R.fxUnder, s * 0.5);
    if (R.sheen) {
      R.sheen.style.opacity = String(s * 0.6);
      R.sheen.style.backgroundPosition = `${(1 - p) * 100}% 0`;
    }
  } else if (R.leafPrev) {
    // the previous page swings back in from the left and lands on this one
    R.leafPrev.style.visibility = "visible";
    R.leafPrev.style.zIndex = "5";
    R.leafPrev.style.transform = `rotateY(${-(1 - p) * 180}deg)`;
    op(R.fxPrev, (1 - p) * 0.4);
    op(R.fxFront, p * 0.34);
  }
}

function restOne(R) {
  if (R.leaf) {
    R.leaf.style.transform = "";
    R.leaf.style.zIndex = "3";
  }
  if (R.leafPrev) {
    R.leafPrev.style.visibility = "hidden";
    R.leafPrev.style.transform = "rotateY(-180deg)";
    R.leafPrev.style.zIndex = "1";
  }
  for (const k of ["fxFront", "fxBack", "fxUnder", "fxPrev", "sheen"]) op(R[k], 0);
}

/* ------------------------------------------------------------ the view */
export default function PagedView({
  html,
  nextHtml = null,
  startPos = 0,
  lang,
  layoutKey,
  turn = "page",
  sound = false,
  haptic = true,
  enter = "fade",
  hasPrev = false,
  hasNext = false,
  folioOf,
  author = "",
  title = "",
  marks = [],
  bookmarked = false,
  onPos,
  onEdge,
  onTap,
  onRegisterApi,
  onPara,
}) {
  const frameRef = useRef(null);
  const areaRef = useRef(null);
  const bkRef = useRef(null);
  const measureRef = useRef(null);
  const R = useRef({}).current; // the animated elements, by name

  const [dims, setDims] = useState(null); // { P, colW, pad, H, Ht, two }
  const [lay, setLay] = useState({ count: 1, lead: 0, S: 1 });
  const [idx, setIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const want = useRef(startPos === "end" ? 1 : Number(startPos) || 0); // fraction of the chapter we owe the reader
  const idxRef = useRef(0);
  const layRef = useRef(lay);
  const dimsRef = useRef(null);
  const userTurn = useRef(false);
  const anim = useRef(null);
  const drag = useRef(null);
  const wheel = useRef({ acc: 0, at: 0, lock: false });

  // the latest props, for handlers that outlive a render
  const live = useRef({});
  live.current = { turn, sound, haptic, hasPrev, hasNext, nextHtml, onEdge, onTap, onPara, folioOf };

  // a picture finishing its load changes the text's shape
  const onLoad = useCallback(() => setTick((t) => t + 1), []);

  const reduced = prefersReducedMotion();
  const style = reduced ? "none" : turn;

  /* ---- 1. how big is a page? ---- */
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;

    const read = () => {
      const avail = Math.floor(area.clientWidth);
      const H = Math.floor(area.clientHeight);
      if (avail < 120 || H < 160) return;

      const cap = parseFloat(getComputedStyle(area).getPropertyValue("--rd-w")) || 660;
      const two = avail >= TWO_UP_AT;
      const pad = two
        ? Math.round(clamp(avail * 0.032, 26, 56))
        : avail < 520
        ? 4
        : 14;
      const colW = two
        ? Math.max(160, Math.min(Math.floor(cap), Math.floor(avail / 2) - pad * 2))
        : Math.max(160, Math.min(Math.floor(cap), avail - pad * 2));
      const P = colW + pad * 2;
      const Ht = H - PAD_TOP - FOLIO_H;

      setDims((d) =>
        d && d.P === P && d.H === H && d.colW === colW && d.pad === pad && d.two === two
          ? d
          : { P, colW, pad, H, Ht, two }
      );
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(area);
    return () => ro.disconnect();
  }, [layoutKey]);

  dimsRef.current = dims;

  /* ---- 2. re-pour when anything that changes the text's shape changes ---- */
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    document.fonts?.ready?.then(bump);
    document.fonts?.addEventListener?.("loadingdone", bump);
    return () => document.fonts?.removeEventListener?.("loadingdone", bump);
  }, []);

  const posOf = (i, L) => {
    if (i >= L.S - 1) return 1;
    const first = L.two ? Math.max(0, 2 * i - L.lead) : i;
    return first / L.count;
  };

  useLayoutEffect(() => {
    const cols = measureRef.current;
    if (!dims || !cols) return;

    // columns overflow to the right; scrollWidth is the whole strip
    const strip = cols.scrollWidth;
    const count = Math.max(1, Math.round((strip + COL_GAP) / (dims.colW + COL_GAP)));
    const f = live.current.folioOf ? live.current.folioOf(dims.two, dims, 0) : null;
    const lead = dims.two ? (f ? f.lead : 1) : 0;
    const S = dims.two ? Math.ceil((count + lead) / 2) : count;
    const next = { count, lead, S, two: dims.two };

    const w = clamp(want.current, 0, 1);
    const col = w >= 1 ? count - 1 : Math.floor(w * count + 1e-6);
    const target = clamp(dims.two ? Math.floor((col + lead) / 2) : col, 0, S - 1);

    layRef.current = next;
    idxRef.current = target;
    setLay(next);
    setIdx(target);
    setReady(true);
  }, [dims, html, layoutKey, tick]);

  /* ---- 3. report where we are ---- */
  useEffect(() => {
    if (!ready || !dims) return;
    const L = layRef.current;
    const firstCol = L.two ? Math.max(0, 2 * idx - L.lead) : idx;
    const lastCol = L.two ? Math.min(L.count - 1, 2 * idx + 1 - L.lead) : idx;
    const pos = posOf(idx, L);
    want.current = pos;
    onPos?.(pos, {
      user: userTurn.current,
      idx,
      S: L.S,
      count: L.count,
      firstCol,
      lastCol: Math.max(firstCol, lastCol),
      span: [firstCol / L.count, (Math.max(firstCol, lastCol) + 1) / L.count],
      two: L.two,
      lead: L.lead,
      colW: dims.colW,
      Ht: dims.Ht,
      sig: `${layoutKey}|${dims.colW}|${dims.Ht}|${dims.two ? 2 : 1}`,
    });
    userTurn.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, lay, ready, onPos]);

  /* ---- highlights: classes on the paragraphs that carry a mark ---- */
  useLayoutEffect(() => {
    const root = bkRef.current;
    if (!root) return;
    const byPara = new Map();
    marks.forEach((m) => byPara.set(m.p, m));
    root.querySelectorAll('.pg[data-src="cur"] article.rd-text').forEach((art) => {
      art.querySelectorAll("p").forEach((p, i) => {
        p.classList.remove(...HL);
        const m = byPara.get(i);
        if (m) {
          p.classList.add("hl", `hl-${m.color}`);
          if (m.note) p.classList.add("has-note");
        }
      });
    });
  }, [marks, html, dims, tick, lay]);

  /* ---- the turning machinery ---- */
  const rest = useCallback(() => {
    if (dimsRef.current && dimsRef.current.two) restTwo(R);
    else restOne(R);
  }, [R]);

  const paint = useCallback(
    (dir, p) => {
      if (dimsRef.current && dimsRef.current.two) paintTwo(R, dir, p);
      else paintOne(R, dir, p);
    },
    [R]
  );

  const run = useCallback(
    (dir, from, to, ms, done, easing = ease.inOut) => {
      if (anim.current) cancelAnimationFrame(anim.current.raf);
      const t0 = performance.now();
      const rec = { dir, to, done, raf: 0 };
      anim.current = rec;
      const frame = (now) => {
        const k = clamp((now - t0) / ms, 0, 1);
        paint(dir, from + (to - from) * easing(k));
        if (k < 1) rec.raf = requestAnimationFrame(frame);
        else {
          anim.current = null;
          done();
        }
      };
      rec.raf = requestAnimationFrame(frame);
    },
    [paint]
  );

  const finishNow = useCallback(() => {
    const a = anim.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    anim.current = null;
    paint(a.dir, a.to);
    a.done();
  }, [paint]);

  const commit = useCallback(
    (dir) => {
      const L = layRef.current;
      const next = clamp(idxRef.current + dir, 0, L.S - 1);
      userTurn.current = true;
      idxRef.current = next;
      // the new pages and the leaf's return to rest land in the same frame
      flushSync(() => setIdx(next));
      rest();
    },
    [rest]
  );

  const blip = useCallback(() => {
    const { sound: s, haptic: h } = live.current;
    if (s) pageSound();
    // browsers refuse a buzz until the page has been touched
    const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (h && touched && navigator.vibrate) {
      try {
        navigator.vibrate(7);
      } catch {
        /* not every browser lets a page buzz */
      }
    }
  }, []);

  const duration = (two) => (two ? 520 : 430);

  const turnPage = useCallback(
    (dir, opts = {}) => {
      const d = dimsRef.current;
      if (!d) return;
      if (anim.current) finishNow();

      const L = layRef.current;
      const next = idxRef.current + dir;
      const { nextHtml: nh, hasNext: hn, onEdge: edge } = live.current;
      const animated = style === "page";

      if (next < 0) {
        edge?.(-1);
        return;
      }
      if (next >= L.S) {
        if (dir > 0 && hn && nh && animated) {
          // the last leaf lands on the next chapter's first page, then hand over
          blip();
          run(dir, opts.from || 0, 1, duration(d.two), () => {
            edge?.(1, { continued: true });
            setTimeout(() => {
              if (frameRef.current) rest();
            }, 500);
          });
        } else edge?.(1);
        return;
      }

      blip();
      if (animated) {
        const from = opts.from || 0;
        const ms = from > 0 ? duration(d.two) * (1 - from) + 60 : duration(d.two);
        run(dir, from, 1, ms, () => commit(dir), from > 0 ? ease.out : ease.inOut);
      } else {
        commit(dir);
        const bk = bkRef.current;
        if (bk && bk.animate && style !== "none") {
          const kf =
            style === "slide"
              ? [
                  { opacity: 0, transform: `translateX(${dir > 0 ? 36 : -36}px)` },
                  { opacity: 1, transform: "none" },
                ]
              : [{ opacity: 0 }, { opacity: 1 }];
          bk.animate(kf, { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
        }
      }
    },
    [blip, commit, finishNow, rest, run, style]
  );

  const seekTo = useCallback((pos) => {
    if (anim.current) finishNow();
    const L = layRef.current;
    const w = clamp(pos, 0, 1);
    const col = w >= 1 ? L.count - 1 : Math.floor(w * L.count + 1e-6);
    const next = clamp(L.two ? Math.floor((col + L.lead) / 2) : col, 0, L.S - 1);
    want.current = w;
    idxRef.current = next;
    userTurn.current = true;
    rest();
    setIdx(next);
  }, [finishNow, rest]);

  useEffect(() => {
    onRegisterApi?.({
      step: (dir) => turnPage(dir),
      seek: (pos) => seekTo(pos),
    });
    return () => onRegisterApi?.(null);
  }, [turnPage, seekTo, onRegisterApi]);

  // leaving mid-turn must not leave a frame running
  useEffect(
    () => () => {
      if (anim.current) cancelAnimationFrame(anim.current.raf);
    },
    []
  );

  /* ---- touch + mouse ---- */
  const dragOK = (dir) => {
    const { hasNext: hn, nextHtml: nh } = live.current;
    const L = layRef.current;
    if (style !== "page") return false;
    if (dir > 0) return idxRef.current < L.S - 1 || Boolean(hn && nh);
    return idxRef.current > 0;
  };

  const paraAt = (target) => {
    const el = target.closest && target.closest(".rd-text p");
    if (!el) return null;
    const pg = el.closest(".pg");
    if (!pg || pg.dataset.src !== "cur") return null;
    const art = el.closest("article");
    const index = Array.prototype.indexOf.call(art.querySelectorAll("p"), el);
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (index < 0 || text.length < 2) return null;
    return { index, text };
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest && e.target.closest("a, button, input, textarea")) return;
    if (anim.current) finishNow();
    if (peeked.current) {
      peeked.current = 0;
      rest();
    }

    const d = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      type: e.pointerType,
      mode: null,
      dir: 0,
      p: 0,
      samples: [{ x: e.clientX, t: performance.now() }],
      target: e.target,
      timer: 0,
      cancelled: false,
    };
    if (live.current.onPara) {
      d.timer = setTimeout(() => {
        if (!drag.current || drag.current.mode) return;
        const para = paraAt(d.target);
        if (!para) return;
        d.cancelled = true;
        try {
          if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
            navigator.vibrate(12);
          }
        } catch {
          /* ignore */
        }
        live.current.onPara?.(para);
      }, LONG_MS);
    }
    drag.current = d;
  };

  // the page stirs as the mouse comes to its edge — and settles when it leaves
  const peeked = useRef(0);
  const peek = (e) => {
    if (anim.current || e.pointerType !== "mouse" || !frameRef.current) return;
    const dm = dimsRef.current;
    if (!dm) return;
    const L = layRef.current;
    const rect = frameRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const band = 0.16;
    let dir = 0;
    let k = 0;
    if (x > 1 - band) {
      dir = 1;
      k = (x - (1 - band)) / band;
    } else if (x < band) {
      dir = -1;
      k = (band - x) / band;
    }
    const can = dir > 0 ? idxRef.current < L.S - 1 : idxRef.current > 0;
    if (!dir || !can || style !== "page") {
      if (peeked.current) {
        peeked.current = 0;
        rest();
      }
      return;
    }
    peeked.current = dir;
    paint(dir, 0.012 + k * k * 0.05);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) {
      peek(e);
      return;
    }
    if (d.cancelled || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const now = performance.now();
    d.samples.push({ x: e.clientX, t: now });
    if (d.samples.length > 8) d.samples.shift();

    if (!d.mode) {
      if (Math.hypot(dx, dy) < 9) return;
      clearTimeout(d.timer);
      d.mode = Math.abs(dx) > Math.abs(dy) * 1.1 ? "swipe" : "vert";
      if (d.mode === "swipe") {
        try {
          frameRef.current.setPointerCapture(d.id);
        } catch {
          /* not fatal: the drag still works while the pointer stays over the page */
        }
      }
    }
    if (d.mode !== "swipe") return;

    const dir = dx < 0 ? 1 : -1;
    if (d.dir && d.dir !== dir) rest();
    d.dir = dir;
    if (!dragOK(dir)) return;

    const dm = dimsRef.current;
    const span = dm.two ? dm.P * 1.15 : dm.P * 0.85;
    d.p = clamp(Math.abs(dx) / span, 0, 1);
    paint(dir, d.p);
  };

  const endDrag = (e, cancelled) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    try {
      frameRef.current.releasePointerCapture(d.id);
    } catch {
      /* already released */
    }
    if (d.cancelled) return;

    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const touchLike = d.type !== "mouse";

    if (d.mode === "swipe") {
      const dir = d.dir || (dx < 0 ? 1 : -1);
      if (cancelled) {
        if (d.p > 0) run(dir, d.p, 0, 180, rest, ease.out);
        return;
      }
      const a = d.samples[0];
      const b = d.samples[d.samples.length - 1];
      const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px per ms
      const flick = -v * dir > 0.4;

      if (dragOK(dir) && d.p > 0) {
        const go = d.p > 0.3 || flick;
        const dm = dimsRef.current;
        if (go) {
          const left = 1 - d.p;
          blip();
          const L = layRef.current;
          const toNext = idxRef.current + dir;
          if (toNext >= L.S) {
            run(dir, d.p, 1, 120 + 340 * left, () => {
              live.current.onEdge?.(1, { continued: true });
              setTimeout(() => frameRef.current && rest(), 500);
            }, ease.out);
          } else {
            run(dir, d.p, 1, 110 + (dm.two ? 400 : 330) * left, () => commit(dir), ease.out);
          }
        } else run(dir, d.p, 0, 120 + 220 * d.p, rest, ease.out);
        return;
      }
      if (Math.abs(dx) > SWIPE_MIN) turnPage(dir);
      else rest();
      return;
    }

    if (d.mode === "vert" || cancelled) return;
    if (e.target.closest && e.target.closest("a, button")) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    if (Math.hypot(dx, dy) > TAP_MAX || performance.now() - d.t0 > 600) return;

    const rect = frameRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const zone = touchLike ? 0.3 : 0.22;
    if (x < zone) turnPage(-1);
    else if (x > 1 - zone) turnPage(1);
    else if (touchLike) live.current.onTap?.();
  };

  const onWheel = (e) => {
    const w = wheel.current;
    const now = performance.now();
    if (now - w.at > 220) w.acc = 0;
    w.at = now;
    if (w.lock) return;
    w.acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(w.acc) > 56) {
      const dir = w.acc > 0 ? 1 : -1;
      w.acc = 0;
      w.lock = true;
      setTimeout(() => {
        w.lock = false;
      }, 560);
      turnPage(dir);
    }
  };

  /* ---- what each page element shows ---- */
  const fol = dims && folioOf ? folioOf(dims.two, dims, 0) : null;
  const folNext = dims && folioOf && nextHtml ? folioOf(dims.two, dims, 1) : null;

  // a page reference: which chapter's text, which column, and its number
  const ref = (s, sideIs) => {
    // spread (or page) index s; sideIs: 'l' | 'r' for two-up, ignored for one-up
    const two = dims.two;
    const { count, lead, S } = lay;
    if (s >= 0 && s < S) {
      const c = two ? (sideIs === "l" ? 2 * s - lead : 2 * s + 1 - lead) : s;
      const real = c >= 0 && c < count;
      return {
        src: "cur",
        html,
        col: c,
        num: real && fol && fol.numbered ? fol.first + c : null,
      };
    }
    if (s === S && nextHtml && folNext) {
      const lN = two ? folNext.lead : 0;
      const c = two ? (sideIs === "l" ? -lN : 1 - lN) : 0;
      return {
        src: "next",
        html: nextHtml,
        col: c,
        num: c >= 0 && folNext.numbered ? folNext.first + c : null,
      };
    }
    return { src: "none", html: "", col: 0, num: null };
  };

  const footOf = (r) => {
    if (r.num == null) return { foot: null, footSide: "r" };
    const even = r.num % 2 === 0;
    return { foot: `${even ? author : title} / ${r.num}`, footSide: even ? "l" : "r" };
  };

  const renderPage = (r, side, withMeasure) => {
    const f = footOf(r);
    return (
      <Page
        src={r.src}
        html={r.html}
        lang={lang}
        col={r.col}
        P={dims.P}
        colW={dims.colW}
        pad={dims.pad}
        H={dims.H}
        Ht={dims.Ht}
        side={side}
        foot={f.foot}
        footSide={f.footSide}
        measureRef={withMeasure ? measureRef : undefined}
        onLoad={onLoad}
      />
    );
  };

  const two = Boolean(dims && dims.two);

  let book = null;
  if (dims) {
    if (two) {
      const s = idx;
      book = (
        <div
          ref={bkRef}
          className="bk bk--two"
          style={{
            width: dims.P * 2,
            height: dims.H,
            visibility: ready ? "visible" : "hidden",
          }}
        >
          <div className="slot" style={{ left: 0, width: dims.P, height: dims.H }}>
            {renderPage(ref(s - 1, "l"), "l")}
            <i className="fx fx--under-l" ref={(el) => (R.fxUnderL = el)} />
          </div>
          <div className="slot" style={{ left: dims.P, width: dims.P, height: dims.H }}>
            {renderPage(ref(s + 1, "r"), "r")}
            <i className="fx fx--under-r" ref={(el) => (R.fxUnderR = el)} />
          </div>

          <div
            className="leaf leaf--l"
            ref={(el) => (R.leafL = el)}
            style={{ left: 0, width: dims.P, height: dims.H }}
          >
            <div className="leaf__f">
              {renderPage(ref(s, "l"), "l", true)}
              <i className="fx fx--front-l" ref={(el) => (R.fxFrontL = el)} />
              <i className="fx fx--sheen" ref={(el) => (R.sheenL = el)} />
            </div>
            <div className="leaf__b">
              {renderPage(ref(s - 1, "r"), "r")}
              <i className="fx fx--back" ref={(el) => (R.fxBackL = el)} />
            </div>
          </div>

          <div
            className="leaf leaf--r"
            ref={(el) => (R.leafR = el)}
            style={{ left: dims.P, width: dims.P, height: dims.H }}
          >
            <div className="leaf__f">
              {renderPage(ref(s, "r"), "r")}
              <i className="fx fx--front-r" ref={(el) => (R.fxFrontR = el)} />
              <i className="fx fx--sheen" ref={(el) => (R.sheenR = el)} />
            </div>
            <div className="leaf__b">
              {renderPage(ref(s + 1, "l"), "l")}
              <i className="fx fx--back" ref={(el) => (R.fxBackR = el)} />
            </div>
          </div>

          <span className="bk__spine" aria-hidden="true" />
          {bookmarked && <span className="bk__ribbon" aria-hidden="true" />}
        </div>
      );
    } else {
      const c = idx;
      book = (
        <div
          ref={bkRef}
          className="bk bk--one"
          style={{
            width: dims.P,
            height: dims.H,
            visibility: ready ? "visible" : "hidden",
          }}
        >
          <div className="slot" style={{ left: 0, width: dims.P, height: dims.H }}>
            {renderPage(ref(c + 1), "r")}
            <i className="fx fx--under-r" ref={(el) => (R.fxUnder = el)} />
          </div>

          <div
            className="leaf leaf--one"
            ref={(el) => (R.leaf = el)}
            style={{ left: 0, width: dims.P, height: dims.H }}
          >
            <div className="leaf__f">
              {renderPage(ref(c), "r", true)}
              <i className="fx fx--front-one" ref={(el) => (R.fxFront = el)} />
              <i className="fx fx--sheen" ref={(el) => (R.sheen = el)} />
            </div>
            <div className="leaf__b leaf__b--blank">
              <i className="fx fx--back" ref={(el) => (R.fxBack = el)} />
            </div>
          </div>

          <div
            className="leaf leaf--prev"
            ref={(el) => (R.leafPrev = el)}
            style={{ left: 0, width: dims.P, height: dims.H }}
          >
            <div className="leaf__f">
              {renderPage(ref(c - 1), "r")}
              <i className="fx fx--front-one" ref={(el) => (R.fxPrev = el)} />
            </div>
            <div className="leaf__b leaf__b--blank" />
          </div>
          {bookmarked && <span className="bk__ribbon" aria-hidden="true" />}
        </div>
      );
    }
  }

  return (
    <div
      className={`rd__paged ${enter === "fade" ? "is-enter" : ""}`}
      ref={frameRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onPointerLeave={() => {
        if (peeked.current) {
          peeked.current = 0;
          rest();
        }
      }}
      onWheel={onWheel}
    >
      <button
        type="button"
        className="rd__edge rd__edge--prev"
        onClick={() => turnPage(-1)}
        aria-label="पिछला पन्ना"
        tabIndex={-1}
      >
        <IconBack />
      </button>

      <div className="rd__area" ref={areaRef}>
        {book}
      </div>

      <button
        type="button"
        className="rd__edge rd__edge--next"
        onClick={() => turnPage(1)}
        aria-label="अगला पन्ना"
        tabIndex={-1}
      >
        <IconNext />
      </button>

      <span className="sr-only" aria-live="polite">
        पन्ना {idx + 1} / {lay.S}
      </span>
    </div>
  );
}
