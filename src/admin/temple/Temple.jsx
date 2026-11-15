// The Mandir: Shri Hanuman Chalisa — or the whole list of bhajans the owner uploads — playing softly in
// the background while the private area is open. Sound only: no floating window. A video in the list
// plays as sound too, and shows its picture only inside the Mandir card when asked ("Show video").
//
// - The uploaded files (or a direct audio link) play from one media element on every private page, and
//   carry on while you move between them. The controls are the Mandir card on the dashboard and a small
//   ॐ button in the header of every page.
// - Auto ON: when a file ends, the next one in the list starts, and after the last the list starts again.
//   Auto OFF: the file playing repeats. A file that cannot be played is skipped (with Auto on).
// - The file playing is remembered on this device, so a reload picks up where the list was.
// - A YouTube video cannot be played as background audio: YouTube's terms require its own video player
//   to be shown, and its audio may not be downloaded or extracted. So a YouTube source is only offered
//   as a link; for background audio, upload the file.
// - Browsers allow sound only after the first tap or key press on a page: until then it waits, and
//   starts on that first touch.
// - Several tabs: the one you are using plays, the others wait (BroadcastChannel); when the playing tab
//   closes, another one carries on.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import "./temple.css";

const VOL_KEY = "vpt.temple.vol";
const CUR_KEY = "vpt.temple.cur"; // the file playing, on this device
const AUTO_KEY = "vpt.temple.auto"; // an admin's own Auto choice, on this device (the owner's is saved on the server)
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
const TempleContext = createContext({ ready: false, settings: null, state: "idle", volume: DEFAULT_VOLUME, playable: false, items: [], current: null, index: -1, auto: false, play: NOOP, pause: NOOP, toggle: NOOP, next: NOOP, prev: NOOP, playItem: NOOP, setAuto: NOOP, volUp: NOOP, volDown: NOOP, close: NOOP, open: NOOP, reload: NOOP, apply: NOOP, showVideo: NOOP, hideVideo: NOOP });
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
  const isSuper = Boolean(user && user.role === "superadmin");
  const [settings, setSettings] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [volume, setVol] = useState(() => {
    const raw = store.get(VOL_KEY);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? v : null; // null = the owner's default
  });
  const [ownAuto, setOwnAuto] = useState(() => {
    const raw = store.get(AUTO_KEY);
    return raw === "1" ? true : raw === "0" ? false : null;
  });
  const [curId, setCurId] = useState(() => store.get(CUR_KEY) || "");
  const [closed, setClosed] = useState(() => store.get(CLOSED_KEY, "session") === "1");
  const media = useRef(null);
  const userPaused = useRef(false);
  const keepPlaying = useRef(false); // the next file should start as soon as it is set
  const switching = useRef(false); // a change of file or of place: its "pause" is not the trader's
  const errorsInRow = useRef(0);
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
  // what can play: the uploaded list, or one audio link
  const items = useMemo(() => {
    if (!settings) return [];
    if (kind === "library") return (settings.library || []).map((x) => ({ ...x, key: x.id, url: `/api/admin/temple/media/${encodeURIComponent(x.id)}` }));
    if (kind === "url") return [{ id: "url", key: `url:${src.url}`, label: src.label, kind: "audio", url: src.url }];
    return [];
  }, [settings, kind, src]);
  const playable = items.length > 0;
  const auto = items.length > 1 && (ownAuto !== null && !isSuper ? ownAuto : Boolean(settings && settings.auto));
  const index = Math.max(0, items.findIndex((x) => x.id === curId));
  const current = playable ? items[index] : null;
  const live = useRef({ items, auto, index });
  live.current = { items, auto, index };

  const reload = useCallback(() => {
    if (!user) return Promise.resolve();
    return api("/api/admin/temple")
      .then((s) => setSettings(s && s.source && s.source.kind ? s : null))
      .catch(() => setSettings(null));
  }, [user]);
  useEffect(() => {
    reload();
  }, [reload]);

  // the file playing is remembered on this device; one that left the list gives way to the first
  useEffect(() => {
    if (!playable) return;
    if (!items.some((x) => x.id === curId)) setCurId(items[0].id);
  }, [items, playable, curId]);
  useEffect(() => {
    if (curId) store.set(CUR_KEY, curId);
  }, [curId]);

  const tryPlay = useCallback(() => {
    const a = media.current;
    if (!a || closed || !a.getAttribute("src")) return;
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
  const tryPlayRef = useRef(tryPlay);
  tryPlayRef.current = tryPlay;

  /* the one media element (it plays audio and video files alike), made once */
  useEffect(() => {
    const el = document.createElement("video");
    el.preload = "auto";
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.className = "mdr-video__el";
    const on = () => {
      errorsInRow.current = 0;
      goState("playing");
    };
    const off = () => {
      if (switching.current || el.ended) return; // a change of file, or the end of one (Auto handles it)
      // taken off the page with the Mandir card (its picture was showing): carry on, as sound
      if (!el.isConnected && stateRef.current === "playing" && !userPaused.current) {
        const r = el.play();
        if (r && r.catch) r.catch(() => {});
        return;
      }
      if (stateRef.current === "playing") goState("paused");
    };
    const toNext = () => {
      const { items: list, index: i } = live.current;
      keepPlaying.current = true;
      setCurId(list[(i + 1) % list.length].id);
    };
    // Auto: when one file ends, the next begins (after the last, the first)
    const end = () => {
      const { items: list, auto: on2 } = live.current;
      if (on2 && list.length > 1) toNext();
    };
    const err = () => {
      const { items: list, auto: on2 } = live.current;
      // with Auto on, a file that cannot be played is skipped — until every one has failed in a row
      if (on2 && list.length > 1 && errorsInRow.current < list.length - 1) {
        errorsInRow.current += 1;
        toNext();
        return;
      }
      setError("The file could not be loaded. Check it, or upload it again.");
      goState("error");
    };
    el.addEventListener("playing", on);
    el.addEventListener("pause", off);
    el.addEventListener("ended", end);
    el.addEventListener("error", err);
    media.current = el;
    return () => {
      el.pause();
      el.removeEventListener("playing", on);
      el.removeEventListener("pause", off);
      el.removeEventListener("ended", end);
      el.removeEventListener("error", err);
      el.removeAttribute("src");
      if (el.parentNode) el.parentNode.removeChild(el);
      media.current = null;
    };
  }, [goState]);

  /* the file to play: set it when it changes, and carry on playing when the last one was */
  const curKey = current ? current.key : "";
  useEffect(() => {
    const el = media.current;
    if (!el) return;
    if (!src) return;
    if (!current) {
      el.pause();
      el.removeAttribute("src");
      el.removeAttribute("data-key");
      goState(kind === "youtube" ? "youtube" : "idle");
      return;
    }
    if (el.getAttribute("data-key") === current.key) return;
    const resume = keepPlaying.current || stateRef.current === "playing";
    keepPlaying.current = false;
    switching.current = true;
    el.src = current.url;
    el.setAttribute("data-key", current.key);
    switching.current = false;
    if (resume && !userPaused.current) tryPlayRef.current();
    else if (stateRef.current !== "blocked" && stateRef.current !== "other-tab") goState("paused");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey, src, kind, goState]);

  /* Auto off (or a single file): the file playing repeats */
  useEffect(() => {
    if (media.current) media.current.loop = !auto;
  }, [auto, curKey]);

  useEffect(() => {
    if (media.current) media.current.volume = Math.min(1, Math.max(0, vol));
  }, [vol, state]);

  const announce = (t) => {
    try {
      if (chan.current) chan.current.postMessage({ t, from: tab.current });
    } catch (_) {
      /* the other tabs simply do not hear it */
    }
  };

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
        if (media.current) media.current.pause();
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
    if (media.current) media.current.pause();
  }, [goState]);
  const toggle = useCallback(() => (stateRef.current === "playing" ? pause() : play()), [pause, play]);
  /** Start a file of the list now (from its row in the card). */
  const playItem = useCallback(
    (id) => {
      userPaused.current = false;
      if (closed) {
        store.set(CLOSED_KEY, null, "session");
        setClosed(false);
      }
      if (id === curId && media.current && media.current.getAttribute("src")) {
        media.current.currentTime = 0;
        tryPlay();
        return;
      }
      keepPlaying.current = true;
      setCurId(id);
    },
    [closed, curId, tryPlay]
  );
  const skip = useCallback(
    (dir) => {
      const list = live.current.items;
      if (list.length < 2) return;
      const i = live.current.index;
      keepPlaying.current = stateRef.current === "playing" || stateRef.current === "blocked";
      setCurId(list[(i + dir + list.length) % list.length].id);
    },
    []
  );
  const next = useCallback(() => skip(1), [skip]);
  const prev = useCallback(() => skip(-1), [skip]);
  /** Auto ON/OFF: the owner's choice is saved for every device; an admin's stays on their own device. */
  const setAuto = useCallback(
    async (on) => {
      if (!isSuper) {
        setOwnAuto(on);
        store.set(AUTO_KEY, on ? "1" : "0");
        return;
      }
      setSettings((s) => (s ? { ...s, auto: on } : s));
      try {
        const s = await api("/api/admin/temple", { method: "PUT", body: { auto: on } });
        if (s && s.source) setSettings(s);
      } catch (e) {
        setError(e.message);
        reload();
      }
    },
    [isSuper, reload]
  );
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
    if (media.current) media.current.pause();
    store.set(CLOSED_KEY, "1", "session");
    setClosed(true);
  }, [goState]);
  const open = useCallback(() => {
    store.set(CLOSED_KEY, null, "session");
    setClosed(false);
    userPaused.current = false;
    goState(playable ? "paused" : "youtube");
  }, [goState, playable]);
  /** after the owner changed the source or the list: carry on with the new one */
  const apply = useCallback(
    (s) => {
      setError("");
      if (s) setSettings(s);
      else reload();
    },
    [reload]
  );

  /**
   * The picture of a video, inside the Mandir card: the same element moves into the card's box and back
   * out (out of the page it keeps playing as sound). A move can pause it, so it is started again.
   */
  const place = useCallback(
    (box) => {
      const el = media.current;
      if (!el) return;
      const was = stateRef.current === "playing";
      switching.current = true;
      if (box) box.appendChild(el);
      else if (el.parentNode) el.parentNode.removeChild(el);
      switching.current = false;
      if (was && el.paused) tryPlay();
    },
    [tryPlay]
  );
  const showVideo = useCallback((box) => place(box), [place]);
  const hideVideo = useCallback(() => place(null), [place]);

  const value = useMemo(
    () => ({ ready: Boolean(settings), settings, state: closed ? "closed" : state, error, volume: vol, playable, items, current, index, auto, play, pause, toggle, next, prev, playItem, setAuto, volUp, volDown, setVolume, close, open, reload, apply, showVideo, hideVideo, isOwnVolume: volume !== null, isOwnAuto: ownAuto !== null && !isSuper }),
    [settings, state, closed, error, vol, playable, items, current, index, auto, play, pause, toggle, next, prev, playItem, setAuto, volUp, volDown, setVolume, close, open, reload, apply, showVideo, hideVideo, volume, ownAuto, isSuper]
  );
  return <TempleContext.Provider value={value}>{children}</TempleContext.Provider>;
}

/** The small ॐ button in the header of every private page: play or pause, nothing more. */
export function TempleButton({ className = "" }) {
  const t = useTemple();
  if (!t || !t.ready) return null;
  const on = t.state === "playing";
  const label = (t.current && t.current.label) || (t.settings && t.settings.source && t.settings.source.label) || "Shri Hanuman Chalisa";
  const count = t.items.length > 1 ? ` (${t.index + 1} of ${t.items.length}${t.auto ? ", Auto" : ""})` : "";
  const tip = t.playable ? `${label}${count} · ${stateText(t.state)} · volume ${pct(t.volume)}. Press to ${on ? "pause" : "play"}; more in the Mandir card on the dashboard.` : "Upload the Chalisa audio in the Mandir card on the dashboard to hear it softly on every page.";
  return (
    <button type="button" className={`tp-btn ${on ? "is-on" : ""} ${className}`} onClick={t.playable ? t.toggle : undefined} aria-pressed={on} aria-label={on ? "Pause the Mandir audio" : "Play the Mandir audio"} data-tip={tip} disabled={!t.playable}>
      <span aria-hidden="true">ॐ</span>
    </button>
  );
}
