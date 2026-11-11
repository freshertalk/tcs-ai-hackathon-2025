import { isLocalEnvironment, loadAnalytics } from "./loadAnalytics";

const realLocation = window.location;
const realEnv = process.env.NODE_ENV;

function pretendToBeAt(url) {
  delete window.location;
  window.location = new URL(url);
}

function mockConfig(body, ok = true) {
  global.fetch = jest.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) }));
}

beforeEach(() => {
  delete window.__gaLoaded;
  delete window.dataLayer;
  delete window.gtag;
  document.head.innerHTML = "";
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  window.location = realLocation;
  process.env.NODE_ENV = realEnv;
});

test("local machines are recognised; real hosts are not", () => {
  ["localhost", "127.0.0.1", "[::1]", "192.168.1.5", "10.0.0.2", "172.16.4.4", "pc.local"].forEach((h) =>
    expect(isLocalEnvironment(h)).toBe(true)
  );
  ["vinaytiwari.org", "www.vinaytiwari.org", "172.32.0.1", "localhost.example.com"].forEach((h) =>
    expect(isLocalEnvironment(h)).toBe(false)
  );
});

test("on the live site, with an ID configured, the gtag script is added", async () => {
  pretendToBeAt("https://www.vinaytiwari.org/");
  mockConfig({ ga: "G-ABCD1234" });
  await loadAnalytics();
  const s = document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
  expect(s).not.toBeNull();
  expect(s.src).toContain("id=G-ABCD1234");
  expect(window.dataLayer.length).toBeGreaterThan(0);
});

test("never loads on a local run, even in a production build", async () => {
  pretendToBeAt("http://localhost:5000/");
  mockConfig({ ga: "G-ABCD1234" });
  await loadAnalytics();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(document.querySelector("script")).toBeNull();
});

test("never loads in the private area", async () => {
  pretendToBeAt("https://www.vinaytiwari.org/vinay-personal-tasks");
  mockConfig({ ga: "G-ABCD1234" });
  await loadAnalytics();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("never loads in development builds", async () => {
  process.env.NODE_ENV = "development";
  pretendToBeAt("https://www.vinaytiwari.org/");
  mockConfig({ ga: "G-ABCD1234" });
  await loadAnalytics();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("ignores a missing ID, a malformed ID, and a failing server", async () => {
  pretendToBeAt("https://www.vinaytiwari.org/");

  mockConfig({ ga: null });
  await loadAnalytics();
  expect(document.querySelector("script")).toBeNull();

  mockConfig({ ga: 'G-AB"><script>alert(1)</script>' });
  await loadAnalytics();
  expect(document.querySelector("script")).toBeNull();

  global.fetch = jest.fn(() => Promise.reject(new Error("offline")));
  await expect(loadAnalytics()).resolves.toBeUndefined();

  mockConfig({}, false);
  await loadAnalytics();
  expect(document.querySelector("script")).toBeNull();
});

test("loads only once", async () => {
  pretendToBeAt("https://www.vinaytiwari.org/");
  mockConfig({ ga: "G-ABCD1234" });
  await loadAnalytics();
  await loadAnalytics();
  expect(document.querySelectorAll("script")).toHaveLength(1);
});
