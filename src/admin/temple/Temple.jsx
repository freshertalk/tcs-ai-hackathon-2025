// The Mandir: Shri Hanuman Chalisa (or any bhajan the owner chooses) playing softly while the
// private area is open, on every page, with play / pause / volume / close.
//
// - An uploaded file or a direct audio link plays from a plain <audio> element, in the background,
//   on every private page (and continues while you move between them).
// - A YouTube link plays through YouTube's own embedded player, which must stay visible while it
//   plays (YouTube's terms); its audio is never downloaded or extracted.
// - Browsers allow sound only after the first tap or key press on a page: until then the player
//   says so and starts on that first touch.
// - Several tabs: the one you are using plays, the others wait (BroadcastChannel); when the
//   playing tab closes, another one carries on.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import "./temple.css";

const VOL_KEY = "vpt.temple.vol";
const CLOSED_KEY = "vpt.temple.closed"; // this visit only (sessionStorage)
const MINI_KEY = "vpt.temple.mini";
const CHANNEL = "vpt-temple";

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
const TempleContext = createContext({ ready: false, settings: null, state: "idle", volume: 0.15, play: NOOP, pause: NOOP, toggle: NOOP, volUp: NOOP, volDown: NOOP, close: NOOP, open: NOOP, reload: NOOP, apply: NOOP });
export const useTemple = () => useContext(TempleContext);

/* ------------------------------------------------------------------ YouTube's own player */
let ytApi = null;
function loadYouTube() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      ytApi = null;
      reject(new Error("YouTube's player could not be loaded."));
    };
    document.head.appendChild(s);
  });
  return ytApi;
}

export const pct = (v) => `${Math.round(v * 100)}%`;
const STATE_TEXT = {
  idle: "Getting ready…",
  playing: "Playing softly",
  paused: "Paused",
  blocked: "Tap anywhere to begin — browsers allow sound only after your first tap or key press",
  "other-tab": "Playing in your other tab",
  closed: "Closed for this visit",
  error: "Could not play",
  hidden: "Paused while the player is folded (YouTube plays only while its player is visible)",
};
export const stateText = (s) => STATE_TEXT[s] || s;

export function TempleProvider({ children }) {
  const { user } = useAuth() || {};
  const [settings, setSettings] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [volume, setVol] = useState(() => {
    const v = Number(store.get(VOL_KEY));
    return Number.isFinite(v) && store.get(VOL_KEY) !== null ? v : null; // null = the owner's default
  });
  const [closed, setClosed] = useState(() => store.get(CLOSED_KEY, "session") === "1");
  const [mini, setMini] = useState(() => store.get(MINI_KEY) === "1");
  const audio = useRef(null);
  const yt = useRef(null);
  const ytBox = useRef(null);
  const userPaused = useRef(false);
  const chan = useRef(null);
  const tab = useRef(Math.random().toString(36).slice(2));
  const stateRef = useRef(state);
  stateRef.current = state;
  const goState = useCallback((x) => {
    stateRef.current = x;
    setState(x);
  }, []);
  const autoStart = useRef(NOOP);

  const vol = volume === null ? (settings ? settings.volume : 0.15) : volume;
  const src = settings && settings.source;
  const kind = src ? src.kind : "";

  const reload = useCallback(() => {
    if (!user) return Promise.resolve();
    return api("/api/admin/temple")
      .then((s) => setSettings(s && s.source && s.source.kind ? s : null))
      .catch(() => setSettings(null));
  }, [user]);
  useEffect(() => {
    reload();
  }, [reload]);

  /* the audio element for a file or a link */
  useEffect(() => {
    if (!src || (kind !== "file" && kind !== "url")) return undefined;
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
    return () => {
      a.pause();
      a.removeEventListener("playing", on);
      a.removeEventListener("pause", off);
      a.removeEventListener("error", err);
      a.src = "";
      audio.current = null;
    };
  }, [src, kind, goState]);

  /* YouTube's player, inside the visible mini player */
  const videoId = kind === "youtube" ? src.videoId : "";
  useEffect(() => {
    if (!videoId || closed || mini || !ytBox.current) return undefined;
    let alive = true;
    let player = null;
    loadYouTube()
      .then((YT) => {
        if (!alive || !ytBox.current) return;
        const el = document.createElement("div");
        ytBox.current.innerHTML = "";
        ytBox.current.appendChild(el);
        player = new YT.Player(el, {
          videoId,
          width: "100%",
          height: "100%",
          // the page's own origin lets YouTube's player accept play / pause / volume from this page
          playerVars: { autoplay: 0, controls: 1, loop: 1, playlist: videoId, rel: 0, playsinline: 1, modestbranding: 1, enablejsapi: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              if (!alive) return;
              yt.current = player;
              player.setVolume(Math.round(vol * 100));
              goState("paused");
              autoStart.current();
            },
            onStateChange: (e) => {
              if (e.data === 1) goState("playing");
              else if ((e.data === 2 || e.data === 0) && stateRef.current === "playing") goState("paused");
            },
            onError: (e) => {
              setError(e.data === 101 || e.data === 150 ? "The owner of this YouTube video does not allow it to be played on other sites. Upload the audio file instead." : "YouTube could not play this video.");
              goState("error");
            },
          },
        });
      })
      .catch((e) => {
        setError(e.message);
        goState("error");
      });
    return () => {
      alive = false;
      yt.current = null;
      try {
        if (player && player.destroy) player.destroy();
      } catch (_) {
        /* already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, closed, mini]);

  /* volume follows the setting at once */
  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, Math.max(0, vol));
    if (yt.current && yt.current.setVolume) yt.current.setVolume(Math.round(vol * 100));
  }, [vol]);

  const announce = (t) => {
    try {
      if (chan.current) chan.current.postMessage({ t, from: tab.current });
    } catch (_) {
      /* the other tabs simply do not hear it */
    }
  };

  const tryPlay = useCallback(() => {
    if (!settings || closed) return;
    setError("");
    const wait = () => {
      goState("blocked");
      const go = () => {
        document.removeEventListener("pointerdown", go, true);
        document.removeEventListener("keydown", go, true);
        if (!userPaused.current) tryPlay();
      };
      document.addEventListener("pointerdown", go, true);
      document.addEventListener("keydown", go, true);
    };
    if (kind === "youtube") {
      if (mini) {
        goState("hidden");
        return;
      }
      const p = yt.current;
      if (!p || !p.playVideo) return; // it starts once the player is ready
      p.playVideo();
      // a blocked autoplay simply never starts: wait for a tap
      setTimeout(() => {
        if (stateRef.current !== "playing" && !userPaused.current) wait();
      }, 1500);
      return;
    }
    const a = audio.current;
    if (!a) return;
    let r;
    try {
      r = a.play();
    } catch (_) {
      r = null;
    }
    if (r && r.then) {
      r.catch((e) => {
        if (e && e.name === "NotAllowedError") wait();
        else if (e && e.name !== "AbortError") {
          setError("The audio could not be played.");
          goState("error");
        }
      });
    }
  }, [settings, closed, kind, mini, goState]);

  /* start by itself when allowed (a YouTube player calls this when it is ready) */
  autoStart.current = () => {
    if (settings && settings.autoplay && !closed && !userPaused.current) tryPlay();
  };
  useEffect(() => {
    if (!settings || closed || !settings.autoplay || userPaused.current) return;
    if (kind === "youtube") {
      if (mini) goState("hidden");
      else if (yt.current) tryPlay();
      return;
    }
    tryPlay();
  }, [settings, closed, kind, mini, tryPlay, goState]);

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
        if (yt.current && yt.current.pauseVideo) yt.current.pauseVideo();
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
  }, [tryPlay]);

  const pauseNow = () => {
    if (audio.current) audio.current.pause();
    if (yt.current && yt.current.pauseVideo) yt.current.pauseVideo();
  };
  const play = useCallback(() => {
    userPaused.current = false;
    if (closed) {
      store.set(CLOSED_KEY, null, "session");
      setClosed(false);
    }
    if (kind === "youtube" && mini) {
      store.set(MINI_KEY, null);
      setMini(false);
      return; // it starts when the player is ready
    }
    tryPlay();
  }, [closed, kind, mini, tryPlay]);
  const pause = useCallback(() => {
    userPaused.current = true;
    goState("paused");
    pauseNow();
  }, [goState]);
  const toggle = useCallback(() => (stateRef.current === "playing" ? pause() : play()), [pause, play]);
  const setVolume = useCallback((v) => {
    const x = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    setVol(x);
    store.set(VOL_KEY, String(x));
  }, []);
  const volUp = useCallback(() => setVolume(vol + 0.05), [setVolume, vol]);
  const volDown = useCallback(() => setVolume(vol - 0.05), [setVolume, vol]);
  const close = useCallback(() => {
    userPaused.current = true;
    goState("closed");
    pauseNow();
    store.set(CLOSED_KEY, "1", "session");
    setClosed(true);
  }, [goState]);
  const open = useCallback(() => {
    store.set(CLOSED_KEY, null, "session");
    setClosed(false);
    userPaused.current = false;
    goState("idle");
  }, [goState]);
  const fold = useCallback(
    (on) => {
      setMini(on);
      store.set(MINI_KEY, on ? "1" : null);
      if (on && kind === "youtube") {
        goState("hidden");
        pauseNow();
      }
    },
    [kind, goState]
  );
  /** after the owner changed the source: read the settings again and start afresh */
  const apply = useCallback(
    (s) => {
      pauseNow();
      userPaused.current = false;
      setError("");
      goState("idle");
      if (s) setSettings(s);
      else reload();
    },
    [reload, goState]
  );

  const value = useMemo(
    () => ({ ready: Boolean(settings), settings, state: closed ? "closed" : state, error, volume: vol, play, pause, toggle, volUp, volDown, setVolume, close, open, reload, apply, mini, fold, isOwnVolume: volume !== null }),
    [settings, state, closed, error, vol, play, pause, toggle, volUp, volDown, setVolume, close, open, reload, apply, mini, fold, volume]
  );

  return (
    <TempleContext.Provider value={value}>
      {children}
      {user && settings && !closed && <MiniPlayer t={value} ytBox={ytBox} kind={kind} />}
    </TempleContext.Provider>
  );
}

/* ------------------------------------------------------------------ the floating player */
function useVerse(every = 30000) {
  const [i, setI] = useState(() => Math.floor(Date.now() / every) % VERSES.length);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % VERSES.length), every);
    return () => clearInterval(id);
  }, [every]);
  return VERSES[i];
}

function MiniPlayer({ t, ytBox, kind }) {
  const verse = useVerse();
  const playing = t.state === "playing";
  const label = (t.settings.source && t.settings.source.label) || "Shri Hanuman Chalisa";
  if (t.mini) {
    return (
      <button type="button" className={`tp-chip ${playing ? "is-on" : ""}`} onClick={() => t.fold(false)} aria-label={`Mandir: ${label}. ${stateText(t.state)}. Open the player.`} data-tip={`${label} · ${stateText(t.state)}`}>
        <img src="/img/hanuman-icon-96.png" alt="" width="40" height="40" />
      </button>
    );
  }
  return (
    <aside className={`tp ${playing ? "is-on" : ""}`} aria-label="Mandir player">
      <header className="tp__head">
        <img src="/img/hanuman-icon-96.png" alt="" width="28" height="28" />
        <span className="tp__title">
          <b>{label}</b>
          <small>{stateText(t.state)}</small>
        </span>
        <button type="button" className="tp__x" onClick={() => t.fold(true)} aria-label="Fold the player" data-tip={kind === "youtube" ? "Fold the player. A YouTube video pauses while it is folded." : "Fold the player; the audio carries on."}>
          ▾
        </button>
        <button type="button" className="tp__x" onClick={t.close} aria-label="Close the player" data-tip="Stop and close it for this visit. Open it again from the Mandir card on the dashboard.">
          ✕
        </button>
      </header>
      {kind === "youtube" && <div className="tp__yt" ref={ytBox} />}
      <p className="tp__verse" lang="hi">
        {verse}
      </p>
      {t.error && <p className="tp__err">{t.error}</p>}
      <div className="tp__ctl">
        <button type="button" className="tp__play" onClick={t.toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={t.volDown} aria-label="Volume down" disabled={t.volume <= 0}>
          −
        </button>
        <span className="tp__vol" aria-live="polite">
          {pct(t.volume)}
        </span>
        <button type="button" onClick={t.volUp} aria-label="Volume up" disabled={t.volume >= 1}>
          +
        </button>
      </div>
    </aside>
  );
}
