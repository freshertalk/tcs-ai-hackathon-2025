import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AiSettings from "./AiSettings";

const MODELS = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Default — fast and strong" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Deeper reasoning" },
];
const NV_MODELS = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B" },
  { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];
const provider = (id, name, extra = {}) => ({ id, name, family: name, configured: false, keyHint: "", model: "", models: [], listedAt: null, lastTest: null, search: true, keyExample: "sk-…", console: "console", consoleUrl: "https://example.com", steps: ["Sign in."], ...extra });
const status = (model) => ({
  configured: true,
  provider: "anthropic",
  providerName: "Anthropic",
  keyHint: "sk-ant-…abcd",
  model,
  modelName: MODELS.find((m) => m.id === model).name,
  models: MODELS,
  providers: [provider("nvidia", "NVIDIA", { free: true, search: false, model: "nvidia/nemotron-3-ultra-550b-a55b", models: NV_MODELS }), provider("anthropic", "Anthropic", { configured: true, keyHint: "sk-ant-…abcd", model, models: MODELS }), provider("openai", "OpenAI", { configured: true, model: "gpt-5.6-sol", models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }] }), provider("deepseek", "DeepSeek", { search: false })],
  names: {},
  searchBy: "anthropic",
  searchByName: "Anthropic",
  defaultModel: { provider: "anthropic", model, name: MODELS.find((m) => m.id === model).name, company: "Anthropic", ready: true },
  recommended: { provider: "anthropic", model: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  fallback: true,
  chain: [
    { provider: "anthropic", model, name: MODELS.find((m) => m.id === model).name, company: "Anthropic" },
    { provider: "openai", model: "gpt-5.6-sol", name: "GPT-5.6 Sol", company: "OpenAI" },
  ],
  lastTest: null,
  live: null,
  version: 3,
  setup: { done: false, freeConfigured: false, freeLead: false, primary: { model: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B" }, backup: null, fallbackProvider: "anthropic", fallbackName: "Anthropic", fallbackModel: "claude-sonnet-5-5", fallbackModelName: "Claude Sonnet 5.5", fallbackReady: true, freeAuto: true },
});
const freeStatus = () => ({
  ...status("claude-sonnet-5-5"),
  provider: "nvidia",
  providerName: "NVIDIA",
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  modelName: "Nemotron 3 Ultra 550B",
  defaultModel: { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B", company: "NVIDIA", ready: true, free: true },
  chain: [
    { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B", company: "NVIDIA", free: true },
    { provider: "nvidia", model: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro", company: "NVIDIA", free: true },
    { provider: "anthropic", model: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", company: "Anthropic", free: false },
  ],
  setup: { done: true, at: "2026-11-26T05:00:00Z", freeConfigured: true, freeLead: true, primary: { model: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B" }, backup: { model: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" }, fallbackProvider: "anthropic", fallbackName: "Anthropic", fallbackModel: "claude-sonnet-5-5", fallbackModelName: "Claude Sonnet 5.5", fallbackReady: true, freeAuto: true },
});
let mockStatus;
const mockCalls = [];
jest.mock("./api", () => ({
  api: (url, opts = {}) => {
    mockCalls.push([url, opts.method || "GET", opts.body]);
    if (url === "/api/admin/ai/settings" && opts.method === "PUT") {
      const b = opts.body || {};
      if (b.model) mockStatus = status(b.model);
      if (typeof b.fallback === "boolean") mockStatus = { ...mockStatus, fallback: b.fallback };
      if (b.fallbackProvider) mockStatus = { ...mockStatus, setup: { ...mockStatus.setup, fallbackProvider: b.fallbackProvider, fallbackName: b.fallbackProvider === "openai" ? "OpenAI" : "Anthropic" } };
      if (typeof b.freeAuto === "boolean") mockStatus = { ...mockStatus, setup: { ...mockStatus.setup, freeAuto: b.freeAuto } };
    }
    if (url === "/api/admin/ai/setup-free") mockStatus = freeStatus();
    return Promise.resolve(mockStatus);
  },
}));
jest.mock("./Shell", () => ({ children }) => <div>{children}</div>);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
beforeEach(() => {
  mockCalls.length = 0;
});

test("the default model: Claude Sonnet 5.5, marked recommended, with the fallback order", async () => {
  mockStatus = status("claude-sonnet-5-5");
  render(<AiSettings />);
  await settle();
  expect(screen.getByRole("heading", { name: "Default model" })).toBeTruthy();
  expect(screen.getByText("Recommended default")).toBeTruthy();
  expect(screen.getByText(/used by every AI feature/)).toBeTruthy();
  expect(screen.getByText(/Order now: Claude Sonnet 5.5 \(Anthropic\) → GPT-5.6 Sol \(OpenAI\)/)).toBeTruthy();
  expect(screen.getByRole("option", { name: "Claude Sonnet 5.5 (recommended)" })).toBeTruthy();
});

test("another default model can be picked, and one click goes back to Sonnet 5.5", async () => {
  mockStatus = status("claude-sonnet-5-5");
  render(<AiSettings />);
  await settle();
  fireEvent.change(document.getElementById("ai-model"), { target: { value: "claude-opus-5-5" } });
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/ai/settings" && m === "PUT" && b.provider === "anthropic" && b.model === "claude-opus-5-5")).toBe(true);
  const back = screen.getByRole("button", { name: "Back to Claude Sonnet 5.5" });
  fireEvent.click(back);
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/ai/settings" && m === "PUT" && b.model === "claude-sonnet-5-5")).toBe(true);
  expect(screen.getByText("Recommended default")).toBeTruthy();
});

test("the fallback switch is saved", async () => {
  mockStatus = status("claude-sonnet-5-5");
  render(<AiSettings />);
  await settle();
  fireEvent.click(screen.getByRole("checkbox", { name: /Fallback/ }));
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/ai/settings" && m === "PUT" && b.fallback === false)).toBe(true);
});

test("before the one-time setup: one NVIDIA key and a paid fallback company; nothing is sent without a key", async () => {
  mockStatus = status("claude-sonnet-5-5");
  render(<AiSettings />);
  await settle();
  expect(screen.getByRole("heading", { name: "Free models first · paid only for the rest" })).toBeTruthy();
  const go = screen.getByRole("button", { name: "Set up the free models" });
  expect(go.disabled).toBe(true);
  fireEvent.change(document.getElementById("nv-key"), { target: { value: "nvapi-TESTONLYtestonlyTESTONLY1234567890" } });
  fireEvent.change(document.getElementById("nv-fallback"), { target: { value: "openai" } });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Set up the free models" }));
  await settle();
  const post = mockCalls.find(([u, m]) => u === "/api/admin/ai/setup-free" && m === "POST");
  expect(post[2]).toEqual({ apiKey: "nvapi-TESTONLYtestonlyTESTONLY1234567890", fallbackProvider: "openai" });
  // the answer: the route is shown, in order, free first
  expect([...document.querySelectorAll(".ais-route li b")].map((b) => b.textContent)).toEqual(["Nemotron 3 Ultra 550B", "DeepSeek V4 Pro", "Claude Sonnet 5.5"]);
  expect(screen.getByText(/NVIDIA · free · answers first/)).toBeTruthy();
  expect(screen.getByText(/Anthropic · paid · web search, and when both free models fail/)).toBeTruthy();
  expect(screen.getByText(/Done\. Nemotron 3 Ultra 550B is the default/)).toBeTruthy();
});

test("after the setup: the paid fallback company, the free allowance and choosing again are saved", async () => {
  mockStatus = freeStatus();
  render(<AiSettings />);
  await settle();
  expect(document.querySelectorAll(".ais-route li").length).toBe(3);
  expect(screen.getByText(/Order now: Nemotron 3 Ultra 550B \(NVIDIA\) → DeepSeek V4 Pro \(NVIDIA\) → Claude Sonnet 5.5 \(Anthropic\)/)).toBeTruthy();
  fireEvent.change(document.getElementById("ai-fallback-co"), { target: { value: "openai" } });
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/ai/settings" && m === "PUT" && b.fallbackProvider === "openai")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Let the free models work on their own/ }));
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/ai/settings" && m === "PUT" && b.freeAuto === false)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Choose the best again" }));
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/ai/setup-free" && m === "POST" && b.fallbackProvider === "openai")).toBe(true);
  // a paid fallback without a key is said, with the way to add it
});

test("a paid fallback with no key is said, with the way to add it", async () => {
  mockStatus = freeStatus();
  mockStatus.setup = { ...mockStatus.setup, fallbackProvider: "deepseek", fallbackName: "DeepSeek", fallbackModelName: "DeepSeek V4 Pro", fallbackReady: false };
  render(<AiSettings />);
  await settle();
  expect(screen.getByText(/The paid fallback has no key yet/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add the DeepSeek key" })).toBeTruthy();
});
