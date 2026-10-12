// src/reader/sound.js
// The sound of a page: a short burst of band-passed noise with a quick
// attack and a long soft decay. Synthesised, so there is no audio file to
// ship, and only ever made after the reader has touched the page.

let ctx = null;
let noise = null;

function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function buffer(c) {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.22);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const attack = Math.min(1, t / 0.03);
    // two soft bumps: the leaf lifting, then settling
    const body = Math.pow(1 - t, 2.4) * (0.75 + 0.25 * Math.sin(t * 38));
    d[i] = (Math.random() * 2 - 1) * attack * body;
  }
  noise = b;
  return b;
}

export function pageSound(volume = 0.4) {
  try {
    const c = context();
    if (!c) return;
    if (c.state === "suspended") c.resume();
    const src = c.createBufferSource();
    src.buffer = buffer(c);
    src.playbackRate.value = 0.92 + Math.random() * 0.16;

    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 700;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.value = volume;

    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start();
  } catch {
    /* sound is a nicety — never let it get in the way of a page turn */
  }
}
