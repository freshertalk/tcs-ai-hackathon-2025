import { createMantra, MANTRA, pickHindiVoice, utteranceFor } from "./mantra";

const voice = (name, lang) => ({ name, lang });

test("a Hindi voice is used when the device has one, whatever it is called", () => {
  const list = [voice("Microsoft David", "en-US"), voice("Microsoft Hemant", "hi-IN"), voice("Google UK English Female", "en-GB")];
  expect(pickHindiVoice(list).name).toBe("Microsoft Hemant");
  expect(pickHindiVoice([voice("Google हिन्दी", "")]).name).toBe("Google हिन्दी");
  expect(pickHindiVoice([voice("Lekha", "hi_IN")]).name).toBe("Lekha");
  expect(pickHindiVoice([voice("Samantha", "en-US")])).toBeNull();
  expect(pickHindiVoice([])).toBeNull();
  expect(pickHindiVoice(undefined)).toBeNull();
});

test("the mantra is spoken in Devanagari by a Hindi voice, and in Latin letters by any other", () => {
  const hi = utteranceFor([voice("Microsoft Hemant", "hi-IN")]);
  expect(hi).toEqual({ text: "ॐ श्री गणेशाय नमः", lang: "hi-IN", voice: voice("Microsoft Hemant", "hi-IN") });
  const other = utteranceFor([voice("Samantha", "en-US")]);
  expect(other).toEqual({ text: "Om Shri Ganeshaya Namah", lang: "en-IN", voice: null });
  expect(MANTRA.audio).toBe("/audio/shri-ganeshay-namah.mp3");
});

describe("playing it once", () => {
  const realFetch = global.fetch;
  let spoken;
  beforeEach(() => {
    jest.useFakeTimers();
    spoken = [];
    global.fetch = jest.fn(async () => ({ ok: true, headers: { get: () => "text/html" } })); // no recording on the server
    window.SpeechSynthesisUtterance = function Utterance(text) {
      this.text = text;
    };
    window.speechSynthesis = {
      getVoices: () => [voice("Microsoft Hemant", "hi-IN")],
      cancel: jest.fn(),
      speak: jest.fn((u) => spoken.push(u)),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
  });
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  test("with no recording it is spoken once, slowly, and the states are reported", async () => {
    const states = [];
    createMantra((s) => states.push(s));
    await settle();
    expect(global.fetch).toHaveBeenCalledWith("/audio/shri-ganeshay-namah.mp3", expect.objectContaining({ method: "HEAD" }));
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("ॐ श्री गणेशाय नमः");
    expect(spoken[0].lang).toBe("hi-IN");
    expect(spoken[0].rate).toBeLessThan(1);
    spoken[0].onstart();
    spoken[0].onend();
    expect(states).toEqual(["playing", "ended"]);
    // nothing plays it a second time by itself
    jest.advanceTimersByTime(10000);
    expect(spoken).toHaveLength(1);
  });

  test("a browser that refuses sound before a tap is reported as blocked, and a tap plays it", async () => {
    const states = [];
    const m = createMantra((s) => states.push(s));
    await settle();
    spoken[0].onerror({ error: "not-allowed" });
    expect(states).toEqual(["blocked"]);
    m.retry();
    expect(spoken).toHaveLength(2);
    spoken[1].onstart();
    spoken[1].onend();
    expect(states).toEqual(["blocked", "playing", "ended"]);
    // the answer of the first, replaced attempt no longer counts
    spoken[0].onend();
    expect(states).toEqual(["blocked", "playing", "ended"]);
  });

  test("silence without an error is also treated as blocked; stopping reports nothing more", async () => {
    const states = [];
    const m = createMantra((s) => states.push(s));
    await settle();
    jest.advanceTimersByTime(2000);
    expect(states).toEqual(["blocked"]);
    m.stop();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    m.retry();
    expect(spoken).toHaveLength(1);
    expect(states).toEqual(["blocked"]);
  });

  test("a browser that cannot speak at all says so", async () => {
    delete window.speechSynthesis;
    const states = [];
    createMantra((s) => states.push(s));
    await settle();
    expect(states).toEqual(["silent"]);
  });
});
