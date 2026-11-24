import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthContext } from "../auth";
import TradeAI from "./TradeAI";

const mockCalls = [];
const mockConv = { id: "abc123abc123", title: "SBIN check", updatedAt: new Date().toISOString(), pinned: false, count: 2, preview: "" };
const mockReply = { answer: "### SBIN\n**Hold** while 799 holds.\n\n| Level | Price |\n|---|---|\n| VWAP | 803.2 |", datapoints: [{ label: "P&L", value: "+₹240" }], actions: [{ kind: "corrective", text: "Keep the stop at 799." }], forecast: { lean: "up", horizon: "next 30 minutes", scenarios: ["Above 809: 813"] }, confidence: "medium", followups: [], related: ["Where should I trail my stop on SBIN?"], meta: { used: ["SBIN"], by: ["A", "B", "C"], mergedBy: "A", sec: 12.3, steps: ["Reading SBIN"], models: [] } };
jest.mock("../api", () => ({
  api: (url, opts = {}) => {
    mockCalls.push([url, opts.method || "GET", opts.body]);
    if (url.startsWith("/api/admin/tradeai/suggest")) return Promise.resolve({ suggestions: [{ text: "My INFY short is down ₹300 — should I exit or hold?", why: "Open short · −₹300", kind: "position", score: 130 }], positions: 2 });
    if (url.startsWith("/api/admin/tradeai/convs/abc123abc123")) return Promise.resolve({ ...mockConv, messages: [{ id: "m1", role: "user", text: "How is SBIN?" }, { id: "m2", role: "assistant", text: mockReply.answer, reply: mockReply }] });
    if (url.startsWith("/api/admin/tradeai/convs")) return Promise.resolve({ convs: [mockConv] });
    return Promise.resolve({});
  },
}));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});

const page = () => (
  <AuthContext.Provider value={{ loading: false, user: { email: "o@example.com", name: "Test Person", role: "superadmin" }, reload() {} }}>
    <div className="adm">
      <TradeAI />
    </div>
  </AuthContext.Provider>
);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 300)));

beforeEach(() => {
  mockCalls.length = 0;
  window.history.replaceState(null, "", "/me/tradeai");
  Element.prototype.scrollTo = function scrollTo() {};
});

test("a new chat greets you, suggests from your open positions, and lists your saved chats", async () => {
  render(page());
  await settle();
  expect(screen.getByText(/, Test$/)).toBeTruthy();
  expect(screen.getByText(/INFY short is down ₹300/)).toBeTruthy();
  expect(screen.getByText("Open short · −₹300")).toBeTruthy();
  expect(screen.getByText(/from your 2 open positions/)).toBeTruthy();
  expect(screen.getByText("SBIN check")).toBeTruthy();
  expect(mockCalls.some(([u]) => u === "/api/admin/tradeai/suggest")).toBe(true);
});

test("opening a saved chat shows the rich answer: table, key numbers, forecast, actions and related questions", async () => {
  render(page());
  await settle();
  fireEvent.click(screen.getByText("SBIN check"));
  await settle();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByText("+₹240").className).toMatch(/is-up/);
  expect(screen.getByText(/Leans up/)).toBeTruthy();
  expect(screen.getByText("Keep the stop at 799.")).toBeTruthy();
  expect(screen.getByText("Where should I trail my stop on SBIN?")).toBeTruthy();
  expect(screen.getByText(/merged by A/)).toBeTruthy();
  expect(window.location.search).toBe("?c=abc123abc123");
});

test("searching chats asks the database with the words typed", async () => {
  render(page());
  await settle();
  fireEvent.change(screen.getByLabelText("Search chats"), { target: { value: "vwap" } });
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/tradeai/convs?q=vwap")).toBe(true);
});

test("the answer mode goes with the question, and the instant chips ask at once", async () => {
  window.localStorage.removeItem("tai.mode");
  render(page());
  await settle();
  expect(screen.getByText("⚡ Instant")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Deep/ }));
  fireEvent.click(screen.getByText("Show my positions"));
  await settle();
  const ask = mockCalls.find(([u, m]) => u === "/api/admin/tradeai/ask" && m === "POST");
  expect(ask).toBeTruthy();
  expect(ask[2]).toMatchObject({ text: "Show my positions", mode: "deep" });
  expect(JSON.parse(window.localStorage.getItem("tai.mode"))).toBe("deep");
});

/* ------------------------------------------------------------------ attachments (26 Nov 2026) */
const upload = (answer = { id: "a1", kind: "text", name: "plan.csv", chars: 20 }, ok = true) => {
  const calls = [];
  window.fetch = jest.fn((url, init) => {
    calls.push([url, init && init.method, init && init.body]);
    if (init && init.method === "DELETE") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return Promise.resolve(ok ? { ok: true, json: async () => ({ file: answer }) } : { ok: false, status: 415, json: async () => ({ message: "old.pdf is a PDF, which is not read yet." }) });
  });
  return calls;
};
const box = () => document.querySelector(".tai-comp textarea");

test("the question box is free: no length cap of 1500, room for 4000, and an attach button", async () => {
  render(page());
  await settle();
  expect(box().maxLength).toBe(4000);
  expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
  expect(box().placeholder).toMatch(/attach a file/);
});

test("a file chosen with the paperclip is read by the server, shown as a chip, and goes with the question by its id", async () => {
  const calls = upload();
  render(page());
  await settle();
  const input = document.querySelector('.tai-comp input[type="file"]');
  expect(input.accept).toMatch(/\.docx/);
  expect(input.accept).toMatch(/\.xlsx/);
  expect(input.accept).toMatch(/\.csv/);
  fireEvent.change(input, { target: { files: [new File(["symbol,qty\nSBIN,40"], "plan.csv", { type: "text/csv" })] } });
  await settle();
  expect(calls[0][0]).toBe("/api/admin/tradeai/attach?name=plan.csv");
  expect(calls[0][1]).toBe("POST");
  const chip = document.querySelector(".tai-file");
  expect(chip.textContent).toMatch(/plan\.csv/);
  expect(chip.textContent).toMatch(/20 characters/);
  // a file alone is a question
  const send = screen.getByRole("button", { name: "Send" });
  expect(send.disabled).toBe(false);
  fireEvent.change(box(), { target: { value: "What do you make of this?" } });
  fireEvent.click(send);
  await settle();
  const ask = mockCalls.find(([u, m]) => u === "/api/admin/tradeai/ask" && m === "POST");
  expect(ask[2].attachments).toEqual(["a1"]);
  expect(ask[2].text).toBe("What do you make of this?");
  expect(document.querySelector(".tai-comp .tai-file")).toBeNull(); // the chips left with the question
  expect(document.querySelector(".tai-qfiles").textContent).toMatch(/plan\.csv/);
});

test("send waits for a file still being read, and a file alone (no words) can be sent", async () => {
  let release;
  window.fetch = jest.fn(() => new Promise((res) => (release = () => res({ ok: true, json: async () => ({ file: { id: "z9", kind: "text", name: "n.txt", chars: 5 } }) }))));
  render(page());
  await settle();
  fireEvent.change(document.querySelector('.tai-comp input[type="file"]'), { target: { files: [new File(["hello"], "n.txt", { type: "text/plain" })] } });
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  expect(document.querySelector(".tai-file").textContent).toMatch(/Reading…/);
  expect(screen.getByRole("button", { name: /Send|Reading your files/ }).disabled).toBe(true);
  await act(async () => {
    release();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(screen.getByRole("button", { name: "Send" }).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await settle();
  const ask = mockCalls.find(([u, m]) => u === "/api/admin/tradeai/ask" && m === "POST");
  expect(ask[2].text).toBe("");
  expect(ask[2].attachments).toEqual(["z9"]);
});

test("a file the server will not read says why on its chip and is not sent; it can be taken off", async () => {
  const calls = upload(null, false);
  render(page());
  await settle();
  fireEvent.change(document.querySelector('.tai-comp input[type="file"]'), { target: { files: [new File(["%PDF-1.7"], "old.pdf", { type: "application/pdf" })] } });
  await settle();
  const chip = document.querySelector(".tai-file");
  expect(chip.className).toMatch(/is-err/);
  expect(chip.textContent).toMatch(/PDF, which is not read yet/);
  expect(screen.getByRole("button", { name: "Send" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove old.pdf" }));
  expect(document.querySelector(".tai-file")).toBeNull();
  expect(calls.filter((c) => c[1] === "DELETE").length).toBe(0); // nothing was kept on the server
});

test("a screenshot pasted from the clipboard becomes a picture; a very long pasted text becomes a file", async () => {
  const calls = upload({ id: "p1", kind: "image", name: "x", bytes: 3000 });
  render(page());
  await settle();
  const shot = new File([new Uint8Array(30)], "image.png", { type: "image/png" });
  fireEvent.paste(box(), { clipboardData: { files: [shot], getData: () => "" } });
  await settle();
  expect(calls[0][0]).toMatch(/\/attach\?name=pasted-image-\d{6}\.png$/);
  expect(document.querySelector(".tai-file").textContent).toMatch(/Picture/);
  const long = "line of notes\n".repeat(400);
  fireEvent.paste(box(), { clipboardData: { files: [], getData: () => long } });
  await settle();
  expect(calls[1][0]).toBe("/api/admin/tradeai/attach?name=pasted-text.txt");
  expect(box().value).toBe("");
  // a short paste is just text
  fireEvent.paste(box(), { clipboardData: { files: [], getData: () => "SBIN 800" } });
  await settle();
  expect(calls.length).toBe(2);
});

test("files dropped on the box are attached, with a hint while they hover", async () => {
  const calls = upload({ id: "d1", kind: "text", name: "sheet.xlsx", chars: 80 });
  render(page());
  await settle();
  const form = document.querySelector(".tai-comp");
  const dt = { types: ["Files"], files: [new File(["x"], "sheet.xlsx")] };
  fireEvent.dragEnter(form, { dataTransfer: dt });
  expect(document.querySelector(".tai-drop").textContent).toMatch(/Drop to attach/);
  fireEvent.drop(form, { dataTransfer: dt });
  await settle();
  expect(document.querySelector(".tai-drop")).toBeNull();
  expect(calls[0][0]).toBe("/api/admin/tradeai/attach?name=sheet.xlsx");
});

test("the box grows with what is typed: its height follows the text", async () => {
  render(page());
  await settle();
  const el = box();
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 150 });
  fireEvent.change(el, { target: { value: "a\nb\nc\nd\ne" } });
  expect(el.style.height).toBe("150px");
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 2000 });
  fireEvent.change(el, { target: { value: "x".repeat(10) } });
  expect(parseInt(el.style.height, 10)).toBeLessThanOrEqual(340); // then it scrolls inside
  expect(el.style.overflowY).toBe("auto");
});
