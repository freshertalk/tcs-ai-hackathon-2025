// src/library/CoverViewer.jsx
// Open a cover like a picture: large, on a dark ground, with the other face one
// press away, a way to zoom to full size, and a way to keep it.
//
// One host is mounted for the whole app; anything can open it with
// openCoverViewer(book, "front" | "back").

import React, { useCallback, useEffect, useRef, useState } from "react";
import { contentUrl } from "./api";
import { renderBackCover } from "./coverImage";
import { IconClose, IconDownload } from "../reader/icons";

const EVENT = "vkt:cover-viewer";

export function openCoverViewer(book, face = "front") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { book, face } }));
}

/** Spread onto an element to make it open the viewer on click, Enter or Space. */
export function zoomProps(book, face = "front") {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": `${face === "back" ? "पिछला" : "आगे का"} आवरण — बड़ा करके देखिए और डाउनलोड कीजिए`,
    "data-cursor": "बड़ा",
    onClick: () => openCoverViewer(book, face),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCoverViewer(book, face);
      }
    },
  };
}

function download(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const FACE_LABEL = {
  front: "आगे का आवरण",
  back: "पिछला आवरण",
};

/** The faces a book has, in the order they are shown. */
function facesOf() {
  return ["front", "back"];
}

const fileExt = (p) => (String(p).match(/\.[a-z0-9]+$/i) || [".jpg"])[0].toLowerCase();

export default function CoverViewerHost() {
  const [state, setState] = useState(null); // { book, face }
  const [typeset, setTypeset] = useState(null); // blob url of a drawn back, when no picture was supplied
  const [backErr, setBackErr] = useState(false);
  const [zoom, setZoom] = useState(false);
  const closeRef = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    const on = (e) => {
      returnTo.current = document.activeElement;
      setZoom(false);
      setState({ book: e.detail.book, face: e.detail.face });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const close = useCallback(() => {
    setState(null);
    const el = returnTo.current;
    if (el && el.focus) el.focus({ preventScroll: true });
  }, []);

  // With no back-cover picture supplied, the back is drawn on demand.
  const slug = state && state.book.slug;
  const needsDrawn = Boolean(state && !(state.book.art && state.book.art.back));
  useEffect(() => {
    if (!state || !needsDrawn) return undefined;
    let live = true;
    let made = null;
    setTypeset(null);
    setBackErr(false);
    renderBackCover(state.book)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setTypeset(made);
      })
      .catch(() => live && setBackErr(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // only when a different book is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, needsDrawn]);

  useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setZoom(false);
        setState((s) => {
          if (!s) return s;
          const faces = facesOf(s.book);
          const at = faces.indexOf(s.face);
          const next = faces[(at + (e.key === "ArrowRight" ? 1 : faces.length - 1)) % faces.length];
          return { ...s, face: next };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("is-cover-open");
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("is-cover-open");
    };
  }, [state, close]);

  if (!state) return null;

  const { book, face } = state;
  const art = book.art || null;
  const faces = facesOf(book);

  // what to show, what to keep
  let src = null; // the picture on screen
  let web = null; // a sensible-size file to download
  let original = null; // the picture exactly as supplied
  if (face === "front") {
    src = contentUrl(book.slug, (art && art.front) || book.cover || book.coverSmall);
    web = src;
    original = art && art.original && art.original.front ? contentUrl(book.slug, art.original.front) : null;
  } else if (face === "back") {
    if (art && art.back) {
      src = contentUrl(book.slug, art.back);
      web = src;
      original = art.original && art.original.back ? contentUrl(book.slug, art.original.back) : null;
    } else {
      src = typeset;
      web = typeset;
    }
  }
  const placeholder =
    face === "front" && book.coverSmall ? contentUrl(book.slug, book.coverSmall) : null;
  const waiting = face === "back" && !(art && art.back) && !typeset && !backErr;

  const keepWeb = () => {
    if (!web) return;
    download(web, `${book.slug}-${face}${fileExt(web) === ".png" || web.startsWith("blob:") ? ".png" : ".jpg"}`);
  };
  const keepOriginal = () => {
    if (original) download(original, `${book.slug}-${face}-original${fileExt(original)}`);
    else keepWeb();
  };

  const setFace = (f) => {
    setZoom(false);
    setState((s) => ({ ...s, face: f }));
  };

  return (
    <div className="cv" role="dialog" aria-modal="true" aria-label={`${book.title} — आवरण`}>
      <button type="button" className="cv__scrim" aria-label="बंद करें" onClick={close} />

      <header className="cv__bar">
        <div className="cv__tabs" role="tablist" aria-label="आवरण">
          {faces.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={face === f}
              className={face === f ? "is-on" : ""}
              onClick={() => setFace(f)}
            >
              {FACE_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="cv__acts">
          {original && web && web !== original && (
            <button
              type="button"
              className="cv__btn cv__btn--ghost"
              onClick={keepWeb}
              disabled={!src}
              aria-label="छोटा JPG डाउनलोड करें"
              title="छोटा आकार (JPG)"
            >
              <span>JPG</span>
            </button>
          )}
          <button
            type="button"
            className="cv__btn cv__btn--solid"
            onClick={keepOriginal}
            disabled={!src}
            aria-label={original ? "मूल आकार (4K) डाउनलोड करें" : "इस आवरण को डाउनलोड करें"}
          >
            <IconDownload width={20} height={20} />
            <span>{original ? "डाउनलोड · 4K" : "डाउनलोड"}</span>
          </button>
          <button ref={closeRef} type="button" className="cv__btn cv__x" onClick={close} aria-label="बंद करें">
            <IconClose width={22} height={22} />
          </button>
        </div>
      </header>

      <div className={`cv__stage ${zoom ? "is-zoom" : ""}`} data-lenis-prevent>
        {src ? (
          <img
            key={face}
            className="cv__img"
            src={src}
            alt={`${book.title} — ${book.author} — ${FACE_LABEL[face]}`}
            onClick={() => setZoom((z) => !z)}
            draggable={false}
            style={placeholder ? { backgroundImage: `url(${placeholder})` } : undefined}
          />
        ) : backErr ? (
          <p className="cv__note">पिछला आवरण अभी नहीं बन पाया।</p>
        ) : (
          <p className="cv__note" role="status">
            {waiting ? "आवरण बन रहा है…" : "आवरण नहीं मिला।"}
          </p>
        )}
      </div>

      <p className="cv__hint" aria-hidden="true">
        {zoom ? "छोटा करने के लिए चित्र को फिर दबाइए" : "पूरे आकार में देखने के लिए चित्र को दबाइए"}
      </p>
    </div>
  );
}
