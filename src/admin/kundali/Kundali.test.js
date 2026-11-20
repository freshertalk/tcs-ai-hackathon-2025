import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Kundali from "./Kundali";

const mockApi = jest.fn();
const mockAsk = jest.fn();
jest.mock("../api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("../dialog/DialogProvider", () => ({ useDialog: () => mockAsk }));
jest.mock("../stock/analyzer/theme", () => ({ useDeskTheme: () => ["dark", () => {}] }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});

// A made-up chart (nobody's): Aries rising, the Moon's period running at birth.
const chart = () => ({
  version: 1,
  person: { name: "परीक्षण कुमार" },
  source: { name: "हस्तलिखित पत्रिका", pages: 4, printed: "2001", ayanamsa: "लाहिरी", note: "अंक पत्रिका से लिए गए हैं।" },
  birth: { ymd: [1985, 3, 14], time: "06:00", rows: [["जन्म तिथि", "14 मार्च 1985"], ["जन्म स्थान", "कहीं"]] },
  panchang: [["तिथि", "कृष्ण अष्टमी"]],
  avakhada: [["गण", "देव"]],
  lagna: { sign: 1, deg: "10°00′", nak: "अश्विनी", pada: 4, lord: "मंगल" },
  planets: [
    { id: "su", sign: 12, deg: "00°10′", nak: "पूर्वा भाद्रपद", pada: 4, house: 12, state: "मित्र राशि", lords: "गुरु / गुरु", note: "" },
    { id: "mo", sign: 8, deg: "05°00′", nak: "अनुराधा", pada: 1, house: 8, state: "नीच", lords: "मंगल / शनि", note: "" },
    { id: "ma", sign: 1, deg: "20°00′", nak: "भरणी", pada: 3, house: 1, state: "स्वराशि", lords: "मंगल / शुक्र", note: "लग्नेश" },
    { id: "me", sign: 11, deg: "12°00′", nak: "शतभिषा", pada: 2, house: 11, state: "सम", lords: "शनि / राहु", note: "" },
    { id: "ju", sign: 10, deg: "15°00′", nak: "श्रवण", pada: 2, house: 10, state: "नीच", combust: true, lords: "शनि / चंद्र", note: "" },
    { id: "ve", sign: 1, deg: "02°00′", nak: "अश्विनी", pada: 1, house: 1, state: "सम", lords: "मंगल / केतु", note: "" },
    { id: "sa", sign: 8, deg: "03°00′", nak: "विशाखा", pada: 4, house: 8, state: "शत्रु", retro: true, lords: "मंगल / गुरु", note: "" },
    { id: "ra", sign: 1, deg: "25°00′", nak: "भरणी", pada: 4, house: 1, state: "—", retro: true, lords: "मंगल / शुक्र", note: "" },
    { id: "ke", sign: 7, deg: "25°00′", nak: "विशाखा", pada: 2, house: 7, state: "—", retro: true, lords: "शुक्र / गुरु", note: "" },
  ],
  charts: [{ id: "D1", title: "लग्न कुंडली", sub: "राशि चक्र", lagna: 1, at: { su: 12, mo: 8, ma: 1, me: 11, ju: 10, ve: 1, sa: 8, ra: 1, ke: 7 }, note: "यह केवल परीक्षण है।" }],
  vargas: { cols: ["लग्न", "सू"], rows: [["D1 राशि", 1, 12]], note: "" },
  summary: [{ k: "लग्न", v: "मेष", d: "स्वामी मंगल" }],
  keyPoints: ["लग्नेश लग्न में है।"],
  houses: [{ n: 1, sign: 1, lord: "मंगल", lordIn: "लग्न", has: "मंगल, शुक्र, राहु", sav: 30, bala: 8, rank: 1, text: "लग्न बली है।" }],
  housesNote: "बिंदु = सर्वाष्टकवर्ग।",
  shadbala: { rows: [{ id: "ma", rupa: 8, need: 5, ratio: 1.6 }], note: "मंगल बली।" },
  yogas: [{ name: "रुचक योग", from: "मेरी जाँच", basis: "मंगल स्वराशि में लग्न में।", effect: "साहस।" }],
  dasha: { system: "विंशोत्तरी", first: "mo", balance: [6, 3, 10], birth: [1985, 3, 14], notes: { ra: "राहु की बात।" }, reading: ["दशा का सार।"] },
  sadesati: { rows: [["ढैया", "2025 – 2027", "चल रही है"]], note: "धैर्य रखें।" },
  analysis: [{ id: "trading", title: "ट्रेडिंग पर विचार", paras: ["पहला अनुच्छेद।"], points: ["नियम से चलें।"], after: ["कोई गारंटी नहीं।"] }],
  colours: { intro: "रंग का नियम।", rows: [{ planet: "मंगल", role: "लग्नेश", colours: "लाल", swatches: ["#7a1f2b"], verdict: "शुभ" }, { planet: "शनि", role: "शत्रु", colours: "काला", swatches: ["#000000"], verdict: "प्रमुख न रखें" }], site: [{ name: "स्वर्ण", hex: "#e9b44c", use: "कार्य-रंग", why: "सूर्य" }], notes: ["रंग बाज़ार का भाव नहीं बदलते।"] },
  remedies: [{ planet: "मंगल", why: "लग्नेश", items: ["हनुमान चालीसा"], mantra: "ॐ क्रां क्रीं क्रौं सः भौमाय नमः", ratna: "मूँगा" }],
  remediesNote: "रत्न परामर्श के बाद ही।",
  favourable: [["शुभ वार", "मंगलवार"]],
  ghat: [["घात वार", "शनिवार"]],
  numerology: { rows: [["मूलांक", "5"]], note: "अंक ज्योतिष अलग पद्धति है।" },
  cautions: [{ title: "जन्म समय जाँचें", text: "समय में पाँच मिनट का अंतर लग्न बदल सकता है।" }],
});
const paper = { id: "abc123abc123", label: "बृहत् कुंडली", mime: "application/pdf", kind: "pdf", size: 5149150, uploadedAt: "2026-11-20T10:00:00.000Z", by: "owner@example.com" };
const view = (over = {}) => ({ chart: chart(), chartAt: "2026-11-20T10:00:00.000Z", chartBy: "owner@example.com", documents: [paper], limits: { maxFile: 60 * 1024 * 1024, maxItems: 24, maxPart: 2.5 * 1024 * 1024, maxChart: 600 * 1024 }, ...over });

beforeEach(() => {
  mockApi.mockReset();
  mockAsk.mockReset();
  global.fetch = jest.fn();
  global.URL.createObjectURL = jest.fn(() => "blob:paper");
  global.URL.revokeObjectURL = jest.fn();
  // the upload's id is sixteen random hex digits (this test browser has no crypto of its own)
  if (!window.crypto || !window.crypto.getRandomValues) Object.defineProperty(window, "crypto", { configurable: true, value: { getRandomValues: (a) => a.map((_, i) => (i * 37 + 11) % 256) } });
  // 1 February 2013: in the made-up chart, Rahu's great period, the Sun's sub-period, the Moon's sub-sub-period
  jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2013, 1, 1, 6, 0));
});
afterEach(() => jest.restoreAllMocks());

test("the page is in Hindi: the chart at a glance, what runs today, the charts, planets, houses, yogas, reading, colours and remedies", async () => {
  mockApi.mockResolvedValue(view());
  const { container } = render(<Kundali />);
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "परीक्षण कुमार" })).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/kundali");
  expect(container.querySelector(".kd").getAttribute("lang")).toBe("hi");
  expect(document.title).toBe("जन्म कुंडली");
  expect(document.documentElement.lang).toBe("hi");
  expect(screen.getByText(/लग्न मेष 10°00′ · अश्विनी चरण 4/)).toBeTruthy();
  // the way back, and the sections of the page
  expect(screen.getByText("मेरा क्षेत्र").closest("a").getAttribute("href")).toBe("/me");
  expect([...container.querySelectorAll(".kd-jump a")].map((a) => a.textContent)).toEqual(["सार", "जन्म विवरण", "कुंडलियाँ", "ग्रह", "भाव", "योग", "दशा", "विश्लेषण", "शुभ रंग", "उपाय", "जाँचें", "दस्तावेज़"]);

  // today's dasha, worked out from the chart's starting point
  const now = [...container.querySelector(".kd-hero .kd-now").querySelectorAll(".kd-now__p")].map((p) => p.textContent);
  expect(now[0]).toMatch(/महादशाराहु24 जून 1998 – 24 जून 2016/);
  expect(now[1]).toMatch(/अंतर्दशासूर्य12 जनवरी 2013 – 6 दिसंबर 2013/);
  expect(now[2]).toMatch(/प्रत्यंतरचंद्र29 जनवरी 2013 – 26 फ़रवरी 2013/);

  // the chart, drawn: the ascendant's sign in the first house, each planet in its house, retrograde and combust marked
  const svg = container.querySelector(".kd-chart");
  expect(svg.getAttribute("aria-label")).toMatch(/^लग्न कुंडली। लग्न मेष। 1 \(मेष\): मंगल, शुक्र, राहु; 7 \(तुला\): केतु; 8 \(वृश्चिक\): चंद्र, शनि; 10 \(मकर\): गुरु; 11 \(कुंभ\): बुध; 12 \(मीन\): सूर्य$/);
  expect(svg.querySelector(".kd-chart__sign.is-lagna").textContent).toBe("1");
  expect(svg.querySelector(".kd-p--sa").textContent).toMatch(/श\s*व/);
  expect(svg.querySelector(".kd-p--ju").textContent).toMatch(/गु\s*अ/);
  // Rahu and Ketu always move backwards, so they carry no mark
  expect(svg.querySelector(".kd-p--ra").textContent.trim()).toBe("रा");

  // the planets' table
  const mars = [...container.querySelectorAll("#kd-grah tbody tr")].find((tr) => tr.querySelector("th").textContent.startsWith("मंगल"));
  expect([...mars.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["मेष", "20°00′", "भरणी · 3", "प्रथम", "स्वराशि", "मंगल / शुक्र", "लग्नेश"]);
  expect([...container.querySelectorAll("#kd-grah tbody tr")].find((tr) => tr.querySelector("th").textContent.startsWith("शनि")).textContent).toMatch(/^शनिवक्री/);
  expect([...container.querySelectorAll("#kd-grah tbody tr")].find((tr) => tr.querySelector("th").textContent.startsWith("गुरु")).textContent).toMatch(/^गुरुअस्त/);
  // houses, yogas, the reading, the colours with their reasons, remedies, what to check
  expect(screen.getByText("लग्न (तनु)")).toBeTruthy();
  expect(screen.getByText("रुचक योग")).toBeTruthy();
  expect(container.querySelector(".kd-prose--key").textContent).toMatch(/ट्रेडिंग पर विचारपहला अनुच्छेद।नियम से चलें।कोई गारंटी नहीं।/);
  expect(screen.getByText("रंग बाज़ार का भाव नहीं बदलते।")).toBeTruthy();
  expect(container.querySelector(".kd-chip--off").textContent).toBe("प्रमुख न रखें");
  expect(screen.getByText("ॐ क्रां क्रीं क्रौं सः भौमाय नमः")).toBeTruthy();
  expect(screen.getByText("जन्म समय जाँचें")).toBeTruthy();
  // not a word of the interface is in English
  const words = container.querySelector(".kd-main").textContent.replace(/PDF|MB|KB|D1|#[0-9a-f]{6}/gi, "");
  expect(words).not.toMatch(/[A-Za-z]{3,}/);
});

test("the dasha can be opened: a great period shows its sub-periods, a sub-period its parts; what runs today is marked", async () => {
  mockApi.mockResolvedValue(view());
  const { container } = render(<Kundali />);
  await waitFor(() => expect(container.querySelector("#kd-dasha .kd-md")).toBeTruthy());
  const sec = container.querySelector("#kd-dasha");
  const md = () => [...sec.querySelectorAll(".kd-md li")];
  expect(md().map((li) => li.querySelector("b").textContent)).toEqual(["चंद्र", "मंगल", "राहु", "गुरु", "शनि", "बुध", "केतु", "शुक्र", "सूर्य"]);
  expect(md()[0].textContent).toMatch(/जन्म – 24 जून 1991जन्म पर शेष 6 वर्ष 3 माह 10 दिन · आयु 0–6/);
  expect(md().find((li) => li.className.includes("is-now")).textContent).toMatch(/राहु24 जून 1998 – 24 जून 201618 वर्ष · आयु 13–31 · अभी/);
  // the running great period is open by itself, with its own note, and the running sub-period's parts beside it
  expect(sec.textContent).toMatch(/राहु महादशा की अंतर्दशाएँराहु की बात।/);
  expect(sec.querySelector(".kd-ad li.is-now").textContent).toMatch(/राहु–सूर्य12 जनवरी 2013 – 6 दिसंबर 2013/);
  expect(sec.textContent).toMatch(/राहु–सूर्य के प्रत्यंतर/);
  expect(sec.querySelector(".kd-ad--pd li.is-now").textContent).toMatch(/चंद्र29 जनवरी 2013 – 26 फ़रवरी 2013/);
  // another great period, then one of its sub-periods
  fireEvent.click(md()[3].querySelector("button"));
  expect(sec.textContent).toMatch(/गुरु महादशा की अंतर्दशाएँ/);
  expect(sec.querySelector(".kd-ad li.is-now")).toBeNull();
  expect(sec.textContent).toMatch(/किसी अंतर्दशा को चुनें/);
  fireEvent.click([...sec.querySelectorAll(".kd-ad:not(.kd-ad--pd) button")][1]);
  expect(sec.textContent).toMatch(/गुरु–शनि के प्रत्यंतर/);
  expect(sec.querySelectorAll(".kd-ad--pd li").length).toBe(9);
});

test("the stored paper can be read on the page, opened in a tab, downloaded, renamed and removed (asked first)", async () => {
  mockApi.mockImplementation((url, opts) => {
    if (opts && opts.method === "PUT") return Promise.resolve(view({ documents: [{ ...paper, label: opts.body.label }] }));
    if (opts && opts.method === "DELETE") return Promise.resolve(view({ documents: [] }));
    return Promise.resolve(view());
  });
  global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["%PDF-"], { type: "application/pdf" })) });
  const { container } = render(<Kundali />);
  await waitFor(() => expect(screen.getByText("बृहत् कुंडली")).toBeTruthy());
  const li = container.querySelector(".kd-papers li");
  expect(li.textContent).toMatch(/4\.9 MB · 20 नवंबर 2026 को रखा गया/);
  expect(screen.getByText("नई टैब में खोलें").getAttribute("href")).toBe("/api/admin/kundali/documents/abc123abc123");
  expect(screen.getByText("नई टैब में खोलें").getAttribute("target")).toBe("_blank");
  const dl = screen.getByText("डाउनलोड");
  expect([dl.getAttribute("href"), dl.hasAttribute("download")]).toEqual(["/api/admin/kundali/documents/abc123abc123?download=1", true]);

  // read here: fetched with the session, shown from memory
  fireEvent.click(screen.getByText("यहीं पढ़ें"));
  await waitFor(() => expect(container.querySelector(".kd-viewer iframe")).toBeTruthy());
  expect(global.fetch).toHaveBeenCalledWith("/api/admin/kundali/documents/abc123abc123", { credentials: "same-origin" });
  expect(container.querySelector(".kd-viewer iframe").getAttribute("src")).toBe("blob:paper");
  fireEvent.click(screen.getByText("बंद करें"));
  expect(container.querySelector(".kd-viewer")).toBeNull();
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:paper");

  // renamed in place
  fireEvent.click(screen.getByText("नाम बदलें"));
  fireEvent.change(screen.getByLabelText("दस्तावेज़ का नाम"), { target: { value: "  मेरी पत्रिका  " } });
  fireEvent.click(screen.getByText("सहेजें"));
  await waitFor(() => expect(screen.getByText("मेरी पत्रिका")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/kundali/documents/abc123abc123", { method: "PUT", body: { label: "मेरी पत्रिका" } });

  // removed only after the question, asked in Hindi
  mockAsk.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByText("हटाएँ"));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  expect(mockAsk.mock.calls[0][0].title).toBe("यह दस्तावेज़ हटाएँ?");
  expect(mockApi.mock.calls.some((c) => c[1] && c[1].method === "DELETE")).toBe(false);
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByText("हटाएँ"));
  await waitFor(() => expect(screen.getByText("अभी कोई दस्तावेज़ नहीं रखा गया है।")).toBeTruthy());
  // the chart file can be kept as a file
  expect(screen.getByText("कुंडली फ़ाइल निर्यात करें").getAttribute("href")).toBe("/api/admin/kundali/chart/export");
});

test("a paper is sent in parts as bytes; the chart file is imported the same way; what is not a paper is refused before it is sent", async () => {
  mockApi.mockResolvedValue(view({ documents: [] }));
  const sent = [];
  global.fetch.mockImplementation((url, opts) => {
    sent.push([url, opts.method, opts.headers["Content-Type"], opts.headers["X-Requested-With"], opts.body.size]);
    const last = /part=1&of=2/.test(url) || /chart$/.test(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(last ? (/chart$/.test(url) ? view() : { done: true, view: view() }) : { received: 1, of: 2 }) });
  });
  render(<Kundali />);
  await waitFor(() => expect(screen.getByText("दस्तावेज़ जोड़ें")).toBeTruthy());

  fireEvent.change(screen.getByLabelText("दस्तावेज़ चुनें"), { target: { files: [new File(["x"], "virus.exe")] } });
  expect(screen.getByRole("alert").textContent).toBe("केवल PDF या चित्र (JPEG, PNG, WEBP) जोड़े जा सकते हैं।");
  expect(global.fetch).not.toHaveBeenCalled();

  const pdf = new File([new Uint8Array(3 * 1024 * 1024)], "Brihat Horoscope (72).pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("दस्तावेज़ चुनें"), { target: { files: [pdf] } });
  await waitFor(() => expect(screen.getByText("“Brihat Horoscope (72).pdf” सुरक्षित रख ली गई।")).toBeTruthy());
  expect(sent.length).toBe(2);
  expect(sent[0][0]).toMatch(/^\/api\/admin\/kundali\/upload\?id=[a-f0-9]{16}&part=0&of=2&name=Brihat\+Horoscope\+%2872%29\.pdf$/);
  expect(sent.map((s) => s.slice(1))).toEqual([["POST", "application/octet-stream", "vpt", 2 * 1024 * 1024], ["POST", "application/octet-stream", "vpt", 1024 * 1024]]);
  expect(screen.getByText("बृहत् कुंडली")).toBeTruthy();

  // the chart file: replacing the one that is there is asked first
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.change(screen.getByLabelText("कुंडली फ़ाइल चुनें"), { target: { files: [new File(["{}"], "kundali-chart.json", { type: "application/json" })] } });
  await waitFor(() => expect(screen.getByText("कुंडली फ़ाइल रख ली गई।")).toBeTruthy());
  expect(mockAsk.mock.calls[0][0].title).toBe("कुंडली फ़ाइल बदलें?");
  expect(sent[2].slice(0, 4)).toEqual(["/api/admin/kundali/chart", "PUT", "application/octet-stream", "vpt"]);
});

test("with no chart on this server the page says how to put it there, and the papers can still be kept; a refusal is shown", async () => {
  mockApi.mockResolvedValue(view({ chart: null, chartAt: null, documents: [] }));
  const { container, unmount } = render(<Kundali />);
  await waitFor(() => expect(screen.getByText(/अभी इस सर्वर पर कुंडली नहीं रखी गई है/)).toBeTruthy());
  expect([...container.querySelectorAll(".kd-jump a")].map((a) => a.textContent)).toEqual(["दस्तावेज़"]);
  expect(screen.getByText("कुंडली फ़ाइल आयात करें")).toBeTruthy();
  expect(screen.queryByText("कुंडली फ़ाइल निर्यात करें")).toBeNull();
  expect(container.querySelector(".kd-chart")).toBeNull();
  unmount();

  mockApi.mockRejectedValue(new Error("Only the superadmin can do this."));
  render(<Kundali />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Only the superadmin can do this."));
});
