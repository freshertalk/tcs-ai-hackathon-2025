#!/usr/bin/env node
"use strict";
// Draws the link-preview pictures of the private area: one 1200×630 PNG per page in
// public/img/og/, from the page list in server/previews.js (the same names and lines the server
// puts in each page's tags). The DrishtiAI logo (public/drishti-512.png, the PNG copy of public/drishti-logo.svg) on the
// left, the page name and two lines on the right, on the terminal's dark blue; quantised to 256 colours so each file
// stays small.
//
// Run by hand after a page is added or renamed:
//   node scripts/og-images.js
// Needs ffmpeg (set FFMPEG to its path if it is not on PATH) and the Segoe UI fonts (Windows) or
// set OG_FONT / OG_FONT_BOLD to any .ttf files.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PAGES, SITE, LINE, IMG_W, IMG_H } = require("../server/previews");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "img", "og");
const ART = path.join(ROOT, "public", "drishti-512.png");
const WINGET = "C:/Users/fresh/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
const FFMPEG = process.env.FFMPEG || (fs.existsSync(WINGET) ? WINGET : "ffmpeg");
const FONT = process.env.OG_FONT || "C:/Windows/Fonts/segoeui.ttf";
const FONT_BOLD = process.env.OG_FONT_BOLD || "C:/Windows/Fonts/segoeuib.ttf";

const GOLD = "0xd9a93a";
const INK = "0xf2f6fa";
const SOFT = "0xc9d3df";
const DIM = "0x8f9bab";

function draw(key, p, tmp) {
  // every text goes through a file, so no character needs escaping in the filter graph; the
  // fonts and texts sit in the working folder, so no path carries a drive colon either
  const put = (name, text) => fs.writeFileSync(path.join(tmp, name), text, "utf8");
  const dash = p.name === SITE;
  put("kicker.txt", dash ? "Private workspace" : SITE);
  put("name.txt", p.name);
  put("l1.txt", p.card[0] || "");
  put("l2.txt", p.card[1] || "");
  put("foot.txt", `${SITE} — ${LINE}`);
  const size = Math.min(80, Math.floor(510 / (p.name.length * 0.58)));
  // the two lines share one size that fits the widest in 520 px (Segoe UI averages ~0.47 em a character)
  const lineSize = Math.min(30, Math.floor(520 / (Math.max(...p.card.map((t) => t.length), 1) * 0.47)));
  const nameY = 128;
  const ruleY = nameY + Math.round(size * 1.28) + 18;
  const x = 632;
  const text = (file, font, px, color, y) => `drawtext=fontfile=${font}:textfile=${file}:fontsize=${px}:fontcolor=${color}:x=${x}:y=${y}`;
  const graph = [
    `gradients=s=${IMG_W}x${IMG_H}:c0=0x0b0f14:c1=0x10233a:x0=0:y0=0:x1=${IMG_W}:y1=${IMG_H}:nb_colors=2:d=1:r=1[bg]`,
    `[0:v]scale=430:430:flags=lanczos,format=rgba[art]`,
    `[bg][art]overlay=100:100:format=auto`,
    text("kicker.txt", "bold.ttf", 30, GOLD, 92),
    text("name.txt", "bold.ttf", size, INK, nameY),
    `drawbox=x=${x + 2}:y=${ruleY}:w=96:h=4:color=${GOLD}:t=fill`,
    text("l1.txt", "regular.ttf", lineSize, SOFT, ruleY + 30),
    text("l2.txt", "regular.ttf", lineSize, SOFT, ruleY + 30 + Math.round(lineSize * 1.45)),
    `${text("foot.txt", "regular.ttf", 24, DIM, 548)},split[a][b]`,
    `[a]palettegen=max_colors=256:stats_mode=full[pal]`,
    `[b][pal]paletteuse=dither=sierra2_4a`,
  ];
  // the gradient source and the chain are joined by ';' between labelled pads, ',' inside a chain
  const fc = `${graph[0]};${graph[1]};${graph.slice(2, 9).join(",")};${graph[9]};${graph[10]}`;
  const out = path.join(OUT, `${p.image}.png`);
  const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-i", ART, "-filter_complex", fc, "-frames:v", "1", "-compression_level", "9", out], { cwd: tmp, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${key}: ffmpeg failed — ${(r.stderr || r.error || "").toString().slice(0, 600)}`);
  return { file: path.relative(ROOT, out), kb: Math.round(fs.statSync(out).size / 1024) };
}

function main() {
  if (!fs.existsSync(ART)) throw new Error(`The artwork is missing: ${ART}`);
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
  fs.copyFileSync(FONT, path.join(tmp, "regular.ttf"));
  fs.copyFileSync(FONT_BOLD, path.join(tmp, "bold.ttf"));
  const done = new Set();
  for (const [key, p] of Object.entries(PAGES)) {
    if (done.has(p.image)) continue;
    done.add(p.image);
    const r = draw(key, p, tmp);
    console.log(`[og] ${r.file} — ${r.kb} KB`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
