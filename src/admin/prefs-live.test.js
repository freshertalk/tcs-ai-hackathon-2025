// Hide amounts, live everywhere (24 Nov 2026): a switch flipped in another tab or on another device reaches this page
// without a refresh, and pressing it twice quickly never flips back.
import React from "react";
import { act, render } from "@testing-library/react";
import { api } from "./api";
import { PrefsProvider, usePrefs, fillPrefs } from "./prefs";

jest.mock("./api", () => ({ api: jest.fn() }));
let announce = null;
jest.mock("./live", () => ({
  useTopics: (topics, fn) => {
    if (topics && topics.includes("prefs")) announce = fn;
  },
}));

let server = null;
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const root = () => document.querySelector(".adm");

function Switch() {
  const { prefs, save } = usePrefs();
  return (
    <button type="button" onClick={() => save({ privacy: !prefs.privacy })}>
      {prefs.privacy ? "on" : "off"}
    </button>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  announce = null;
  server = fillPrefs({ privacy: false });
  api.mockImplementation((url, opts = {}) => {
    if (opts.method === "PUT") {
      server = fillPrefs({ ...server, ...opts.body });
      return Promise.resolve({ prefs: server });
    }
    return Promise.resolve({ prefs: server, stored: true, options: {} });
  });
  document.body.innerHTML = "";
});

const mount = () => {
  const host = document.createElement("div");
  host.className = "adm";
  document.body.appendChild(host);
  return render(
    <PrefsProvider enabled>
      <Switch />
    </PrefsProvider>,
    { container: host }
  );
};

test("another tab of this browser flips the switch: this page follows at once", async () => {
  mount();
  await flush();
  expect(root().getAttribute("data-privacy")).toBe("off");
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "vpt.prefs", newValue: JSON.stringify(fillPrefs({ privacy: true })) }));
  });
  expect(root().getAttribute("data-privacy")).toBe("on");
  expect(document.querySelector("button").textContent).toBe("on");
  // someone else's key is not ours to read
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "{}" }));
  });
  expect(root().getAttribute("data-privacy")).toBe("on");
});

test("another device flips it: the live channel's announcement makes this page read it again", async () => {
  mount();
  await flush();
  expect(typeof announce).toBe("function");
  server = fillPrefs({ privacy: true });
  await act(async () => {
    announce();
  });
  await flush();
  expect(root().getAttribute("data-privacy")).toBe("on");
});

test("this page flips it: on screen the same moment, before the server answers; two quick presses never flip back", async () => {
  mount();
  await flush();
  const pending = [];
  api.mockImplementation((url, opts = {}) => {
    if (opts.method === "PUT") return new Promise((res) => pending.push(() => res({ prefs: fillPrefs({ ...server, ...opts.body }) })));
    return Promise.resolve({ prefs: server, stored: true });
  });
  const btn = document.querySelector("button");
  act(() => btn.click());
  expect(root().getAttribute("data-privacy")).toBe("on"); // no wait for the server
  act(() => btn.click());
  expect(root().getAttribute("data-privacy")).toBe("off");
  // an announcement while both are on their way waits for them (the server may still hold the old state)
  server = fillPrefs({ privacy: true });
  await act(async () => announce());
  expect(root().getAttribute("data-privacy")).toBe("off");
  // the first press's answer arrives late: it does not put "on" back
  await act(async () => pending[0]());
  await flush();
  expect(root().getAttribute("data-privacy")).toBe("off");
  server = fillPrefs({ privacy: false });
  await act(async () => pending[1]());
  await flush();
  expect(root().getAttribute("data-privacy")).toBe("off");
});
