// src/library/BookShowcase.jsx
// The book as an object: a front cover, and a back cover you can turn to.
//
// The front is the real cover art. The back is typeset here, from what the
// book itself says — its first lines, the line printed on its cover, a word
// about the author and the imprint — because a book people are about to read
// should be able to be turned over, like the one in your hand.
//
// Two ways to turn it, so nobody has to find a trick: swipe it, or press the
// labelled tab beneath it. Tapping the book opens the cover like a picture.

import React, { useRef, useState } from "react";
import { Cover } from "./BookCard";
import { contentUrl } from "./api";
import { backCoverContent } from "./coverImage";
import { openCoverViewer } from "./CoverViewer";
import { IconExpand } from "../reader/icons";

/* --------------------------------------------------------- the back cover */
export function BackCover({ book, className = "", sizes = "(max-width: 760px) 80vw, 420px" }) {
  const art = book.art;
  if (art && art.back) {
    // the printed back cover, as supplied
    const small = contentUrl(book.slug, art.backSmall || art.back);
    const full = contentUrl(book.slug, art.back);
    return (
      <img
        className={`bcover bback-img ${className}`}
        src={small}
        srcSet={small === full ? undefined : `${small} 640w, ${full} 2000w`}
        sizes={sizes}
        width="640"
        height="898"
        alt={`${book.title} — ${book.author} — पिछला आवरण`}
        loading="lazy"
        decoding="async"
      />
    );
  }

  // no picture supplied: set the back from what the book itself says
  // (the same words are drawn into the downloadable picture, coverImage.js)
  const { lines, about, quote, aboutHead, published } = backCoverContent(book);

  return (
    <div className={`bback ${className}`} lang={book.language || "hi"}>
      <div className="bback__in">
      <div className="bback__top">
        <span>{book.title}</span>
        <span>{book.author}</span>
      </div>

      <div className="bback__body">
        <p className="bback__blurb">
          {lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </p>

        {quote && (
          <>
            <i className="bback__rule" aria-hidden="true" />
            <p className="bback__quote">{quote}</p>
          </>
        )}
      </div>

      {about && (
        <p className="bback__about">
          <b>{aboutHead}</b>
          {about}
        </p>
      )}

      <div className="bback__foot">
        <span>{published}</span>
        <span>www.vinaytiwari.org</span>
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the showcase */
export default function BookShowcase({ book, eager = false, sizes, peek = true, className = "" }) {
  const [side, setSide] = useState("front");
  const [touched, setTouched] = useState(false);
  const down = useRef(null);
  const back = side === "back";

  const flip = (to) => {
    setTouched(true); // the hint has done its job; its animation must not fight the turn
    setSide(to === undefined ? (back ? "front" : "back") : to);
  };

  const onPointerDown = (e) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      flip(dx < 0 ? "back" : "front"); // swipe left to turn it over, right to return
    } else if (Math.hypot(dx, dy) < 8) {
      // a tap opens the cover like a picture; turning is by swipe or the tabs
      openCoverViewer(book, back ? "back" : "front");
    }
  };

  return (
    <div className={`bshow ${className}`} data-side={side}>
      <div
        className={`bshow__stage ${peek && !touched ? "has-peek" : ""}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          down.current = null;
        }}
      >
        <div className="bshow__book" style={{ transform: back ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          <div className="bshow__face bshow__face--front" inert={back || undefined}>
            <Cover book={book} eager={eager} sizes={sizes} />
          </div>
          <div className="bshow__face bshow__face--back" inert={!back || undefined}>
            <BackCover book={book} />
          </div>
        </div>

        <button
          type="button"
          className="bshow__zoom"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => openCoverViewer(book, back ? "back" : "front")}
          aria-label="आवरण बड़ा करके देखिए और डाउनलोड कीजिए"
          title="बड़ा करके देखिए"
        >
          <IconExpand width={20} height={20} />
        </button>
      </div>

      <div className="bshow__tabs" role="tablist" aria-label="पुस्तक का आवरण">
        <button
          type="button"
          role="tab"
          aria-selected={!back}
          className={!back ? "is-on" : ""}
          onClick={() => flip("front")}
        >
          आगे का आवरण
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={back}
          className={back ? "is-on" : ""}
          onClick={() => flip("back")}
        >
          पिछला आवरण
        </button>
      </div>
    </div>
  );
}
