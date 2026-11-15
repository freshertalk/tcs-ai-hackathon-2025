import React, { useEffect, useRef, useState } from "react";
import "./darshan.css";

// Darshan: Panchmukhi Hanuman Ji, at the top of the private area, so that every visit begins with it.
// The picture is shown whole (never cropped), and opens full screen on a tap or a click.
// If the picture cannot be loaded for any reason the card still stands, with the mantra, and the
// rest of the page is untouched: nothing here can block or break the dashboard.

const SMALL = "/img/hanuman-darshan-640.jpg";
const LARGE = "/img/hanuman-darshan-1200.jpg";
const ALT = "Panchmukhi Hanuman Ji, with the five faces of Hanuman, Narasimha, Garuda, Varaha and Hayagriva, holding the gada, in a golden temple lit by diyas";

/** Full-screen darshan: the picture as large as the screen allows. Esc, a click outside, or the close button. */
function Lightbox({ onClose }) {
  const close = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (close.current) close.current.focus();
    return () => {
      document.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
      if (before && before.focus) before.focus();
    };
  }, [onClose]);
  return (
    <div className="dsn-full" role="dialog" aria-modal="true" aria-label="Darshan of Panchmukhi Hanuman Ji" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button ref={close} type="button" className="dsn-full__x" onClick={onClose} aria-label="Close the darshan">
        ×
      </button>
      <figure>
        <img src={LARGE} alt={ALT} width="1200" height="1200" />
        <figcaption>
          <b>जय श्री हनुमान</b>
          <span>ॐ हं हनुमते नमः</span>
        </figcaption>
      </figure>
    </div>
  );
}

export default function Darshan() {
  const [full, setFull] = useState(false);
  const [broken, setBroken] = useState(false);
  return (
    <>
      <figure className="dsn" aria-label="Darshan">
        {broken ? (
          <div className="dsn__fallback" role="img" aria-label="Panchmukhi Hanuman Ji">
            <span>ॐ</span>
          </div>
        ) : (
          <button type="button" className="dsn__img" onClick={() => setFull(true)} aria-label="Open the darshan full screen" data-tip="Tap for a full-screen darshan.">
            <img src={SMALL} srcSet={`${SMALL} 640w, ${LARGE} 1200w`} sizes="(max-width: 900px) 92vw, 380px" alt={ALT} width="640" height="640" onError={() => setBroken(true)} />
          </button>
        )}
        <figcaption>
          <small>दर्शन · Darshan</small>
          <b>जय श्री हनुमान</b>
          <span>पंचमुखी हनुमान जी</span>
          <em>ॐ हं हनुमते नमः</em>
        </figcaption>
      </figure>
      {full && <Lightbox onClose={() => setFull(false)} />}
    </>
  );
}
