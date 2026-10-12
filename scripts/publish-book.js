#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/publish-book.js
// ---------------------------------------------------------------------------
// The publishing pipeline: one EPUB in, a book on the shelf out.
//
//   npm run book:publish                    publish what is in public/ebooks/
//   npm run book:publish -- --force         publish again even if unchanged
//   npm run book:publish -- path/to/book.epub --slug my-book
//
// Drop an .epub into public/ebooks/. Its URL name and publication date go in
// public/ebooks/books.json, keyed by file name:
//
//   { "दो कुल्हड़ चाय.epub": { "slug": "do-kulhad-chai", "published": "2026-10-16" } }
//
// REPLACING A BOOK: overwrite the file, keeping its name. Next `npm start` or
// `npm run build` notices the new bytes (a hash is stored in book.json) and
// republishes; `npm start` also watches the folder and does it as you save.
// Readers who already have the site open are told a new edition is available.
//
// public/ebooks/ is a drop box, not a web location: the build removes it from
// /build, and this script never publishes the EPUB itself. Nothing on the
// site offers the book as a file.
//
// What it writes (all static, so any host can serve it):
//
//   public/content/index.json                  the catalogue (every book)
//   public/content/<slug>/book.json            metadata, contents, version
//   public/content/<slug>/chapters/<id>.dat    one scrambled fragment per section
//   public/content/<slug>/assets/…             images referenced by the text
//   public/content/<slug>/cover.<ext>          the cover
//   public/content/<slug>/art/…                the supplied cover pictures, as given
//                                              (from public/ebooks/coverimages — see prepareArt)
//
// The reader fetches one chapter at a time, so the first page is small no
// matter how long the book is. The EPUB is unzipped with Node's own zlib —
// no dependencies, nothing to install.
//
// Scope: reflowable EPUB 2 / EPUB 3 with XHTML content. Fixed-layout and
// DRM-protected books are not supported (the script says so and stops).
//
// Options
//   --slug <name>        URL name for the book (single file only)
//   --published <date>   publication date, 2026-10-16
//   --force              republish even when the file has not changed
//   --soft               exit quietly when there is no EPUB (used by builds)
//   --out <dir>          content root (default: public/content)
//   --base <url>         public URL of the content root (default: /content)
// ---------------------------------------------------------------------------

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");

/* Silent-reading speed, words per minute. Devanagari reads slower than Latin
   script on a screen; these are deliberately conservative so that "12 min"
   is a promise the reader can keep. */
const WPM = { hi: 150, en: 220, default: 180 };

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

/* ------------------------------------------------------------ zip reader */
// A ZIP is a list of entries followed by a "central directory" that indexes
// them. Read the index from the end of the file, then inflate on demand.
function openZip(buf) {
  const SIG_EOCD = 0x06054b50;
  const SIG_CEN = 0x02014b50;

  let eocd = -1;
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a ZIP/EPUB file.");

  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== SIG_CEN) throw new Error("Corrupt ZIP directory.");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen); // EPUB: always UTF-8
    entries.set(name, { method, csize, local });
    off += 46 + nameLen + extraLen + commentLen;
  }

  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`Missing from EPUB: ${name}`);
      const nameLen = buf.readUInt16LE(e.local + 26);
      const extraLen = buf.readUInt16LE(e.local + 28);
      const start = e.local + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`Unsupported ZIP compression (${e.method}) for ${name}`);
    },
  };
}

/* --------------------------------------------------------- xml, lightly */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s) => s.replace(/<[^>]*>/g, "");
const clean = (s) => decode(stripTags(s)).replace(/\s+/g, " ").trim();

function attrs(tag) {
  const out = {};
  tag.replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (m, k, _v, dq, sq) => {
    out[k] = decode(dq ?? sq ?? "");
    return m;
  });
  return out;
}

function all(re, s) {
  return [...s.matchAll(re)];
}

function firstText(xml, tagName) {
  const m = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return m ? clean(m[1]) : "";
}

const posix = path.posix;
const dirOf = (p) => posix.dirname(p) === "." ? "" : posix.dirname(p);
const resolveRef = (fromFile, ref) => posix.normalize(posix.join(dirOf(fromFile), decodeURI(ref)));

/* ------------------------------------------------------------ epub parse */
function parsePackage(zip) {
  if (zip.has("META-INF/encryption.xml")) {
    const enc = zip.read("META-INF/encryption.xml").toString("utf8");
    const algos = all(/Algorithm="([^"]+)"/g, enc).map((m) => m[1]);
    const nonFont = algos.filter((a) => !/obfuscation/i.test(a));
    if (nonFont.length) {
      throw new Error("This EPUB is DRM-protected and cannot be published.");
    }
  }

  const container = zip.read("META-INF/container.xml").toString("utf8");
  const opfPath = (container.match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error("container.xml does not point to a package file.");
  const opf = zip.read(opfPath).toString("utf8");

  const meta = (name) => {
    const m = opf.match(new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, "i"));
    return m ? clean(m[1]) : "";
  };
  const metas = (name) =>
    all(new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, "gi"), opf).map((m) =>
      clean(m[1])
    );

  const manifest = new Map();
  for (const m of all(/<item\b([^>]*?)\/?>/gi, opf)) {
    const a = attrs(m[1]);
    if (a.id && a.href) {
      manifest.set(a.id, {
        id: a.id,
        href: resolveRef(opfPath, a.href),
        type: a["media-type"] || "",
        props: (a.properties || "").split(/\s+/).filter(Boolean),
      });
    }
  }

  const spine = all(/<itemref\b([^>]*?)\/?>/gi, opf)
    .map((m) => attrs(m[1]))
    .filter((a) => a.idref && a.linear !== "no")
    .map((a) => manifest.get(a.idref))
    .filter(Boolean);

  // cover: EPUB 3 property first, then the EPUB 2 <meta name="cover">
  let cover = [...manifest.values()].find((i) => i.props.includes("cover-image"));
  if (!cover) {
    const m = opf.match(/<meta\b[^>]*name="cover"[^>]*content="([^"]+)"/i);
    if (m) cover = manifest.get(m[1]);
  }

  const modified = (opf.match(/<meta\b[^>]*property="dcterms:modified"[^>]*>([^<]+)</i) || [])[1];

  if (/rendition:layout[^<]*<?[^>]*>\s*pre-paginated/i.test(opf)) {
    throw new Error("Fixed-layout EPUBs are not supported — publish a reflowable edition.");
  }

  return {
    opfPath,
    manifest,
    spine,
    cover,
    modified: modified ? modified.trim() : "",
    title: meta("title"),
    creators: metas("creator"),
    language: (meta("language") || "en").toLowerCase(),
    publisher: meta("publisher"),
    date: meta("date"),
    rights: meta("rights"),
    description: meta("description"),
    subjects: metas("subject"),
    identifier: meta("identifier"),
    navItem: [...manifest.values()].find((i) => i.props.includes("nav")),
    ncxItem: [...manifest.values()].find((i) => i.type === "application/x-dtbncx+xml"),
  };
}

/** href (zip path, no fragment) → { label, num } from the EPUB 3 nav or the NCX. */
function parseToc(zip, pkg) {
  const toc = new Map();
  const put = (href, inner) => {
    const key = href.split("#")[0];
    if (!key || toc.has(key)) return;
    const num = (inner.match(/<span\b[^>]*class="[^"]*tocnum[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || [])[1];
    const label = clean(inner.replace(/<span\b[^>]*class="[^"]*tocnum[^"]*"[^>]*>[\s\S]*?<\/span>/i, ""));
    toc.set(key, { label, num: num ? clean(num) : "" });
  };

  if (pkg.navItem && zip.has(pkg.navItem.href)) {
    const html = zip.read(pkg.navItem.href).toString("utf8");
    const nav = (html.match(/<nav\b[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i) || [])[1] || "";
    for (const m of all(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, nav)) {
      const a = attrs(m[1]);
      if (a.href) put(resolveRef(pkg.navItem.href, a.href), m[2]);
    }
  }

  if (!toc.size && pkg.ncxItem && zip.has(pkg.ncxItem.href)) {
    const ncx = zip.read(pkg.ncxItem.href).toString("utf8");
    for (const m of all(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src="([^"]+)"/gi, ncx)) {
      put(resolveRef(pkg.ncxItem.href, decode(m[2])), m[1]);
    }
  }
  return toc;
}

/* ---------------------------------------------------------------- build */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Chapters are stored scrambled (UTF-8 → XOR with a key → base64) rather than
 * as readable HTML. This is NOT encryption: the reader's own code undoes it in
 * the browser, so anyone determined can too. What it does is stop the files
 * being useful to a casual `curl`, a search engine or an AI crawler that just
 * walks the folder. The same few lines live in src/library/api.js.
 */
function scramble(text, key) {
  const data = Buffer.from(text, "utf8");
  const k = Buffer.from(key, "utf8");
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ k[i % k.length] ^ ((i * 31) & 255);
  return out.toString("base64");
}

const sha = (...parts) => {
  const h = crypto.createHash("sha256");
  parts.forEach((p) => h.update(p));
  return h.digest("hex");
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/* ------------------------------------------------------------ cover art */
// Cover pictures are supplied by hand, in public/ebooks/coverimages/ (or in a
// folder named after the slug inside it). Files are recognised by name:
//
//   सामने / front   the front cover       -> cover.jpg  cover-md.jpg  cover-sm.jpg
//   पीछे / back     the back cover        -> back.jpg   back-sm.jpg
//   रीढ़ / spine    the spine             -> spine.png
//
// Any other file in the folder (for example a full wrap-around jacket) is left
// alone: the site does not show it.
//
// The originals are kept as they are (art/front.png …) for the "download"
// button; the web sizes are made here. Resizing uses what the machine has —
// System.Drawing on Windows, ImageMagick, or sips on a Mac. When a picture
// has not changed its sizes are not made again, so a build on a machine with
// none of those still works from what was published.
const ART_ROLES = [
  { role: "spine", test: /रीढ|spine/i },
  { role: "front", test: /सामने|front/i },
  { role: "back", test: /पीछे|back/i },
];
const ART_SIZES = {
  front: [
    { name: "cover.jpg", width: 2000, q: 88, key: "front" },
    { name: "cover-md.jpg", width: 1000, q: 86, key: "frontMd" },
    { name: "cover-sm.jpg", width: 640, q: 84, key: "frontSmall" },
  ],
  back: [
    { name: "back.jpg", width: 2000, q: 88, key: "back" },
    { name: "back-sm.jpg", width: 640, q: 84, key: "backSmall" },
  ],
  spine: [],
};

function findArtFiles(slug) {
  const base = path.join(ROOT, "public", "ebooks", "coverimages");
  if (!fs.existsSync(base)) return null;
  const own = path.join(base, slug);
  const dir = fs.existsSync(own) && fs.statSync(own).isDirectory() ? own : base;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => ({ name: f, full: path.join(dir, f) }))
    .filter((f) => fs.statSync(f.full).isFile());
  const found = {};
  for (const f of files) {
    const n = f.name.normalize("NFC");
    const hit = ART_ROLES.find((r) => r.test.test(n));
    if (hit && !found[hit.role]) found[hit.role] = f;
  }
  return Object.keys(found).length ? found : null;
}

/** Resize one picture into several JPEGs. Returns true when they were made. */
function resizeMany(src, jobs, bookDir) {
  const cp = require("child_process");
  const os = require("os");
  const tmpSrc = path.join(os.tmpdir(), `vkt-art-${process.pid}${path.extname(src).toLowerCase()}`);
  fs.copyFileSync(src, tmpSrc); // an ASCII path, for tools that dislike Devanagari
  const dest = (j) => path.join(bookDir, j.name);
  try {
    if (process.platform === "win32") {
      const spec = path.join(os.tmpdir(), `vkt-art-${process.pid}.json`);
      const ps1 = path.join(os.tmpdir(), `vkt-art-${process.pid}.ps1`);
      fs.writeFileSync(spec, JSON.stringify(jobs.map((j) => ({ dest: dest(j), width: j.width, quality: j.q }))));
      fs.writeFileSync(
        ps1,
        [
          "param([string]$Src, [string]$Spec)",
          "Add-Type -AssemblyName System.Drawing",
          "$jobs = Get-Content -Raw -Path $Spec | ConvertFrom-Json",
          "$img = [System.Drawing.Image]::FromFile($Src)",
          "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
          "foreach ($j in $jobs) {",
          "  $w = [int]$j.width; if ($w -gt $img.Width) { $w = $img.Width }",
          "  $h = [int][Math]::Round($img.Height * $w / $img.Width)",
          "  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)",
          "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
          "  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
          "  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
          "  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality",
          "  $g.Clear([System.Drawing.Color]::White)",
          "  $g.DrawImage($img, 0, 0, $w, $h)",
          "  $g.Dispose()",
          "  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)",
          "  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$j.quality)",
          "  $bmp.Save($j.dest, $codec, $ep)",
          "  $bmp.Dispose()",
          "}",
          "$img.Dispose()",
        ].join("\r\n"),
        "utf8"
      );
      const r = cp.spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, tmpSrc, spec],
        { encoding: "utf8" }
      );
      fs.rmSync(spec, { force: true });
      fs.rmSync(ps1, { force: true });
      return r.status === 0 && jobs.every((j) => fs.existsSync(dest(j)));
    }
    for (const j of jobs) {
      let r = cp.spawnSync("magick", [tmpSrc, "-resize", `${j.width}x`, "-quality", String(j.q), dest(j)], {
        encoding: "utf8",
      });
      if (r.status !== 0 || !fs.existsSync(dest(j))) {
        r = cp.spawnSync(
          "sips",
          ["-s", "format", "jpeg", "-s", "formatOptions", String(j.q), "--resampleWidth", String(j.width), tmpSrc, "--out", dest(j)],
          { encoding: "utf8" }
        );
      }
      if (r.status !== 0 || !fs.existsSync(dest(j))) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(tmpSrc, { force: true });
  }
}

/**
 * Make (or reuse) the cover set for a book. Returns a manifest of file names
 * relative to the book's folder, plus srcHash for the version, or null when
 * there are no pictures to use.
 */
function prepareArt(slug, bookDir) {
  const found = findArtFiles(slug);
  if (!found) return null;

  const roles = Object.keys(found).sort();
  const srcHash = sha(...roles.map((r) => `${r}:${path.basename(found[r].full)}:`), ...roles.map((r) => fs.readFileSync(found[r].full))).slice(0, 16);

  // already made from these very pictures?
  const prevPath = path.join(bookDir, "book.json");
  if (fs.existsSync(prevPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
      const a = prev.art;
      if (a && a.srcHash === srcHash) {
        const names = [...Object.values(a).filter((v) => typeof v === "string"), ...Object.values(a.original || {})];
        if (names.every((n) => fs.existsSync(path.join(bookDir, n)))) return a;
      }
    } catch {
      /* make them again */
    }
  }

  fs.mkdirSync(path.join(bookDir, "art"), { recursive: true });
  const art = { srcHash, original: {} };
  let resized = true;

  for (const role of roles) {
    const f = found[role];
    const ext = path.extname(f.name).toLowerCase() || ".png";
    const keep = `art/${role}${ext}`;
    fs.copyFileSync(f.full, path.join(bookDir, keep));
    art.original[role] = keep;

    if (role === "spine") {
      // already a thin strip: used as it is
      art.spine = keep;
      continue;
    }
    const jobs = ART_SIZES[role];
    if (resizeMany(f.full, jobs, bookDir)) {
      for (const j of jobs) art[j.key] = j.name;
    } else {
      resized = false;
      for (const j of jobs) art[j.key] = keep; // the original, as it is
    }
  }
  if (!resized) {
    console.log("  note        could not resize the cover pictures here; using the originals (larger files)");
  }

  // tidy: anything an earlier run made that is no longer part of the set
  const keepNames = new Set(
    [...Object.values(art).filter((v) => typeof v === "string"), ...Object.values(art.original)].map((n) =>
      n.replace(/^art\//, "")
    )
  );
  for (const f of fs.readdirSync(path.join(bookDir, "art"))) {
    if (!keepNames.has(f)) fs.rmSync(path.join(bookDir, "art", f), { force: true });
  }
  for (const f of ["jacket.jpg", "jacket-sm.jpg"]) fs.rmSync(path.join(bookDir, f), { force: true });
  return art;
}

/** Returns "published" | "unchanged" so callers can say what happened. */
function publish(input, slug, overrides, args) {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `"${slug}" is not a usable slug. Use lowercase letters, digits and hyphens, e.g. do-kulhad-chai`
    );
  }
  if (overrides.published && !DATE_RE.test(overrides.published)) {
    throw new Error(`"published" must look like 2026-10-16, got "${overrides.published}".`);
  }

  const contentRoot = path.resolve(ROOT, args.out || "public/content");
  const urlBase = String(args.base || "/content").replace(/\/$/, "");
  const bookDir = path.join(contentRoot, slug);
  const bookUrl = `${urlBase}/${slug}`;

  const epubBuf = fs.readFileSync(input);

  // hand-made cover pictures, if public/ebooks/coverimages has any
  fs.mkdirSync(bookDir, { recursive: true });
  const art = prepareArt(slug, bookDir);

  // What identifies "this exact book as published": the file's bytes plus any
  // overrides plus the cover pictures. Replace the file, change the date or
  // swap a picture, and this changes.
  const hash = sha(epubBuf, JSON.stringify(overrides), art ? art.srcHash : "");
  const version = hash.slice(0, 12);

  const bookPath = path.join(bookDir, "book.json");
  if (!args.force && fs.existsSync(bookPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(bookPath, "utf8"));
      if (prev.source && prev.source.hash === hash) {
        console.log(`Unchanged  "${prev.title}" (${slug}) — already up to date`);
        return "unchanged";
      }
    } catch {
      /* unreadable: publish again */
    }
  }

  const zip = openZip(epubBuf);
  const pkg = parsePackage(zip);
  const toc = parseToc(zip, pkg);

  const lang = pkg.language.split("-")[0];
  const wpm = WPM[lang] || WPM.default;
  const key = `${slug}:${version}`;

  // ids are the file names, so URLs read /read/<slug>/ch05
  const idOf = (href) => posix.basename(href).replace(/\.[^.]+$/, "");
  const textDocs = pkg.spine.filter((i) => /xhtml|html/.test(i.type));
  const idByHref = new Map(textDocs.map((i) => [i.href, idOf(i.href)]));

  // the reader has its own contents panel, so the EPUB's own nav document is
  // not a chapter; its cover page is replaced by one the reader builds below
  const skip = (i) =>
    i === pkg.navItem ||
    i.props.includes("nav") ||
    /\bcover\b/i.test(i.id) ||
    /^cover$/i.test(idOf(i.href));
  const sections = textDocs.filter((i) => !skip(i));

  // wipe what we own, keep anything hand-made next to it (e.g. cover-sm.jpg)
  for (const sub of ["chapters", "assets"]) {
    fs.rmSync(path.join(bookDir, sub), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(bookDir, "chapters"), { recursive: true });

  // this site never offers the book as a file: remove any copy left by an
  // earlier version of this script
  for (const f of fs.readdirSync(bookDir)) {
    if (/\.epub$/i.test(f)) fs.rmSync(path.join(bookDir, f));
  }

  const copied = new Set();
  const copyAsset = (zipPath) => {
    if (!zip.has(zipPath)) return null;
    // keep the folder structure under assets/, minus the package directory
    const rel = posix.relative(dirOf(pkg.opfPath), zipPath).replace(/^(\.\.\/)+/, "");
    const dest = path.join(bookDir, "assets", ...rel.split("/"));
    if (!copied.has(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, zip.read(zipPath));
      copied.add(dest);
    }
    return `${bookUrl}/assets/${rel}`;
  };

  const rewrite = (html, fromHref) =>
    html.replace(/\b(src|href|xlink:href|poster)=("([^"]*)"|'([^']*)')/gi, (m, attr, _q, dq, sq) => {
      const raw = decode(dq ?? sq ?? "");
      if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return m;
      const [file, frag] = raw.split("#");
      const target = resolveRef(fromHref, file);

      if (idByHref.has(target)) {
        const id = idByHref.get(target);
        return `${attr}="/read/${slug}/${id}${frag ? `#${frag}` : ""}"`;
      }
      const asset = copyAsset(target);
      return asset ? `${attr}="${asset}"` : m;
    });

  const bodyOf = (xhtml) => {
    const m = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    return (m ? m[1] : xhtml)
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
  };

  const writeChapter = (id, html) =>
    fs.writeFileSync(path.join(bookDir, "chapters", `${id}.dat`), scramble(html, key), "utf8");

  const chapters = [];
  for (const item of sections) {
    const raw = zip.read(item.href).toString("utf8");
    const id = idOf(item.href);
    const body = rewrite(bodyOf(raw), item.href);
    const text = clean(body);
    const words = text ? text.split(" ").length : 0;
    const tocEntry = toc.get(item.href);
    const docTitle = firstText(raw, "title");

    // front matter = anything the EPUB's own contents does not number
    const numbered = Boolean(tocEntry && tocEntry.num);
    chapters.push({
      id,
      file: `chapters/${id}.dat`,
      title: (tocEntry && tocEntry.label) || docTitle || id,
      num: numbered ? tocEntry.num : "",
      kind: numbered ? "chapter" : "matter",
      words,
      minutes: Math.max(1, Math.round(words / wpm)),
    });
    writeChapter(id, body);
  }

  // "matter" before the first chapter is front matter, after the last is back
  const firstCh = chapters.findIndex((c) => c.kind === "chapter");
  const lastCh = chapters.map((c) => c.kind).lastIndexOf("chapter");
  chapters.forEach((c, i) => {
    if (c.kind === "matter") c.kind = i < firstCh ? "front" : i > lastCh ? "back" : "front";
  });

  /* cover */
  let cover = null;
  if (art && art.front) {
    cover = art.front; // the supplied front cover wins over the EPUB's own
  } else if (pkg.cover && zip.has(pkg.cover.href)) {
    const ext = path.extname(pkg.cover.href).toLowerCase() || ".jpg";
    cover = `cover${ext}`;
    fs.writeFileSync(path.join(bookDir, cover), zip.read(pkg.cover.href));
  }
  // an optional, hand-made small cover (cards, library) sits beside it
  const smallCandidates = ["cover-sm.jpg", "cover-sm.webp", "cover-sm.png"];
  const coverSmall =
    (art && art.frontSmall) || smallCandidates.find((f) => fs.existsSync(path.join(bookDir, f))) || cover;
  // the page the reader opens on: sharper than a card, lighter than the full art
  const coverPage = (art && (art.frontMd || art.frontSmall)) || coverSmall;

  // The book opens on its cover, like a physical one. It is a page of its own
  // so the reader needs no special case: it is just the first section.
  if (coverPage) {
    const title = overrides.title || pkg.title;
    const html = `<section class="cover" epub:type="cover"><img src="${bookUrl}/${coverPage}" alt="${esc(
      title
    )} — आवरण" width="640" height="898"/></section>`;
    chapters.unshift({
      id: "cover",
      file: "chapters/cover.dat",
      title: "आवरण",
      num: "",
      kind: "front",
      words: 0,
      minutes: 0,
    });
    writeChapter("cover", html);
  }

  const words = chapters.reduce((n, c) => n + c.words, 0);
  const book = {
    slug,
    version,
    title: overrides.title || pkg.title,
    author: overrides.author || pkg.creators.join(", "),
    language: lang,
    publisher: pkg.publisher,
    // the date the book is published on, not the EPUB's own year-only dc:date
    published: overrides.published || pkg.date,
    updated: pkg.modified,
    rights: pkg.rights,
    description: overrides.description || pkg.description,
    subjects: pkg.subjects,
    identifier: pkg.identifier,
    cover,
    coverSmall,
    art: art || undefined,
    source: { file: path.basename(input), hash },
    stats: {
      chapters: chapters.filter((c) => c.kind === "chapter").length,
      sections: chapters.length,
      words,
      minutes: Math.max(1, Math.round(words / wpm)),
      wpm,
    },
    chapters,
  };
  fs.writeFileSync(bookPath, JSON.stringify(book, null, 1) + "\n", "utf8");

  /* catalogue */
  const indexPath = path.join(contentRoot, "index.json");
  let catalogue = { books: [] };
  if (fs.existsSync(indexPath)) {
    try {
      catalogue = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch {
      /* start fresh */
    }
  }
  const entry = {
    slug,
    version,
    title: book.title,
    author: book.author,
    language: book.language,
    description: book.description,
    published: book.published,
    updated: book.updated,
    cover: book.cover,
    coverSmall: book.coverSmall,
    art: book.art,
    chapters: book.stats.chapters,
    minutes: book.stats.minutes,
  };
  catalogue.books = [...catalogue.books.filter((b) => b.slug !== slug), entry].sort((a, b) =>
    String(b.published).localeCompare(String(a.published)) || a.title.localeCompare(b.title)
  );
  fs.writeFileSync(indexPath, JSON.stringify(catalogue, null, 1) + "\n", "utf8");

  console.log(`Published  "${book.title}" — ${book.author}`);
  console.log(`  slug        ${slug}  (version ${version})`);
  console.log(`  published   ${book.published}`);
  console.log(`  sections    ${chapters.length} (${book.stats.chapters} numbered chapters)`);
  console.log(`  length      ${words.toLocaleString("en-IN")} words · about ${book.stats.minutes} min`);
  console.log(`  cover       ${cover || "none"}${coverSmall && coverSmall !== cover ? ` (+ ${coverSmall})` : ""}`);
  console.log(`  written to  ${path.relative(ROOT, bookDir)}`);
  if (cover && coverSmall === cover) {
    console.log("  tip         add a 640px-wide cover-sm.jpg beside the cover for faster cards");
  }
  // A new edition may have reworded something the site quotes. Say so now,
  // while the author is looking at the terminal, rather than leave the site
  // attributing to the book a line it no longer contains.
  if (!args["no-check"]) {
    const r = require("child_process").spawnSync(
      process.execPath,
      [path.join(__dirname, "check-quotes.js"), slug],
      { encoding: "utf8" }
    );
    const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
    const lines = out.split(String.fromCharCode(10));
    if (out && r.status !== 0) {
      console.log("");
      console.log("  ! Quoted lines on the site no longer match this edition:");
      console.log(lines.map((l) => "    " + l).join(String.fromCharCode(10)));
    } else if (out) {
      console.log("  quotes      " + lines[lines.length - 1]);
    }
  }
  return "published";
}

/* --------------------------------------------------------------- driver */
/** public/ebooks/books.json — per-file settings, keyed by file name. */
function readSettings(dropBox) {
  const file = path.join(dropBox, "books.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${path.relative(ROOT, file)} is not valid JSON.`);
  }
}

function settingsFor(file, dropBox, args, single) {
  const name = path.basename(file);
  const all = readSettings(dropBox);
  const mine = { ...(all[name] || {}) };

  if (args.slug && single) mine.slug = String(args.slug).trim();
  if (args.published) mine.published = String(args.published).trim();

  if (!mine.slug) {
    const fromName = name.replace(/\.epub$/i, "");
    if (SLUG_RE.test(fromName)) mine.slug = fromName;
  }
  if (!mine.slug) {
    throw new Error(
      `No URL name for "${name}". Add it to ${path.relative(ROOT, path.join(dropBox, "books.json"))}, e.g.\n` +
        `  { "${name}": { "slug": "my-book", "published": "2026-10-16" } }`
    );
  }
  return mine;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const dropBox = path.join(ROOT, "public", "ebooks");

  let files;
  if (args._.length) {
    files = args._.map((f) => path.resolve(f));
  } else if (fs.existsSync(dropBox)) {
    files = fs
      .readdirSync(dropBox)
      .filter((f) => /\.epub$/i.test(f))
      .map((f) => path.join(dropBox, f));
  } else {
    files = [];
  }

  if (!files.length) {
    // `--soft` is for builds: a checkout without the drop box (CI, a fresh
    // clone) must still build from the already-published public/content.
    if (args.soft) {
      console.log("[books] no EPUB in public/ebooks — using the published content as it is.");
      return;
    }
    console.error(
      "No EPUB to publish. Put one in public/ebooks/ or pass a path:\n" +
        "  npm run book:publish -- path/to/book.epub --slug my-book"
    );
    process.exit(1);
  }
  if (args.slug && files.length > 1) {
    console.error("--slug names one book; give one file, or use books.json for several.");
    process.exit(1);
  }

  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    const settings = settingsFor(file, dropBox, args, files.length === 1);
    const { slug, ...overrides } = settings;
    publish(file, slug, overrides, args);
  }
}

try {
  run();
} catch (err) {
  console.error(`Publish failed: ${err.message}`);
  process.exit(1);
}
