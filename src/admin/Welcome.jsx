// The welcome that opens every time the dashboard (/me) does: the Shri Ram Darbar, and
// the mantra "ॐ श्री गणेशाय नमः" sounded one time. It closes by itself a few seconds
// after the mantra ends; "Enter" or Esc closes it at once.
//
// The picture is the original 3.8 MB PNG re-encoded for the web (AVIF at two sizes,
// with a JPEG for old browsers): the browser downloads about 0.3 MB on an ordinary
// screen and 0.7 MB on a high-density one.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createMantra, MANTRA } from "./mantra";

const MUTE_KEY = "vpt.welcome.muted";
const IMG = "/img/shri-ram-darbar";
// A spoken mantra lasts two or three seconds. The picture deserves longer than that:
// the welcome stays at least this long, and until the mantra has ended.
const MIN_SHOW_MS = 8000;

const storedMute = () => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch (_) {
    return false;
  }
};

export default function Welcome({ onDone }) {
  const [muted, setMuted] = useState(storedMute);
  // "starting" | "playing" | "blocked" | "ended" | "silent"
  const [phase, setPhase] = useState("starting");
  const [leaving, setLeaving] = useState(false);
  const player = useRef(null);
  const enter = useRef(null);
  const closing = useRef(false);
  const shownAt = useRef(Date.now());

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (player.current) player.current.stop();
    setLeaving(true);
    // let it fade; with reduced motion the fade is instant and this is simply a short pause
    setTimeout(onDone, 380);
  }, [onDone]);

  // the mantra, one time
  useEffect(() => {
    if (muted) return undefined;
    setPhase("starting");
    const p = createMantra(setPhase);
    player.current = p;
    return () => {
      p.stop();
      if (player.current === p) player.current = null;
    };
  }, [muted]);

  // when it has been heard — or cannot be — the welcome makes way by itself
  useEffect(() => {
    // while the mantra is playing, or waiting for a tap, the welcome stays
    if (!muted && phase !== "ended" && phase !== "silent") return undefined;
    const left = MIN_SHOW_MS - (Date.now() - shownAt.current);
    const id = setTimeout(close, Math.max(900, left));
    return () => clearTimeout(id);
  }, [phase, muted, close]);

  // a dialog: focus goes in, Esc closes it, the page behind does not scroll
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (enter.current) enter.current.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === "function") before.focus();
    };
  }, [close]);

  const blocked = !muted && phase === "blocked";
  // one press: play it if the browser was waiting for a touch, otherwise go in
  const onEnter = () => {
    if (blocked && player.current) {
      setPhase("starting");
      player.current.retry();
    } else close();
  };
  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch (_) {
        /* private mode — the choice lasts for this visit */
      }
      return next;
    });
  };

  const status = muted
    ? "Sound is off."
    : phase === "playing"
      ? "Playing the mantra once…"
      : phase === "blocked"
        ? "Your browser needs one tap before it can play sound."
        : phase === "silent"
          ? "This browser cannot sound the mantra."
          : "";

  return (
    <div className={`wel ${leaving ? "is-leaving" : ""}`} role="dialog" aria-modal="true" aria-label="Welcome" onClick={(e) => e.target === e.currentTarget && onEnter()}>
      <figure className="wel__card">
        <div className="wel__frame">
          <picture>
            <source type="image/avif" srcSet={`${IMG}-960.avif 960w, ${IMG}-1672.avif 1672w`} sizes="(max-width: 1000px) 94vw, 960px" />
            <img src={`${IMG}-960.jpg`} alt="Shri Ram Darbar" width="1672" height="941" decoding="async" fetchPriority="high" />
          </picture>
        </div>
        <figcaption className="wel__cap">
          <div>
            <p className="wel__mantra" lang="hi">
              {MANTRA.text}
            </p>
            <p className="wel__latin">{MANTRA.latin}</p>
          </div>
          <div className="wel__actions">
            <p className="wel__status" role="status">
              {status}
            </p>
            <button type="button" className="wel__mute" aria-pressed={muted} onClick={toggleMute} data-tip={muted ? "Turn the mantra’s sound back on. It plays now, and each time this page opens." : "Stop the sound now and keep it off each time this page opens. The picture still shows."}>
              {muted ? "Sound off" : "Sound on"}
            </button>
            <button type="button" className="adm-btn adm-btn--solid wel__enter" ref={enter} onClick={onEnter}>
              {blocked ? "Play the mantra" : "Enter"}
            </button>
          </div>
        </figcaption>
      </figure>
    </div>
  );
}
