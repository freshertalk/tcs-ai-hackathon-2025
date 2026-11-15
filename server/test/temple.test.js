"use strict";
// The Mandir audio settings: links, uploads in parts, and that nothing is ever pulled out of YouTube.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Temple, youtubeId, sniff, DEFAULT_VIDEO } = require("../temple");
const { FileDocs } = require("../docs");

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-temple-"));
  return { dir, temple: new Temple({ docs: new FileDocs(dir), dir }) };
};
// a tiny "MP3": an ID3 header and some bytes
const mp3 = (n = 64) => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(n, 7)]);

test("YouTube links of every shape give the video id; other links give nothing", () => {
  assert.equal(youtubeId("https://www.youtube.com/watch?v=AETFvQonfV8&list=RDAETFvQonfV8&start_radio=1"), "AETFvQonfV8");
  assert.equal(youtubeId("https://youtu.be/AETFvQonfV8?t=3"), "AETFvQonfV8");
  assert.equal(youtubeId("https://m.youtube.com/shorts/AETFvQonfV8"), "AETFvQonfV8");
  assert.equal(youtubeId("https://www.youtube.com/embed/AETFvQonfV8"), "AETFvQonfV8");
  assert.equal(youtubeId("https://example.com/watch?v=AETFvQonfV8"), "");
  assert.equal(youtubeId("not a link"), "");
});

test("audio is recognised by its first bytes", () => {
  assert.equal(sniff(mp3()), "audio/mpeg");
  assert.equal(sniff(Buffer.from("....ftypM4A ........")), "audio/mp4");
  assert.equal(sniff(Buffer.from("OggS............")), "audio/ogg");
  assert.equal(sniff(Buffer.from("<html><body>hello")), "");
});

test("the default is the owner's Chalisa link, very soft (5%) and on", () => {
  const { temple } = fresh();
  const s = temple.settings();
  assert.equal(s.source.kind, "youtube");
  assert.equal(s.source.videoId, DEFAULT_VIDEO);
  assert.equal(s.volume, 0.05);
  assert.equal(s.autoplay, true);
});

test("a link becomes a YouTube source or an audio-link source; bad links and volumes are refused", () => {
  const { temple } = fresh();
  let s = temple.set({ link: "https://youtu.be/AETFvQonfV8", label: "Chalisa" }, "owner@example.com");
  assert.deepEqual([s.source.kind, s.source.videoId, s.source.label], ["youtube", "AETFvQonfV8", "Chalisa"]);
  s = temple.set({ link: "https://cdn.example.com/bhajan/chalisa.mp3" });
  assert.deepEqual([s.source.kind, s.source.label], ["url", "chalisa.mp3"]);
  assert.throws(() => temple.set({ link: "http://cdn.example.com/a.mp3" }), /https/);
  assert.throws(() => temple.set({ link: "nothing" }), /YouTube link or a direct https link/);
  assert.throws(() => temple.set({ volume: 2 }), /0 to 1/);
  s = temple.set({ volume: 0.3, autoplay: false });
  assert.deepEqual([s.volume, s.autoplay], [0.3, false]);
  s = temple.set({ reset: true });
  assert.equal(s.source.videoId, DEFAULT_VIDEO);
});

test("an upload arrives in parts, is checked, becomes the source, and replaces the old file", () => {
  const { temple, dir } = fresh();
  const id = "0123456789abcdef";
  const whole = mp3(5000);
  const a = whole.subarray(0, 2000);
  const b = whole.subarray(2000);
  assert.deepEqual(temple.part({ id, part: 0, of: 2, name: "Hanuman Chalisa.mp3", buf: a }), { received: 1, of: 2 });
  const done = temple.part({ id, part: 1, of: 2, name: "Hanuman Chalisa.mp3", buf: b }, "owner@example.com");
  assert.equal(done.done, true);
  const s = done.settings;
  assert.deepEqual([s.source.kind, s.source.mime, s.source.size, s.source.label], ["file", "audio/mpeg", whole.length, "Hanuman Chalisa"]);
  const p = temple.audioPath();
  assert.ok(fs.existsSync(p.file));
  assert.deepEqual(fs.readFileSync(p.file), whole);
  // a second upload replaces the first file
  temple.part({ id: "fedcba9876543210", part: 0, of: 1, name: "b.mp3", buf: mp3(100) });
  assert.equal(fs.existsSync(p.file), false, "the old file is removed");
  assert.equal(fs.readdirSync(path.join(dir, "media")).filter((f) => f.startsWith("temple-")).length, 1);
});

test("an upload that is not audio, or out of order, is refused and leaves nothing behind", () => {
  const { temple } = fresh();
  assert.throws(() => temple.part({ id: "0123456789abcdef", part: 0, of: 1, name: "x.mp3", buf: Buffer.from("<html>not audio at all</html>") }), /not audio/);
  assert.throws(() => temple.part({ id: "0123456789abcdef", part: 1, of: 2, name: "x.mp3", buf: mp3() }), /interrupted/);
  assert.throws(() => temple.part({ id: "nope", part: 0, of: 1, buf: mp3() }), /upload id/);
  assert.equal(temple.settings().source.kind, "youtube");
});

test("a missing uploaded file falls back to the default instead of breaking the page", () => {
  const { temple } = fresh();
  temple.part({ id: "0123456789abcdef", part: 0, of: 1, name: "a.mp3", buf: mp3() });
  fs.unlinkSync(temple.audioPath().file);
  const s = temple.settings();
  assert.equal(s.source.kind, "youtube");
  assert.equal(s.missing, true);
});
