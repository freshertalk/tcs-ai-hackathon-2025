import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthContext } from "../auth";
import { TempleProvider } from "./Temple";
import TempleCard from "./TempleCard";

const mockCalls = [];
const LIB = [
  { id: "aaaaaaaaaaa1", label: "Hanuman Chalisa", mime: "audio/mpeg", kind: "audio", size: 4000000 },
  { id: "bbbbbbbbbbb2", label: "Sundar Kand", mime: "video/mp4", kind: "video", size: 9000000 },
  { id: "ccccccccccc3", label: "Bajrang Baan", mime: "audio/mpeg", kind: "audio", size: 3000000 },
];
let mockSettings;
jest.mock("../api", () => ({
  api: (url, opts = {}) => {
    mockCalls.push([url, opts.method || "GET", opts.body]);
    if (url === "/api/admin/temple" && opts.method === "PUT") {
      mockSettings = { ...mockSettings, ...opts.body };
      return Promise.resolve(mockSettings);
    }
    if (url === "/api/admin/temple") return Promise.resolve(mockSettings);
    return Promise.resolve(mockSettings);
  },
}));
jest.mock("../dialog/DialogProvider", () => ({ useDialog: () => async () => true }));

let media = null;
const realCreate = document.createElement.bind(document);
beforeEach(() => {
  mockCalls.length = 0;
  window.localStorage.clear();
  mockSettings = { source: { kind: "library", label: "Hanuman Chalisa" }, volume: 0.05, autoplay: false, auto: true, library: LIB, usedBytes: 16000000, limits: { maxFile: 200 * 1024 * 1024, maxTotal: 2 * 1024 * 1024 * 1024, maxItems: 60 } };
  jest.spyOn(document, "createElement").mockImplementation((tag, o) => {
    const el = realCreate(tag, o);
    if (tag === "video") {
      el.play = jest.fn(() => Promise.resolve());
      el.pause = jest.fn();
      media = el;
    }
    return el;
  });
});
afterEach(() => jest.restoreAllMocks());

const page = (role = "superadmin") => (
  <AuthContext.Provider value={{ loading: false, user: { email: "o@example.com", name: "Owner", role }, reload() {} }}>
    <div className="adm">
      <TempleProvider>
        <TempleCard />
      </TempleProvider>
    </div>
  </AuthContext.Provider>
);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));

test("the list shows every uploaded file, with Auto ON, and files can be added several at a time", async () => {
  render(page());
  await settle();
  expect(screen.getAllByRole("button", { name: /^Play / }).length).toBe(3);
  const sw = screen.getByRole("switch");
  expect(sw.getAttribute("aria-checked")).toBe("true");
  expect(sw.textContent).toMatch(/Auto ON/);
  const input = document.querySelector('.mdr-add input[type="file"]');
  expect(input.multiple).toBe(true);
  expect(input.accept).toMatch(/video\/\*/);
  expect(screen.getByText(/file 1 of 3/)).toBeTruthy();
});

test("Auto ON: when a file ends, the next one is set and played; after the last, the first", async () => {
  render(page());
  await settle();
  expect(media.getAttribute("src")).toMatch(/aaaaaaaaaaa1$/);
  expect(media.loop).toBe(false);
  await act(async () => {
    media.dispatchEvent(new Event("ended"));
  });
  await settle();
  expect(media.getAttribute("src")).toMatch(/bbbbbbbbbbb2$/);
  expect(media.play).toHaveBeenCalled();
  expect(screen.getByText(/file 2 of 3/)).toBeTruthy();
  expect(screen.getByText("Show video")).toBeTruthy(); // the second file is a video
  await act(async () => {
    media.dispatchEvent(new Event("ended"));
  });
  await settle();
  await act(async () => {
    media.dispatchEvent(new Event("ended"));
  });
  await settle();
  expect(media.getAttribute("src")).toMatch(/aaaaaaaaaaa1$/);
});

test("Auto OFF repeats the file playing; the owner's switch is saved on the server", async () => {
  render(page());
  await settle();
  fireEvent.click(screen.getByRole("switch"));
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/temple" && m === "PUT" && b && b.auto === false)).toBe(true);
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  expect(media.loop).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next file" }));
  await settle();
  expect(media.getAttribute("src")).toMatch(/bbbbbbbbbbb2$/);
});

test("an admin's Auto choice stays on their own device; they cannot add or remove files", async () => {
  render(page("admin"));
  await settle();
  fireEvent.click(screen.getByRole("switch"));
  await settle();
  expect(mockCalls.some(([, m]) => m === "PUT")).toBe(false);
  expect(window.localStorage.getItem("vpt.temple.auto")).toBe("0");
  expect(document.querySelector(".mdr-add")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
});
