"use strict";
// The live hub: topics by route, numbered events with replay, a resync when too much was missed or the server restarted,
// and watchers that publish only what changed.

const test = require("node:test");
const assert = require("node:assert/strict");
const { LiveHub, topicsForRoute } = require("../live");

const quiet = { log() {}, error() {} };
const fakeRes = () => {
  const out = { chunks: [], head: null, write(c) { out.chunks.push(String(c)); return true; }, writeHead(code, h) { out.head = { code, h }; }, end() { out.ended = true; } };
  return out;
};
const fakeReq = (query = {}, headers = {}) => {
  const handlers = {};
  return { query, headers, on: (e, f) => { handlers[e] = f; }, close: () => handlers.close && handlers.close() };
};
const events = (res) => res.chunks.join("").split("\n\n").filter((b) => b.includes("event: change")).map((b) => ({ id: Number((b.match(/id: (\d+)/) || [])[1]), ...JSON.parse(b.match(/data: (.*)/)[1]) }));

test("a request belongs to the topics of its route, longest prefix first; anything unknown is 'misc'", () => {
  assert.deepEqual(topicsForRoute("/api/admin/market/horizon/train"), ["horizon"]);
  assert.deepEqual(topicsForRoute("/api/admin/market/open-forecast/learn"), ["open"]);
  assert.deepEqual(topicsForRoute("/api/admin/market/alerts"), ["alerts", "market"]);
  assert.deepEqual(topicsForRoute("/api/admin/market/anything"), ["market"]);
  assert.deepEqual(topicsForRoute("/api/admin/trading/enable?x=1"), ["trading", "market", "health"]);
  assert.deepEqual(topicsForRoute("/api/admin/ai/research"), ["research", "ai"]);
  assert.deepEqual(topicsForRoute("/api/admin/ai/spend"), ["ai", "health"]);
  assert.deepEqual(topicsForRoute("/api/admin/whatsapp"), ["system", "health"]);
  assert.deepEqual(topicsForRoute("/api/admin/unknown"), ["misc"]);
  assert.deepEqual(topicsForRoute("/api/admin/marketplace"), ["misc"], "a prefix is a whole path part");
});

test("events are numbered and reach every open page; a page that reconnects gets what it missed, or a resync", () => {
  const hub = new LiveHub({ log: quiet });
  const a = fakeRes();
  hub.handler()(fakeReq(), a);
  assert.equal(a.head.code, 200);
  assert.match(a.head.h["Content-Type"], /text\/event-stream/);
  assert.match(a.chunks.join(""), /event: hello/);
  hub.publish("horizon");
  hub.publish("trading");
  assert.deepEqual(events(a).map((e) => [e.id, e.topic]), [[1, "horizon"], [2, "trading"]]);
  // reconnects having seen 1: gets 2 only
  const b = fakeRes();
  hub.handler()(fakeReq({ last: "1", boot: hub.boot }), b);
  assert.deepEqual(events(b).map((e) => e.id), [2]);
  assert.doesNotMatch(b.chunks.join(""), /resync/);
  // another server run: told to re-read everything
  const c = fakeRes();
  hub.handler()(fakeReq({ last: "5", boot: "old-boot" }), c);
  assert.match(c.chunks.join(""), /event: resync[\s\S]*restarted/);
  // more was missed than is kept
  for (let i = 0; i < 320; i += 1) hub.publish("misc");
  const d = fakeRes();
  hub.handler()(fakeReq({ last: "3", boot: hub.boot }), d);
  assert.match(d.chunks.join(""), /event: resync[\s\S]*missed/);
  assert.ok(hub.ring.length <= 300, "only the last 300 are kept");
  // a page that goes away is dropped
  const before = hub.clients.size;
  const e = fakeReq();
  hub.handler()(e, fakeRes());
  e.close();
  assert.equal(hub.clients.size, before);
});

test("a watcher publishes when its fingerprint changes — and says nothing while nothing does", () => {
  const hub = new LiveHub({ log: quiet });
  let v = { a: 1, t: [1, 2] };
  hub.watch("market", () => v);
  hub.watch("broken", () => {
    throw new Error("a watcher must never break the hub");
  });
  assert.equal(hub.tick(), 0, "the first look is the baseline");
  assert.equal(hub.tick(), 0, "idle: nothing published");
  assert.equal(hub.seq, 0);
  v = { a: 2, t: [1, 2] };
  assert.equal(hub.tick(), 1);
  assert.equal(hub.ring[hub.ring.length - 1].topic, "market");
  assert.equal(hub.ring[hub.ring.length - 1].via, "watch");
  assert.equal(hub.tick(), 0, "published once");
});

test("a successful state-changing request publishes its topics; a refused one and a read do not", () => {
  const hub = new LiveHub({ log: quiet });
  const run = (method, path, status) => {
    const handlers = {};
    const res = { statusCode: status, on: (e, f) => { handlers[e] = f; } };
    hub.middleware()({ method, baseUrl: "/api/admin", path }, res, () => {});
    handlers.finish && handlers.finish();
  };
  run("GET", "/market/horizon", 200);
  run("POST", "/market/horizon/train", 409);
  assert.equal(hub.seq, 0);
  run("POST", "/market/horizon/train", 200);
  run("PUT", "/trading/enable", 200);
  assert.deepEqual(hub.ring.map((e) => e.topic), ["horizon", "trading", "market", "health"]);
});
