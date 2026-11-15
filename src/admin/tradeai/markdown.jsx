// A small, safe Markdown renderer for TradeAI's answers: headings, paragraphs, **bold**, *italic*,
// ~~strike~~, `code`, links (http/https only, new tab), bullet and numbered lists (one level of
// nesting), quotes, rules, code blocks and tables. Signed figures (+1.2%, −₹300, ▲ 0.8%) are coloured
// green / red. It builds React elements only — no HTML strings — so an answer can never inject markup.

import React from "react";

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l) || (l.includes("|") && l.split("|").length >= 3);
const cells = (l) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const UL = /^(\s*)[-*•+]\s+(.*)$/;
const OL = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;

/** Text → blocks: { type, ... }. Exported for the tests. */
export function parseBlocks(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    // code block
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      // # and ## → the largest heading, ### (what TradeAI writes) → the middle one, deeper → small
      out.push({ type: "h", level: h[1].length <= 2 ? 1 : h[1].length === 3 ? 2 : 3, text: h[2] });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ type: "hr" });
      i += 1;
      continue;
    }
    // table: a row, then a separator row
    if (isRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : null));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push({ type: "table", head, align, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ type: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      const ordered = !UL.test(line);
      const start = ordered ? Number(line.match(OL)[2]) : 1;
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const u = lines[i].match(UL);
        const o = lines[i].match(OL);
        const m = u || o;
        if (m) {
          const indent = m[1].length;
          const body = u ? u[2] : o[3];
          if (indent < 2 && items.length && Boolean(o && !u) !== ordered) break; // a list of the other kind starts
          if (indent >= 2 && items.length) {
            const last = items[items.length - 1];
            last.sub = last.sub || { ordered: !u, items: [] };
            last.sub.items.push({ text: body });
          } else items.push({ text: body });
        } else if (items.length) items[items.length - 1].text += ` ${lines[i].trim()}`; // a wrapped line
        i += 1;
        const next = lines[i] || "";
        if (next.trim() && !UL.test(next) && !OL.test(next) && (/^\s*(#|>|```|\|)/.test(next) || !/^\s{2,}/.test(next))) break;
      }
      out.push({ type: ordered ? "ol" : "ul", start, items });
      continue;
    }
    // paragraph: until a blank line or another block
    const body = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```)/.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i]) && !(isRow(lines[i]) && TABLE_SEP.test(lines[i + 1] || ""))) body.push(lines[i++]);
    out.push({ type: "p", lines: body });
  }
  return out;
}

/* ---------------------------------------------------------------------------------- inline */
// (no look-behind: older Safari cannot parse it — the character before an italic or a signed
// figure is captured instead and given back as text)
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(~~[^~\n]+?~~)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))|(^|[\s(])([*_][^*_\s][^*_\n]*?[*_])(?=[\s.,;:!?)]|$)|(^|[\s(:])([+−-](?:₹\s?)?\d[\d,]*(?:\.\d+)?%?|[▲▼]\s?(?:₹\s?)?\d[\d,]*(?:\.\d+)?%?)(?![\d:])/g;

/** Inline Markdown → React nodes. */
export function inline(text, key = "i") {
  const s = String(text || "");
  const out = [];
  let last = 0;
  let n = 0;
  s.replace(INLINE, (m, code, bold, strike, link, href, italPre, ital, signPre, signed, offset) => {
    if (offset > last) out.push(s.slice(last, offset));
    const pre = italPre || signPre || "";
    if (pre) out.push(pre);
    const k = `${key}-${n++}`;
    if (code) out.push(<code key={k}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={k}>{inline(bold.slice(2, -2), k)}</strong>);
    else if (strike) out.push(<del key={k}>{strike.slice(2, -2)}</del>);
    else if (link) {
      const label = link.slice(1, link.indexOf("]("));
      out.push(
        <a key={k} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    } else if (ital) out.push(<em key={k}>{inline(ital.slice(1, -1), k)}</em>);
    else if (signed) {
      const down = /^[−-]|^▼/.test(signed.trim());
      out.push(
        <span key={k} className={down ? "md-down" : "md-up"}>
          {signed}
        </span>
      );
    }
    last = offset + m.length;
    return m;
  });
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const NUM = /^[+−-]?\s?[₹$]?\s?\d[\d,]*(\.\d+)?\s?(%|x|×|R)?$/;
const signOf = (c) => (/^[+▲]/.test(c) ? "md-up" : /^[−▼]|^-\s?[₹\d]/.test(c) ? "md-down" : "");

function Cell({ as: Tag, c, align, k }) {
  const num = NUM.test(c);
  return (
    <Tag className={[num ? "is-num" : "", num ? signOf(c) : ""].filter(Boolean).join(" ") || undefined} style={align ? { textAlign: align } : undefined}>
      {inline(c, k)}
    </Tag>
  );
}

function Block({ b, k }) {
  switch (b.type) {
    case "h": {
      const Tag = b.level === 1 ? "h3" : b.level === 2 ? "h4" : "h5";
      return <Tag className="md-h">{inline(b.text, k)}</Tag>;
    }
    case "hr":
      return <hr className="md-hr" />;
    case "code":
      return (
        <pre className="md-pre">
          <code>{b.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="md-quote">
          {b.blocks.map((x, i) => (
            <Block key={i} b={x} k={`${k}-${i}`} />
          ))}
        </blockquote>
      );
    case "table":
      return (
        <div className="md-table" role="region" aria-label="Table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <Cell key={i} as="th" c={c} align={b.align[i]} k={`${k}-h${i}`} />
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {b.head.map((_, i) => (
                    <Cell key={i} as="td" c={r[i] || ""} align={b.align[i]} k={`${k}-${j}-${i}`} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "ul":
    case "ol": {
      const Tag = b.type;
      return (
        <Tag className="md-list" start={b.type === "ol" && b.start !== 1 ? b.start : undefined}>
          {b.items.map((it, i) => (
            <li key={i}>
              {inline(it.text, `${k}-${i}`)}
              {it.sub && <Block b={{ type: it.sub.ordered ? "ol" : "ul", start: 1, items: it.sub.items }} k={`${k}-${i}s`} />}
            </li>
          ))}
        </Tag>
      );
    }
    default:
      return (
        <p className="md-p">
          {b.lines.map((l, i) => (
            <React.Fragment key={i}>
              {i ? <br /> : null}
              {inline(l, `${k}-${i}`)}
            </React.Fragment>
          ))}
        </p>
      );
  }
}

export default function Markdown({ text, className = "" }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => (
        <Block key={i} b={b} k={String(i)} />
      ))}
    </div>
  );
}
