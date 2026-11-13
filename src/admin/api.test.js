import { api, peek } from "./api";

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
