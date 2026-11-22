// The security check on the door (22 Nov 2026): a fresh picture from this server, a proof of work the browser does by itself in the
// background, and a pass that then opens every email sign-in step for 15 minutes. The server half is server/captcha.js.
//
//   useGate(on)    → { status, challenge, answer, setAnswer, refresh, obtain, forget, passed }
//                      obtain()  the pass (a token), asking for it first if there is none: sends the answer and the work
//                      forget()  the pass is no longer good (the server said so): ask again
//   <Captcha />    the picture, the box for what it shows, a "new picture" button and a line saying where the work stands

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Leading zero bits of a digest. */
export function zeroBits(bytes) {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) n += 8;
    else {
      n += Math.clz32(b) - 24;
      break;
    }
  }
  return n;
}

/**
 * Find the number that makes SHA-256(salt:number) begin with `bits` zero bits. Hashes in parallel batches so the page stays
 * responsive; `isCancelled` stops it when the picture has been replaced. `digest` can be given (tests).
 */
export async function solvePow({ salt, bits }, { digest, isCancelled = () => false } = {}) {
  const hash = digest || ((buf) => window.crypto.subtle.digest("SHA-256", buf));
  const enc = new TextEncoder();
  const BATCH = 256;
  for (let base = 0; base < 1e12; base += BATCH) {
    if (isCancelled()) return null;
    const tries = Array.from({ length: BATCH }, (_, i) => String(base + i));
    const outs = await Promise.all(tries.map((n) => hash(enc.encode(`${salt}:${n}`))));
    for (let i = 0; i < BATCH; i += 1) if (zeroBits(new Uint8Array(outs[i])) >= bits) return tries[i];
  }
  return null;
}

export function useGate(on) {
  const [state, setState] = useState({ status: on ? "loading" : "off", challenge: null, error: "" });
  const [answer, setAnswer] = useState("");
  const gate = useRef({ token: "", until: 0 });
  const work = useRef({ id: 0, promise: null });
  const [passed, setPassed] = useState(false);

  const start = useCallback((challenge) => {
    const id = work.current.id + 1;
    work.current = { id, promise: null }; // the id first: the work asks "am I still wanted?" as it starts
    work.current.promise = solvePow(challenge.pow, { isCancelled: () => work.current.id !== id });
    setState({ status: "working", challenge, error: "" });
    work.current.promise.then(
      (nonce) => {
        if (work.current.id === id && nonce !== null) setState((s) => (s.challenge === challenge ? { ...s, status: "ready" } : s));
      },
      () => {
        if (work.current.id === id) setState((s) => (s.challenge === challenge ? { ...s, status: "error", error: "This browser could not do the security check." } : s));
      }
    );
  }, []);

  const refresh = useCallback(async () => {
    setAnswer("");
    setState((s) => ({ ...s, status: "loading", error: "" }));
    try {
      const d = await api("/api/auth/captcha");
      if (d && d.off) setState({ status: "off", challenge: null, error: "" });
      else start(d);
    } catch (e) {
      setState({ status: "error", challenge: null, error: e.message || "The security check could not be loaded." });
    }
  }, [start]);

  useEffect(() => {
    if (!on) return undefined;
    refresh();
    return () => {
      work.current = { id: work.current.id + 1, promise: null }; // stop any work still running
    };
  }, [on, refresh]);

  /** The pass, asking for one when there is none. Throws an Error whose message says what to do. */
  const obtain = useCallback(async () => {
    if (!on) return "";
    if (gate.current.token && gate.current.until > Date.now() + 15000) return gate.current.token;
    const ch = state.challenge;
    if (!ch) throw new Error("The security check is not ready yet.");
    if (!String(answer).trim()) throw new Error("Type the characters shown in the picture first.");
    const nonce = await work.current.promise;
    if (nonce === null) throw new Error("The security check is not ready yet.");
    try {
      const d = await api("/api/auth/gate", { method: "POST", body: { token: ch.token, answer: String(answer).trim(), nonce } });
      if (d && d.off) return "";
      gate.current = { token: d.gate, until: Date.now() + (d.expiresIn || 900) * 1000 };
      setPassed(true);
      return d.gate;
    } catch (e) {
      if (e.data && e.data.challenge) {
        setAnswer("");
        start(e.data.challenge); // the server sent a new picture with its refusal
      }
      throw e;
    }
  }, [on, state.challenge, answer, start]);

  const forget = useCallback(() => {
    gate.current = { token: "", until: 0 };
    setPassed(false);
    if (on) refresh();
  }, [on, refresh]);

  return { ...state, answer, setAnswer, refresh, obtain, forget, passed };
}

export default function Captcha({ gate, id = "sg-cap" }) {
  if (!gate || gate.status === "off") return null;
  if (gate.passed) {
    return (
      <p className="sg-cap__ok" role="status">
        <span aria-hidden="true">✓</span> Security check passed
      </p>
    );
  }
  const ch = gate.challenge;
  const sum = ch && ch.kind === "sum";
  return (
    <div className="sg-cap" role="group" aria-label="Security check">
      <div className="sg-cap__pic">
        {ch ? <img src={ch.image} width="230" height="84" alt={sum ? "A small sum to solve" : "Characters to type"} draggable="false" /> : <span className="sg-cap__wait">Loading the picture…</span>}
        <button type="button" className="sg-cap__new" onClick={gate.refresh} aria-label="Show a new picture" data-tip="A new picture">
          ↻
        </button>
      </div>
      <div className="sg-field">
        <label htmlFor={id}>{sum ? "Solve the sum shown" : "Type the characters shown"}</label>
        <input id={id} value={gate.answer} onChange={(e) => gate.setAnswer(e.target.value.slice(0, 8))} autoComplete="off" autoCapitalize="characters" spellCheck="false" inputMode={sum ? "numeric" : "text"} maxLength={8} />
      </div>
      <p className={`sg-cap__state sg-cap__state--${gate.status}`} role="status">
        {gate.status === "working" && "Securing this sign-in…"}
        {gate.status === "ready" && "Ready — a human check, made on this server."}
        {gate.status === "loading" && "Preparing…"}
        {gate.status === "error" && (gate.error || "The security check could not be loaded.")}
      </p>
    </div>
  );
}
