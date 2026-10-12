// src/library/coverImage.js
// What is printed on the back cover, and a picture of it.
//
// The front cover is a real image. The back cover is typeset in the page, so
// to open it "like an image" — and to let a reader keep it — it is drawn onto
// a canvas at the same proportions as the front (1819 × 2551) and handed back
// as a PNG.

import { fmtDate } from "../reader/util";
import { BOOK, AUTHOR } from "../data/books";

/** The words on the back cover — shared by the page and the picture. */
export function backCoverContent(book) {
  const flagship = book.slug === BOOK.slug;
  const lines = String(book.description || "")
    .split(/(?<=[।?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    title: book.title,
    author: book.author,
    lines,
    quote: flagship ? BOOK.marqueeLine : "",
    aboutHead: "लेखक के बारे में",
    about: flagship ? AUTHOR.brief : "",
    published: book.published ? `प्रकाशन · ${fmtDate(book.published)}` : "प्रथम संस्करण",
    site: "www.vinaytiwari.org",
  };
}

const FACE = '"Noto Sans Devanagari", "Nirmala UI", "Mangal", system-ui, sans-serif';

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

/** Draw the back cover; resolves to a PNG Blob. */
export async function renderBackCover(book, width = 1819) {
  const W = width;
  const H = Math.round((W * 2551) / 1819);
  const u = W / 100; // the same unit the page uses (1cqw)
  const c = backCoverContent(book);

  // the face must be in memory before the first measure
  try {
    await Promise.all([
      document.fonts.load(`400 ${Math.round(u * 5.9)}px "Noto Sans Devanagari"`, c.lines.join(" ") || "अ"),
      document.fonts.load(`700 ${Math.round(u * 5)}px "Noto Sans Devanagari"`, "अ"),
    ]);
    await document.fonts.ready;
  } catch {
    /* draw with whatever face the system has */
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext("2d");

  /* ---- the night ---- */
  const base = x.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, "#071022");
  base.addColorStop(0.55, "#0b1426");
  base.addColorStop(1, "#101f3b");
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);

  const glow = x.createRadialGradient(W * 0.78, -H * 0.04, 0, W * 0.78, -H * 0.04, W * 0.95);
  glow.addColorStop(0, "rgba(29,53,96,0.95)");
  glow.addColorStop(1, "rgba(29,53,96,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  // rain, still
  const rain = x.createLinearGradient(0, 0, 0, H);
  rain.addColorStop(0.1, "rgba(176,202,240,0.09)");
  rain.addColorStop(0.9, "rgba(176,202,240,0)");
  x.strokeStyle = rain;
  x.lineWidth = Math.max(1, u * 0.2);
  const slant = Math.tan((14 * Math.PI) / 180) * H;
  for (let sx = -slant; sx < W + slant; sx += u * 11) {
    x.beginPath();
    x.moveTo(sx + slant, 0);
    x.lineTo(sx, H);
    x.stroke();
  }

  /* ---- type ---- */
  const padX = u * 8;
  const innerW = W - padX * 2;
  const font = (px, weight = 400) => `${weight} ${px}px ${FACE}`;
  x.textBaseline = "alphabetic";

  // measure the pieces first, so the body can sit in the space that is left
  const topSize = u * 3.6;
  const topH = topSize * 1.4;

  x.font = font(u * 3.6);
  const footH = u * 3.6 * 1.4;

  let aboutBlock = null;
  if (c.about) {
    x.font = font(u * 4);
    const lines = wrap(x, c.about, innerW);
    const headH = u * 3.45 * 1.4;
    aboutBlock = { lines, headH, lineH: u * 4 * 1.5, pad: u * 2.4 };
    aboutBlock.h = aboutBlock.pad + headH + lines.length * aboutBlock.lineH;
  }

  x.font = font(u * 5.6);
  const blurb = c.lines.map((l) => wrap(x, l, innerW));
  const blurbLine = u * 5.6 * 1.55;
  const blurbGap = u * 5.6 * 0.5;
  const blurbH =
    blurb.reduce((a, b) => a + b.length * blurbLine, 0) + blurbGap * Math.max(0, blurb.length - 1);

  let quoteLines = [];
  const quoteLine = u * 4.4 * 1.5;
  if (c.quote) {
    x.font = font(u * 4.4);
    quoteLines = wrap(x, c.quote, innerW);
  }
  const bodyGap = u * 3;
  const bodyH =
    blurbH + (c.quote ? bodyGap + 1 + bodyGap + quoteLines.length * quoteLine : 0);

  /* ---- place ---- */
  const topY = u * 6;
  const footBottom = H - u * 5;
  const footTop = footBottom - footH;
  const aboutTop = aboutBlock ? footTop - u * 2.4 - aboutBlock.h : footTop;
  const regionTop = topY + topH + u * 2.4;
  const regionBottom = aboutTop - u * 2.4;
  let y = regionTop + Math.max(0, (regionBottom - regionTop - bodyH) / 2);

  // top line
  x.fillStyle = "#e3b66c";
  x.font = font(topSize);
  x.textAlign = "left";
  x.fillText(c.title, padX, topY + topSize * 1.05);
  x.textAlign = "right";
  x.fillText(c.author, W - padX, topY + topSize * 1.05);

  // blurb
  x.textAlign = "center";
  x.fillStyle = "#f7f3ec";
  x.font = font(u * 5.6);
  blurb.forEach((lines, i) => {
    lines.forEach((ln) => {
      x.fillText(ln, W / 2, y + u * 5.6 * 1.12);
      y += blurbLine;
    });
    if (i < blurb.length - 1) y += blurbGap;
  });

  // rule + the cover line
  if (c.quote) {
    y += bodyGap;
    const rw = u * 22;
    const rule = x.createLinearGradient(W / 2 - rw / 2, 0, W / 2 + rw / 2, 0);
    rule.addColorStop(0, "rgba(217,166,90,0)");
    rule.addColorStop(0.5, "rgba(217,166,90,1)");
    rule.addColorStop(1, "rgba(217,166,90,0)");
    x.fillStyle = rule;
    x.fillRect(W / 2 - rw / 2, y, rw, Math.max(1, u * 0.12));
    y += 1 + bodyGap;

    x.fillStyle = "#efd29a";
    x.font = font(u * 4.4);
    quoteLines.forEach((ln) => {
      x.fillText(ln, W / 2, y + u * 4.4 * 1.1);
      y += quoteLine;
    });
  }

  // the author, small
  if (aboutBlock) {
    x.fillStyle = "rgba(244,240,233,0.2)";
    x.fillRect(padX, aboutTop, innerW, Math.max(1, u * 0.1));
    let ay = aboutTop + aboutBlock.pad;

    x.textAlign = "left";
    x.fillStyle = "#e3b66c";
    x.font = font(u * 3.45);
    x.fillText(c.aboutHead, padX, ay + u * 3.45 * 1.05);
    ay += aboutBlock.headH;

    x.fillStyle = "#c9d1e0";
    x.font = font(u * 4);
    aboutBlock.lines.forEach((ln) => {
      x.fillText(ln, padX, ay + u * 4 * 1.1);
      ay += aboutBlock.lineH;
    });
  }

  // foot
  x.fillStyle = "#a9b3c8";
  x.font = font(u * 3.6);
  x.textAlign = "left";
  x.fillText(c.published, padX, footTop + u * 3.6 * 1.05);
  x.textAlign = "right";
  x.fillText(c.site, W - padX, footTop + u * 3.6 * 1.05);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not draw the cover"))), "image/png");
  });
}
