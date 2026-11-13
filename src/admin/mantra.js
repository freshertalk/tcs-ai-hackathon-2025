// "ॐ श्री गणेशाय नमः" — played once on the welcome screen.
//
// Two ways to sound it, tried in this order:
//   1. a recording, if one has been put at  public/audio/shri-ganeshay-namah.mp3
//   2. otherwise the browser's own speech, in a Hindi voice when the device has one
//
// Browsers do not let a page make sound until the visitor has touched it. A page that
// has only just been opened has not been touched yet, so the first attempt is often
// refused; the welcome screen then asks for one tap and plays it from that.

export const MANTRA = {
  text: "ॐ श्री गणेशाय नमः",
  latin: "Om Shri Ganeshaya Namah",
  audio: "/audio/shri-ganeshay-namah.mp3",
};

/** The Hindi voice to speak with, or null when the device has none. */
export function pickHindiVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  return list.find((v) => /^hi([-_]|$)/i.test(v.lang || "")) || list.find((v) => /hindi|हिन्दी|हिंदी/i.test(v.name || "")) || null;
}

/** What to say, and how: Devanagari for a Hindi voice, the Latin spelling for any other. */
export function utteranceFor(voices) {
  const hindi = pickHindiVoice(voices);
  return hindi ? { text: MANTRA.text, lang: hindi.lang || "hi-IN", voice: hindi } : { text: MANTRA.latin, lang: "en-IN", voice: null };
}

/**
 * Play the mantra one time.
 * @param onState  called with "playing" | "ended" | "blocked" (needs a tap first) | "silent" (this browser cannot sound it)
 * @returns { retry(), stop() }  retry: call from a click after "blocked"
 */
export function createMantra(onState) {
  let stopped = false;
  let token = 0; // events from an attempt that has been replaced are ignored
  let mode = null; // "audio" | "speech", once known
  let audio = null;
  let timer = null;

  const say = (s) => {
    if (!stopped) onState(s);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function hasRecording() {
    try {
      const r = await fetch(MANTRA.audio, { method: "HEAD", cache: "no-store" });
      return r.ok && /^audio\//i.test(r.headers.get("content-type") || "");
    } catch (_) {
      return false;
    }
  }

  function speak() {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth || typeof window.SpeechSynthesisUtterance === "undefined") return say("silent");
    token += 1;
    const my = token;
    const go = () => {
      if (stopped || my !== token) return;
      const how = utteranceFor(synth.getVoices());
      const u = new window.SpeechSynthesisUtterance(how.text);
      if (how.voice) u.voice = how.voice;
      u.lang = how.lang;
      u.rate = 0.78; // unhurried
      u.pitch = 0.9;
      let heard = false;
      u.onstart = () => {
        heard = true;
        if (my === token) say("playing");
      };
      u.onend = () => {
        clear();
        if (my === token) say("ended");
      };
      u.onerror = (e) => {
        clear();
        if (my !== token) return;
        if (e && (e.error === "canceled" || e.error === "interrupted")) return;
        say(e && e.error === "not-allowed" ? "blocked" : "ended");
      };
      synth.cancel();
      synth.speak(u);
      // some browsers stay silent, with no error, until the page has been touched
      clear();
      timer = setTimeout(() => {
        if (my === token && !heard && !stopped) {
          synth.cancel();
          say("blocked");
        }
      }, 1800);
    };
    // voices arrive a moment after the page does
    if (synth.getVoices().length > 0) go();
    else {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", once);
        go();
      };
      synth.addEventListener("voiceschanged", once);
      setTimeout(once, 700);
    }
  }

  function playRecording() {
    token += 1;
    const my = token;
    audio = new Audio(MANTRA.audio);
    audio.preload = "auto";
    audio.addEventListener("ended", () => my === token && say("ended"));
    // a file that cannot be decoded: speak it instead
    audio.addEventListener("error", () => my === token && speak());
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(() => my === token && say("playing")).catch((err) => {
        if (my !== token) return;
        if (err && err.name === "NotAllowedError") say("blocked");
        else speak();
      });
    }
  }

  const start = () => (mode === "audio" ? playRecording() : speak());

  hasRecording().then((yes) => {
    if (stopped) return;
    mode = yes ? "audio" : "speech";
    start();
  });

  return {
    /** Try again — from a click, which is what the browser was waiting for. */
    retry() {
      if (!stopped && mode) start();
    },
    stop() {
      stopped = true;
      token += 1;
      clear();
      try {
        if (audio) audio.pause();
      } catch (_) {
        /* nothing to stop */
      }
      try {
        if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      } catch (_) {
        /* nothing to stop */
      }
    },
  };
}
