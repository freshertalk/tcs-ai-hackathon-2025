// src/sections/write/Lines.jsx
// पंक्तियाँ — lines from the novel, on a rail the reader moves themselves.
//
// The rail is an ordinary sideways scroller with snap points: a swipe on a
// phone, a trackpad or the two arrow buttons on a desktop, the arrow keys
// when it has focus. The page itself keeps scrolling normally past it — the
// section is one screen tall, not one screen per quote.
//
// Every card is attributed, because a quote that travels should carry the
// author's name with it.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Reveal, MaskLine } from "../../components/ui/motion";
import { LINES, LINE_ATTRIB } from "../../data/books";

const two = (n) => String(n).padStart(2, "0");

function Chevron({ back }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

const Card = React.memo(function Card({ text, i }) {
  return (
    <li className="lnc__item">
      <figure className="ln__card">
        <span className="ln__quote" aria-hidden="true">
          ”
        </span>
        <blockquote className="ln__text">{text}</blockquote>
        <figcaption className="ln__by">{LINE_ATTRIB}</figcaption>
        <span className="ln__idx" aria-hidden="true">
          {two(i + 1)}
        </span>
      </figure>
    </li>
  );
});

export default function Lines() {
  const rail = useRef(null);
  const bar = useRef(null);
  const [at, setAt] = useState({ i: 0, start: true, end: false });

  // where the rail stands: which card leads, and whether either end is reached
  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const first = el.firstElementChild;
    const second = first && first.nextElementSibling;
    const step = first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
    const i = Math.max(0, Math.min(LINES.length - 1, Math.round(el.scrollLeft / Math.max(1, step))));
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft >= max - 2;
    if (bar.current) {
      const shown = Math.max(1, Math.round(el.clientWidth / Math.max(1, step)));
      const part = Math.min(1, shown / LINES.length);
      const p = max > 0 ? el.scrollLeft / max : 0;
      bar.current.style.width = `${part * 100}%`;
      bar.current.style.left = `${p * (1 - part) * 100}%`;
    }
    setAt((was) => (was.i === i && was.start === start && was.end === end ? was : { i, start, end }));
  }, []);

  useEffect(() => {
    const el = rail.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    // The page's smooth scroll takes every wheel event. A sideways gesture
    // over the rail belongs to the rail; an up-and-down one is left alone so
    // the page keeps moving.
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaX;
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onScroll);
    };
  }, [measure]);

  const go = (dir) => {
    const el = rail.current;
    if (!el) return;
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: calm ? "auto" : "smooth" });
  };

  return (
    <section className="section ln lnc" id="lines">
      <div className="shell lnc__head">
        <div>
          <Reveal>
            <span className="eyebrow is-hi">पंक्तियाँ</span>
          </Reveal>
          <h2 className="h-display h-hi title-md lnc__title">
            <MaskLine>कुछ पंक्तियाँ, जो बाद तक साथ चलती हैं</MaskLine>
          </h2>
        </div>

        <div className="lnc__nav">
          <span className="lnc__count" aria-hidden="true">
            {two(at.i + 1)} <i>/ {two(LINES.length)}</i>
          </span>
          <button type="button" className="lnc__btn" onClick={() => go(-1)} disabled={at.start} aria-label="पिछली पंक्तियाँ">
            <Chevron back />
          </button>
          <button type="button" className="lnc__btn" onClick={() => go(1)} disabled={at.end} aria-label="अगली पंक्तियाँ">
            <Chevron />
          </button>
        </div>
      </div>

      <ul className="lnc__rail" ref={rail} tabIndex={0} aria-label={`उपन्यास की ${LINES.length} पंक्तियाँ — दाएँ-बाएँ खिसकाइए`}>
        {LINES.map((t, i) => (
          <Card text={t} i={i} key={t.slice(0, 20)} />
        ))}
      </ul>

      <div className="shell">
        <div className="lnc__track" aria-hidden="true">
          <i ref={bar} />
        </div>
      </div>
    </section>
  );
}
