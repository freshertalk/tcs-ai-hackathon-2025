import { api, apiTuning, peek } from "./api";

/** A stand-in for fetch(): one canned answer. */
function answer({ status = 200, type = "application/json", body = "{}" } = {}) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) },
    json: async () => JSON.parse(body),
  }));
}
afterEach(() => {
  delete global.fetch;
});

test("a JSON answer comes back as data, with the header that proves the call came from this site", async () => {
  answer({ body: '{"configured":true}' });
  expect(await api("/api/auth/status")).toEqual({ configured: true });
  const [, init] = global.fetch.mock.calls[0];
  expect(init.headers["X-Requested-With"]).toBe("vpt");
  expect(init.credentials).toBe("same-origin");
});

test("a web page in answer to an API call is an error, not 'nobody is signed in'", async () => {
  // what a static host or a misconfigured nginx sends: the site's own page, with 200
  answer({ type: "text/html; charset=utf-8", body: "<!doctype html><html>…" });
  await expect(api("/api/auth/status")).rejects.toMatchObject({ code: "not_api", status: 502 });
  await expect(api("/api/auth/status")).rejects.toThrow(/coming back as the site's own page/);
});

test("an empty answer is still fine (a sign-out says nothing back)", async () => {
  answer({ status: 204, type: "", body: "" });
  expect(await api("/api/auth/logout", { method: "POST" })).toBeNull();
  answer({ status: 200, type: "text/plain", body: "" });
  expect(await api("/api/x", { method: "POST" })).toBeNull();
});

test("a refusal carries the server's own words and code", async () => {
  answer({ status: 423, body: '{"error":"trading_off","message":"Trading is switched OFF."}' });
  await expect(api("/api/admin/trading/orders", { method: "POST", body: {} })).rejects.toMatchObject({ status: 423, code: "trading_off", message: "Trading is switched OFF." });
  answer({ status: 502, type: "text/html", body: "<html>Bad Gateway</html>" });
  await expect(api("/api/auth/status")).rejects.toThrow("The server is not reachable.");
});

test("only market reads are remembered for an instant repaint; account data never is", async () => {
  answer({ body: '{"rows":[1]}' });
  await api("/api/admin/market/scan");
  expect(peek("/api/admin/market/scan")).toEqual({ rows: [1] });
  answer({ body: '{"net":[]}' });
  await api("/api/admin/trading/positions");
  expect(peek("/api/admin/trading/positions")).toBeNull();
  expect(peek("/api/admin/market/scan", -1)).toBeNull(); // too old counts as not there
});

describe("several tabs at once: the server says 'too many'", () => {
  const was = { ...apiTuning };
  beforeEach(() => Object.assign(apiTuning, { waitMs: 1, retries: 2 }));
  afterAll(() => Object.assign(apiTuning, was));
  const seq = (answers) => {
    let i = 0;
    global.fetch = jest.fn(async () => {
      const a = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: { get: () => (a.json ? "application/json" : "text/html") }, json: async () => (a.json ? a.json : JSON.parse("<")) };
    });
  };

  test("a read refused with 429 (nginx sends a bare page) is tried again and then succeeds", async () => {
    seq([{ status: 429 }, { status: 200, json: { ok: 1 } }]);
    expect(await api("/api/admin/social/feed")).toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("a write is never sent twice", async () => {
    seq([{ status: 429 }, { status: 200, json: { ok: 1 } }]);
    await expect(api("/api/admin/trading/orders", { method: "POST", body: {} })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("still refused after the retries: a plain message, not 'Request failed (429)'", async () => {
    seq([{ status: 429 }]);
    await expect(api("/api/auth/status")).rejects.toThrow(/busy with many requests/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("one tab keeps only a few requests in flight; the rest wait their turn", async () => {
    Object.assign(apiTuning, { maxActive: 2 });
    let inFlight = 0;
    let most = 0;
    global.fetch = jest.fn(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({}) };
    });
    await Promise.all(Array.from({ length: 7 }, (_, i) => api(`/api/x/${i}`)));
    expect(global.fetch).toHaveBeenCalledTimes(7);
    expect(most).toBe(2);
    Object.assign(apiTuning, { maxActive: was.maxActive });
  });
});
