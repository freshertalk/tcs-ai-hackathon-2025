import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AiSettings from "./AiSettings";

const MODELS = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Default — fast and strong" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Deeper reasoning" },
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
  providers: [provider("anthropic", "Anthropic", { configured: true, keyHint: "sk-ant-…abcd", model, models: MODELS }), provider("openai", "OpenAI", { configured: true, model: "gpt-5.6-sol", models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }] }), provider("deepseek", "DeepSeek", { search: false })],
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
    }
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
  expect(screen.queryByText(/NVIDIA|FREE/)).toBeNull();
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
