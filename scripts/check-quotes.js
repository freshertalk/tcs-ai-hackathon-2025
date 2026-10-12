#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/check-quotes.js
// ---------------------------------------------------------------------------
// Does the site still quote the book that is actually published?
//
// src/data/books.js holds the lines the site quotes from the novel — the
// opening page, the pull-quotes, the epigraphs, the author's note. They were
// copied word for word from one edition. Replace the EPUB with a revised
// edition and a line may have been reworded or cut; the site would go on
// printing it, attributed to the book, even though the book no longer says
// it. This reads the published chapters back and reports any such line.
//
//   npm run book:check              check the first book in the catalogue
//   npm run book:check -- <slug>    check one book
//
// It runs automatically after `npm run book:publish` publishes a new edition,
// where it only warns. Exit code 1 means "something is stale".
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT = path.join(ROOT, "public", "content");

/* the same inverse of scripts/publish-book.js scramble() that the reader uses */
function unscramble(b64, key) {
  const data = Buffer.from(b64.trim(), "base64");
  const k = Buffer.from(key, "utf8");
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ k[i % k.length] ^ ((i * 31) & 255);
  return out.toString("utf8");
}

/* the AES reading key, for editions published with one (kept in .book-keys.json) */
function decryptGcm(b64, keyHex, aad) {
  const buf = Buffer.from(b64.trim(), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const body = buf.subarray(12, buf.length - 16);
  const d = require("crypto").createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const plain = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? m);

// Punctuation and quote styles vary between a pull-quote and the running
// text; words are what must match.
const norm = (s) =>
  s
    .normalize("NFC")
    .replace(/[“”‘’"'«»]/g, "")
    .replace(/\.\.\./g, "…")
    .replace(/[—–\-…]/g, " ")
    .replace(/[,;:]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([।?!])/g, "$1")
    .trim();

function loadBooksModule() {
  const { transform } = require("sucrase");
  const src = fs.readFileSync(path.join(ROOT, "src", "data", "books.js"), "utf8");
  const { code } = transform(src, { transforms: ["imports"] });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", code)(mod, mod.exports);
  return mod.exports;
}

function main() {
  const catalogPath = path.join(CONTENT, "index.json");
  if (!fs.existsSync(catalogPath)) {
    console.error("No published books (public/content/index.json missing).");
    process.exit(1);
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const slug = process.argv[2] || catalog.books[0].slug;
  const bookDir = path.join(CONTENT, slug);
  const book = JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8"));

  const key = `${book.slug}:${book.version}`;
  const text = norm(
    book.chapters
      .map((c) => {
        const raw = fs.readFileSync(path.join(bookDir, c.file), "utf8");
        if (!book.enc) return plain(unscramble(raw, key));
        let keys = {};
        try {
          keys = JSON.parse(fs.readFileSync(path.join(ROOT, ".book-keys.json"), "utf8"));
        } catch {
          /* handled below */
        }
        const k = keys[book.slug];
        if (!k || k.version !== book.version) {
          console.error("The reading key for this edition is not on this machine (.book-keys.json).");
          process.exit(1);
        }
        return plain(decryptGcm(raw, k.key, `${book.slug}:${book.version}:${c.id}`));
      })
      .join("\n")
  );

  const { BOOK, OPENING, LINES, AUTHOR } = loadBooksModule();

  // Only book-slug sites carry this copy; another book has none of it.
  if (slug !== BOOK.slug) {
    console.log(`"${slug}" is not the flagship book — nothing in books.js quotes it.`);
    return;
  }

  const quoted = [
    ...LINES.map((t) => ["पंक्तियाँ", t]),
    ...OPENING.lines.map((l) => ["पहला पन्ना", l.t]),
    ...BOOK.epigraphs.map((t) => ["epigraph", t]),
    ...BOOK.quotes.map((t) => ["ticker", t]),
    ["marquee", BOOK.marqueeLine],
    ["teaser", BOOK.teaser.question],
    ["logline", BOOK.logline],
    ...BOOK.highlight.lines.map((t) => ["front-page lines", t]),
    ["dedication", BOOK.dedication.body],
    ["epigraph", BOOK.epigraph.text],
    ...AUTHOR.lines.map((t) => ["author note", t]),
    ["motto", AUTHOR.motto],
  ];

  const stale = [];
  for (const [where, q] of quoted) {
    // a quotation can run across paragraphs: check sentence by sentence
    const parts = q
      .split(/\n|।|\?|!/) // a sentence-ending mark is a boundary, not part of the words
      .map(norm)
      .filter((p) => p.length >= 12);
    const missing = parts.filter((p) => !text.includes(p));
    if (missing.length) stale.push({ where, q, missing });
  }

  console.log(`Checked ${quoted.length} quoted passages against "${book.title}" (version ${book.version}).`);
  if (!stale.length) {
    console.log("All of them are still in the book.");
    return;
  }

  console.log(`\n${stale.length} no longer found word for word:\n`);
  for (const s of stale) {
    console.log(`  [${s.where}] ${s.q.replace(/\n/g, " / ").slice(0, 110)}`);
    for (const m of s.missing) console.log(`      not in the book: ${m.slice(0, 80)}`);
  }
  console.log("\nEdit src/data/books.js so the site quotes what the book now says.");
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`check-quotes: ${err.message}`);
  process.exit(1);
}
