"use strict";
// The Mandir: links, uploads in parts into a list of many files (audio and video), the list's order,
// Auto, and that nothing is ever pulled out of YouTube.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Temple, youtubeId, sniff, DEFAULT_VIDEO } = require("../temple");
const { FileDocs } = require("../docs");

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-temple-"));
  const docs = new FileDocs(dir);
  return { dir, docs, temple: new Temple({ docs, dir }) };
};
// a tiny "MP3": an ID3 header and some bytes; a tiny "MP4": an ftyp box
const mp3 = (n = 64) => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(n, 7)]);
const mp4 = (n = 64) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(n, 3)]);
let seq = 0;
const upId = () => (seq++).toString(16).padStart(16, "0");
const upload = (temple, buf, name, type = "") => temple.part({ id: upId(), part: 0, of: 1, name, type, buf }, "owner@example.com");

test("YouTube links of every shape give the video id; other links give nothing", () => {
  assert.equal(youtubeId("https://www.youtube.com/watch?v=AETFvQonfV8&list=RDAETFvQonfV8&start_radio=1"), "AETFvQonfV8");
  assert.equal(youtubeId("https://youtu.be/AETFvQonfV8?t=3"), "AETFvQonfV8");
  assert.equal(youtubeId("https://m.youtube.com/shorts/AETFvQonfV8"), "AETFvQonfV8");
  assert.equal(youtubeId("https://www.youtube.com/embed/AETFvQonfV8"), "AETFvQonfV8");
  assert.equal(youtubeId("https://example.com/watch?v=AETFvQonfV8"), "");
  assert.equal(youtubeId("not a link"), "");
});

test("audio and video are recognised by their first bytes; the browser's type only splits MP4 and WEBM", () => {
  assert.equal(sniff(mp3()), "audio/mpeg");
  assert.equal(sniff(Buffer.from("....ftypM4A ........")), "audio/mp4");
  assert.equal(sniff(Buffer.from("OggS............")), "audio/ogg");
  assert.equal(sniff(mp4(), "video/mp4"), "video/mp4");
  assert.equal(sniff(mp4(), "audio/mp4"), "audio/mp4");
  assert.equal(sniff(Buffer.from("....ftypqt  ........")), "video/quicktime");
  assert.equal(sniff(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....webm........")]), "video/webm"), "video/webm");
  assert.equal(sniff(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....matroska....")])), "video/x-matroska");
  assert.equal(sniff(Buffer.from("<html><body>hello")), "");
});

test("the default is the owner's Chalisa link, barely there (1%), on, with Auto on and an empty list", () => {
  const { temple } = fresh();
  const s = temple.settings();
  assert.equal(s.source.kind, "youtube");
  assert.equal(s.source.videoId, DEFAULT_VIDEO);
  assert.equal(s.volume, 0.01);
  assert.equal(s.autoplay, true);
  assert.equal(s.auto, true);
  assert.deepEqual(s.library, []);
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
  s = temple.set({ volume: 0.3, autoplay: false, auto: false });
  assert.deepEqual([s.volume, s.autoplay, s.auto], [0.3, false, false]);
  s = temple.set({ reset: true });
  assert.equal(s.source.videoId, DEFAULT_VIDEO);
});

test("uploads arrive in parts and are ADDED to the end of the list, one after another; the list becomes the source", () => {
  const { temple, dir } = fresh();
  const id = "0123456789abcdef";
  const whole = mp3(5000);
  assert.deepEqual(temple.part({ id, part: 0, of: 2, name: "Hanuman Chalisa.mp3", buf: whole.subarray(0, 2000) }), { received: 1, of: 2 });
  const done = temple.part({ id, part: 1, of: 2, name: "Hanuman Chalisa.mp3", buf: whole.subarray(2000) }, "owner@example.com");
  assert.equal(done.done, true);
  assert.deepEqual([done.item.label, done.item.kind, done.item.size], ["Hanuman Chalisa", "audio", whole.length]);
  upload(temple, mp4(300), "Sundar Kand.mp4", "video/mp4");
  const s = upload(temple, mp3(100), "Bajrang Baan.mp3").settings;
  assert.equal(s.source.kind, "library");
  assert.deepEqual(s.library.map((x) => [x.label, x.kind]), [["Hanuman Chalisa", "audio"], ["Sundar Kand", "video"], ["Bajrang Baan", "audio"]]);
  assert.equal(s.usedBytes, whole.length + mp4(300).length + mp3(100).length);
  const first = temple.mediaPath(s.library[0].id);
  assert.deepEqual(fs.readFileSync(first.file), whole);
  assert.equal(temple.mediaPath(s.library[1].id).mime, "video/mp4");
  assert.equal(fs.readdirSync(path.join(dir, "media")).filter((f) => f.startsWith("temple-")).length, 3, "every file is kept");
  assert.equal(temple.mediaPath("../../etc/passwd"), null);
});

test("the list can be reordered, renamed and trimmed — a removed file leaves the disk too", () => {
  const { temple } = fresh();
  const a = upload(temple, mp3(10), "a.mp3").item;
  const b = upload(temple, mp3(20), "b.mp3").item;
  const c = upload(temple, mp3(30), "c.mp3").item;
  let s = temple.order([c.id, a.id, b.id]);
  assert.deepEqual(s.library.map((x) => x.label), ["c", "a", "b"]);
  assert.throws(() => temple.order([a.id, b.id]), /every file of the list once/);
  assert.throws(() => temple.order([a.id, a.id, b.id]), /every file of the list once/);
  s = temple.rename(a.id, "  Shri Ram Stuti  ");
  assert.equal(s.library[1].label, "Shri Ram Stuti");
  const fileB = temple.mediaPath(b.id).file;
  s = temple.remove(b.id);
  assert.equal(fs.existsSync(fileB), false);
  assert.deepEqual(s.library.map((x) => x.label), ["c", "Shri Ram Stuti"]);
  temple.remove(a.id);
  s = temple.remove(c.id);
  assert.equal(s.source.kind, "youtube", "an empty list falls back to the default");
  assert.throws(() => temple.remove(c.id), /not in the list/);
});

test("a link or the default leaves the uploaded list in place, and the list can be played again", () => {
  const { temple } = fresh();
  upload(temple, mp3(10), "a.mp3");
  let s = temple.set({ link: "https://youtu.be/AETFvQonfV8" });
  assert.equal(s.source.kind, "youtube");
  assert.equal(s.library.length, 1, "the files stay");
  s = temple.set({ useLibrary: true });
  assert.equal(s.source.kind, "library");
  temple.remove(s.library[0].id);
  assert.throws(() => temple.set({ useLibrary: true }), /Upload a file first/);
});

test("an upload that is not audio or video, or out of order, is refused and leaves nothing behind", () => {
  const { temple } = fresh();
  assert.throws(() => temple.part({ id: "0123456789abcdef", part: 0, of: 1, name: "x.mp3", buf: Buffer.from("<html>not audio at all</html>") }), /not audio or video/);
  assert.throws(() => temple.part({ id: "0123456789abcdef", part: 1, of: 2, name: "x.mp3", buf: mp3() }), /interrupted/);
  assert.throws(() => temple.part({ id: "nope", part: 0, of: 1, buf: mp3() }), /upload id/);
  assert.equal(temple.settings().source.kind, "youtube");
  assert.equal(temple.settings().library.length, 0);
});

test("the single uploaded file of the first version moves into the list once", () => {
  const { temple, docs, dir } = fresh();
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  fs.writeFileSync(path.join(dir, "media", "temple-aaaaaaaaaaaa.mp3"), mp3(50));
  docs.write("temple/settings.json", { source: { kind: "file", fileName: "temple-aaaaaaaaaaaa.mp3", mime: "audio/mpeg", size: 53, label: "Old Chalisa" }, volume: 0.1 });
  const s = temple.settings();
  assert.equal(s.source.kind, "library");
  assert.deepEqual(s.library.map((x) => x.label), ["Old Chalisa"]);
  assert.equal(s.volume, 0.1);
  assert.ok(temple.audioPath().file.endsWith("temple-aaaaaaaaaaaa.mp3"));
});

test("a file missing from the disk drops out of the list; with none left, the default plays", () => {
  const { temple } = fresh();
  const a = upload(temple, mp3(), "a.mp3").item;
  fs.unlinkSync(temple.mediaPath(a.id).file);
  const s = temple.settings();
  assert.equal(s.source.kind, "youtube");
  assert.equal(s.missing, true);
});

test("once: a saved volume at the old default (5%) becomes 1%; a volume the owner chose stays", () => {
  const a = fresh();
  a.docs.write("temple/settings.json", { volume: 0.05 });
  assert.equal(new Temple({ docs: a.docs, dir: a.dir }).settings().volume, 0.01);
  const b = fresh();
  b.docs.write("temple/settings.json", { volume: 0.2 });
  assert.equal(new Temple({ docs: b.docs, dir: b.dir }).settings().volume, 0.2);
  // and after the move, a 5% chosen by hand is kept
  const t = new Temple({ docs: a.docs, dir: a.dir });
  t.set({ volume: 0.05 });
  assert.equal(t.settings().volume, 0.05);
});
