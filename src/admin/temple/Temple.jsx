// The Mandir: Shri Hanuman Chalisa (or any bhajan the owner chooses) playing softly in the
// background while the private area is open — audio only, no video and no floating window.
//
// - An uploaded file or a direct audio link plays from a plain <audio> element on every private
//   page, and carries on while you move between them. The controls are the Mandir card on the
//   dashboard and a small ॐ button in the header of every page.
// - A YouTube video cannot be played as background audio: YouTube's terms require its own video
//   player to be shown, and its audio may not be downloaded or extracted. So a YouTube source is
//   only offered as a link; for background audio, upload the file.
// - Browsers allow sound only after the first tap or key press on a page: until then it waits,
//   and starts on that first touch.
// - Several tabs: the one you are using plays, the others wait (BroadcastChannel); when the
//   playing tab closes, another one carries on.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import "./temple.css";

const VOL_KEY = "vpt.temple.vol";
const CLOSED_KEY = "vpt.temple.closed"; // this visit only (sessionStorage)
const CHANNEL = "vpt-temple";
export const DEFAULT_VOLUME = 0.05; // very soft, in the background

/** Lines of the Shri Hanuman Chalisa (Goswami Tulsidas), shown one at a time. */
export const VERSES = [
  "श्रीगुरु चरन सरोज रज, निज मनु मुकुरु सुधारि। बरनउँ रघुबर बिमल जसु, जो दायकु फल चारि॥",
  "बुद्धिहीन तनु जानिके, सुमिरौं पवन-कुमार। बल बुद्धि बिद्या देहु मोहिं, हरहु कलेस बिकार॥",
  "जय हनुमान ज्ञान गुन सागर। जय कपीस तिहुँ लोक उजागर॥",
  "भूत पिसाच निकट नहिं आवै। महाबीर जब नाम सुनावै॥",
  "नासै रोग हरै सब पीरा। जपत निरंतर हनुमत बीरा॥",
  "संकट कटै मिटै सब पीरा। जो सुमिरै हनुमत बलबीरा॥",
  "पवन तनय संकट हरन, मंगल मूरति रूप। राम लखन सीता सहित, हृदय बसहु सुर भूप॥",
];

const store = {
  get(k, area = "local") {
    try {
      return window[`${area}Storage`].getItem(k);
    } catch (_) {
      return null;
    }
  },
  set(k, v, area = "local") {
    try {
      if (v === null) window[`${area}Storage`].removeItem(k);
      else window[`${area}Storage`].setItem(k, v);
    } catch (_) {
      /* private mode: remembered for this page only */
    }
  },
};

const NOOP = () => {};
const TempleContext = createContext({ ready: false, settings: null, state: "idle", volume: DEFAULT_VOLUME, playable: false, play: NOOP, pause: NOOP, toggle: NOOP, volUp: NOOP, volDown: NOOP, close: NOOP, open: NOOP, reload: NOOP, apply: NOOP });
export const useTemple = () => useContext(TempleContext);

export const pct = (v) => `${Math.round(v * 100)}%`;
const STATE_TEXT = {
  idle: "Getting ready…",
  playing: "Playing softly",
  paused: "Paused",
  blocked: "Tap anywhere on the page to begin — browsers allow sound only after your first tap or key press",
  "other-tab": "Playing in your other tab",
  closed: "Stopped for this visit",
  error: "Could not play",
  youtube: "YouTube cannot play as background audio — upload the audio file to hear it on every page",
};
export const stateText = (s) => STATE_TEXT[s] || s;

/** Volume steps: 1% at the soft end, 5% above 10%. */
const step = (v, dir) => {
  const d = v < 0.1 || (dir < 0 && v <= 0.1) ? 0.01 : 0.05;
  return Math.round(Math.min(1, Math.max(0, v + dir * d)) * 100) / 100;
};

export function TempleProvider({ children }) {
  const { user } = useAuth() || {};
  const [settings, setSettings] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [volume, setVol] = useState(() => {
    const raw = store.get(VOL_KEY);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? v : null; // null = the owner's default
  });
  const [closed, setClosed] = useState(() => store.get(CLOSED_KEY, "session") === "1");
  const audio = useRef(null);
  const userPaused = useRef(false);
  const chan = useRef(null);
  const tab = useRef(Math.random().toString(36).slice(2));
  const stateRef = useRef(state);
  stateRef.current = state;
  const goState = useCallback((x) => {
    stateRef.current = x;
    setState(x);
  }, []);

  const vol = volume === null ? (settings && Number.isFinite(settings.volume) ? settings.volume : DEFAULT_VOLUME) : volume;
  const src = settings && settings.source;
  const kind = src ? src.kind : "";
  const playable = kind === "file" || kind === "url";

  const reload = useCallback(() => {
    if (!user) return Promise.resolve();
    return api("/api/admin/temple")
      .then((s) => setSettings(s && s.source && s.source.kind ? s : null))
      .catch(() => setSettings(null));
  }, [user]);
  useEffect(() => {
    reload();
  }, [reload]);

  /* the audio element, for a file or a link */
  useEffect(() => {
    if (!src) return undefined;
    if (!playable) {
      goState("youtube");
      return undefined;
    }
    const a = new Audio();
    a.loop = true;
    a.preload = "auto";
    a.src = kind === "file" ? `/api/admin/temple/audio?v=${encodeURIComponent(src.uploadedAt || "")}` : src.url;
    const on = () => goState("playing");
    const off = () => {
      if (stateRef.current === "playing") goState("paused");
    };
    const err = () => {
      setError("The audio could not be loaded. Check the link or upload the file again.");
      goState("error");
    };
    a.addEventListener("playing", on);
    a.addEventListener("pause", off);
    a.addEventListener("error", err);
    audio.current = a;
    goState("paused");
    return () => {
      a.pause();
      a.removeEventListener("playing", on);
      a.removeEventListener("pause", off);
      a.removeEventListener("error", err);
      a.src = "";
      audio.current = null;
    };
  }, [src, kind, playable, goState]);

  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, Math.max(0, vol));
  }, [vol, state]);

  const announce = (t) => {
    try {
      if (chan.current) chan.current.postMessage({ t, from: tab.current });
    } catch (_) {
      /* the other tabs simply do not hear it */
    }
  };

  const tryPlay = useCallback(() => {
    const a = audio.current;
    if (!a || closed) return;
    setError("");
    a.volume = Math.min(1, Math.max(0, vol));
    let r;
    try {
      r = a.play();
    } catch (_) {
      r = null;
    }
    if (r && r.catch) {
      r.catch((e) => {
        if (e && e.name === "NotAllowedError") {
          goState("blocked");
          const go = () => {
            document.removeEventListener("pointerdown", go, true);
            document.removeEventListener("keydown", go, true);
            if (!userPaused.current && stateRef.current !== "other-tab") tryPlay();
          };
          document.addEventListener("pointerdown", go, true);
          document.addEventListener("keydown", go, true);
        } else if (e && e.name !== "AbortError") {
          setError("The audio could not be played.");
          goState("error");
        }
      });
    }
  }, [closed, vol, goState]);

  /* start by itself when allowed */
  useEffect(() => {
    if (!settings || closed || !settings.autoplay || userPaused.current || !playable || stateRef.current !== "paused") return;
    tryPlay();
  }, [settings, closed, playable, tryPlay, state]);

  /* tell the other tabs when this one starts playing */
  useEffect(() => {
    if (state === "playing") announce("playing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* one tab plays at a time */
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const c = new BroadcastChannel(CHANNEL);
    chan.current = c;
    c.onmessage = (e) => {
      const m = e.data || {};
      if (m.from === tab.current) return;
      if (m.t === "playing" && (stateRef.current === "playing" || stateRef.current === "blocked")) {
        goState("other-tab");
        if (audio.current) audio.current.pause();
      } else if (m.t === "released" && stateRef.current === "other-tab" && !userPaused.current) {
        tryPlay();
      }
    };
    const bye = () => {
      if (stateRef.current === "playing") announce("released");
    };
    window.addEventListener("pagehide", bye);
    return () => {
      bye();
      window.removeEventListener("pagehide", bye);
      c.close();
      chan.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tryPlay, goState]);

  const play = useCallback(() => {
    userPaused.current = false;
    if (closed) {
      store.set(CLOSED_KEY, null, "session");
      setClosed(false);
    }
    tryPlay();
  }, [closed, tryPlay]);
  const pause = useCallback(() => {
    userPaused.current = true;
    goState("paused");
    if (audio.current) audio.current.pause();
  }, [goState]);
  const toggle = useCallback(() => (stateRef.current === "playing" ? pause() : play()), [pause, play]);
  const setVolume = useCallback((v) => {
    const x = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    setVol(x);
    store.set(VOL_KEY, String(x));
  }, []);
  const volUp = useCallback(() => setVolume(step(vol, 1)), [setVolume, vol]);
  const volDown = useCallback(() => setVolume(step(vol, -1)), [setVolume, vol]);
  const close = useCallback(() => {
    userPaused.current = true;
    goState("closed");
    if (audio.current) audio.current.pause();
    store.set(CLOSED_KEY, "1", "session");
    setClosed(true);
  }, [goState]);
  const open = useCallback(() => {
    store.set(CLOSED_KEY, null, "session");
    setClosed(false);
    userPaused.current = false;
    goState(playable ? "paused" : "youtube");
  }, [goState, playable]);
  /** after the owner changed the source: start afresh */
  const apply = useCallback(
    (s) => {
      if (audio.current) audio.current.pause();
      userPaused.current = false;
      setError("");
      goState("idle");
      if (s) setSettings(s);
      else reload();
    },
    [reload, goState]
  );

  const value = useMemo(
    () => ({ ready: Boolean(settings), settings, state: closed ? "closed" : state, error, volume: vol, playable, play, pause, toggle, volUp, volDown, setVolume, close, open, reload, apply, isOwnVolume: volume !== null }),
    [settings, state, closed, error, vol, playable, play, pause, toggle, volUp, volDown, setVolume, close, open, reload, apply, volume]
  );
  return <TempleContext.Provider value={value}>{children}</TempleContext.Provider>;
}

/** The small ॐ button in the header of every private page: play or pause, nothing more. */
export function TempleButton({ className = "" }) {
  const t = useTemple();
  if (!t || !t.ready) return null;
  const on = t.state === "playing";
  const label = (t.settings && t.settings.source && t.settings.source.label) || "Shri Hanuman Chalisa";
  const tip = t.playable ? `${label} · ${stateText(t.state)} · volume ${pct(t.volume)}. Press to ${on ? "pause" : "play"}; more in the Mandir card on the dashboard.` : "Upload the Chalisa audio in the Mandir card on the dashboard to hear it softly on every page.";
  return (
    <button type="button" className={`tp-btn ${on ? "is-on" : ""} ${className}`} onClick={t.playable ? t.toggle : undefined} aria-pressed={on} aria-label={on ? "Pause the Chalisa" : "Play the Chalisa"} data-tip={tip} disabled={!t.playable}>
      <span aria-hidden="true">ॐ</span>
    </button>
  );
}
