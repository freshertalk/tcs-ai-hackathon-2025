"use strict";
// Test stand-ins: a WebSocket that never touches the network, and a tiny reader
// for Server-Sent Events.

const http = require("http");
const { EventEmitter } = require("events");
const { encodeTicks } = require("../../market/ticker");

/** A WebSocket class whose instances are collected in `.sockets` and driven by the test. */
function fakeSocket() {
  const sockets = [];
  class FakeWS extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
      setImmediate(() => {
        if (this.closed) return;
        if (FakeWS.reject) this.emit("unexpected-response", {}, { statusCode: FakeWS.reject });
        else if (!FakeWS.silent) this.emit("open");
      });
    }

    send(text) {
      this.sent.push(JSON.parse(text));
    }

    terminate() {
      if (this.closed) return;
      this.closed = true;
      setImmediate(() => this.emit("close"));
    }

    /** Deliver ticks the way Zerodha does: one binary frame. */
    push(ticks) {
      this.emit("message", encodeTicks(ticks), true);
    }
  }
  FakeWS.sockets = sockets;
  FakeWS.reject = 0; // an HTTP status to refuse the handshake with
  FakeWS.silent = false; // never open (a connection attempt that hangs)
  return FakeWS;
}

/** Open an SSE response and collect its events; `next(predicate)` waits for one. */
function openStream(port, pathname, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers: { cookie: cookie || "", accept: "text/event-stream" } }, (res) => {
      const events = [];
      const waiting = [];
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = {};
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) ev.event = line.slice(7);
            if (line.startsWith("data: ")) ev.data = JSON.parse(line.slice(6));
          }
          if (ev.event) {
            events.push(ev);
            waiting.splice(0).forEach((w) => w());
          }
        }
      });
      res.on("error", () => {});
      resolve({
        status: res.statusCode,
        headers: res.headers,
        events,
        next: (pred, ms = 3000) =>
          new Promise((ok, fail) => {
            const timer = setTimeout(() => fail(new Error(`no matching event within ${ms} ms; got ${JSON.stringify(events).slice(0, 300)}`)), ms);
            const check = () => {
              const hit = events.find(pred);
              if (hit) {
                clearTimeout(timer);
                ok(hit);
              } else waiting.push(check);
            };
            check();
          }),
        close: () => req.destroy(),
      });
    });
    req.on("error", (err) => (err.code === "ECONNRESET" ? null : reject(err)));
    req.end();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await wait(5);
  }
  throw new Error("timed out waiting for a condition");
}

module.exports = { fakeSocket, openStream, wait, until };
