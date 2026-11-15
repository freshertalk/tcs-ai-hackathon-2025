// The Document is plain data: these tests keep it well-formed (so a typo in a chapter cannot
// blank the page), keep every chapter reachable from the contents, and keep search honest.

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Document, { blockText, matches } from "./Document";
import { PARTS, CHAPTERS } from "./chapters";

const KINDS = ["h", "p", "ul", "ol", "dl", "table", "note", "warn", "logic"];

describe("Document content", () => {
  test("every chapter has an id, a part that exists, a title and blocks", () => {
    const parts = new Set(PARTS.map((p) => p.id));
    const ids = new Set();
    CHAPTERS.forEach((c) => {
      expect(c.id).toBeTruthy();
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(parts.has(c.part)).toBe(true);
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.blocks.length).toBeGreaterThan(0);
    });
    // chapters are numbered 1..n in reading order
    expect(CHAPTERS.map((c) => c.no)).toEqual(CHAPTERS.map((_, i) => String(i + 1)));
  });

  test("every block is of a known kind and well formed", () => {
    CHAPTERS.forEach((c) =>
      c.blocks.forEach((b, i) => {
        const kinds = KINDS.filter((k) => b[k] !== undefined);
        expect({ chapter: c.id, at: i, kinds: kinds.length }).toEqual({ chapter: c.id, at: i, kinds: 1 });
        if (b.ul) b.ul.forEach((t) => expect(typeof t).toBe("string"));
        if (b.ol) b.ol.forEach((t) => expect(typeof t).toBe("string"));
        if (b.dl) b.dl.forEach((pair) => expect(pair).toHaveLength(2));
        if (b.table) {
          expect(b.table.head.length).toBeGreaterThan(0);
          b.table.rows.forEach((r) => expect({ chapter: c.id, cells: r.length }).toEqual({ chapter: c.id, cells: b.table.head.length }));
        }
        if (b.logic) {
          expect(b.logic.title).toBeTruthy();
          expect(Array.isArray(b.logic.steps || [])).toBe(true);
        }
      })
    );
  });

  test("text uses balanced bold and code marks", () => {
    const bad = [];
    const texts = (b) => {
      const out = [];
      ["h", "p", "note", "warn"].forEach((k) => b[k] && out.push(b[k]));
      (b.ul || []).forEach((t) => out.push(t));
      (b.ol || []).forEach((t) => out.push(t));
      (b.dl || []).forEach(([t, d]) => out.push(t, d));
      if (b.table) {
        out.push(...b.table.head);
        b.table.rows.forEach((r) => out.push(...r));
      }
      if (b.logic) out.push(b.logic.title, b.logic.who || "", b.logic.when || "", b.logic.limits || "", ...(b.logic.steps || []));
      return out;
    };
    CHAPTERS.forEach((c) =>
      c.blocks.forEach((b) =>
        texts(b).forEach((t) => {
          if ((t.match(/\*\*/g) || []).length % 2 || (t.match(/`/g) || []).length % 2) bad.push(`${c.id}: ${t.slice(0, 60)}`);
        })
      )
    );
    expect(bad).toEqual([]);
  });

  test("the manual never promises a profit", () => {
    const all = CHAPTERS.flatMap((c) => c.blocks.map(blockText)).join(" ");
    // the one place the phrase appears is the FAQ question that answers "No"
    const cleaned = all.replace(/can it guarantee profit, or a 100% win rate\?/gi, "");
    expect(/guaranteed profit|100% win|sure[- ]shot/i.test(cleaned)).toBe(false);
  });

  test("search needs every word", () => {
    expect(matches("the live call follows price", ["live", "price"])).toBe(true);
    expect(matches("the live call follows price", ["live", "volume"])).toBe(false);
  });
});

describe("Document page", () => {
  beforeEach(() => {
    window.scrollTo = jest.fn();
    window.print = jest.fn();
  });

  test("shows the title and one contents link per chapter", () => {
    render(<Document />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Drishti/);
    const nav = screen.getByRole("navigation", { name: "Contents" });
    expect(within(nav).getAllByRole("link")).toHaveLength(CHAPTERS.length);
  });

  test("search narrows the page and marks the words found", () => {
    const { container } = render(<Document />);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "profit lock" } });
    expect(screen.getByRole("status").textContent).toMatch(/passage/);
    expect(container.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("section.doc-chapter").length).toBeLessThan(CHAPTERS.length);
  });

  test("an unmatched search says so", () => {
    render(<Document />);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "zzzzqqqq" } });
    expect(screen.getByRole("status").textContent).toMatch(/Nothing found/);
  });
});
