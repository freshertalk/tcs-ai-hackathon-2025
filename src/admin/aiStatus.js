import { useEffect, useState } from "react";
import { api } from "./api";

// One shared copy of the AI settings (company, model, whether a key is saved) for every page.
//
//   • a change saved on the AI page is pushed to every open component at once — no refresh
//   • other tabs of the site hear about it through a BroadcastChannel and read it again
//   • a tab coming back into view reads it again if it has been away a while
//
// The server builds each AI request from its own settings at the moment it is made, so this is
// only about what the pages show and offer; nothing here can choose a model on its own.

let state = null;
let loadedAt = 0;
let inflight = null;
const subs = new Set();
let channel = null;
try {
  channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("vpt-ai-status") : null;
  if (channel) channel.onmessage = () => loadAiStatus(true).catch(() => {});
} catch (_) {
  channel = null;
}

function emit() {
  subs.forEach((fn) => fn(state));
}

/** Set the shared copy (from a settings answer) and tell everyone, here and in other tabs. */
export function publishAiStatus(d, { broadcast = true } = {}) {
  if (!d || typeof d !== "object" || !("configured" in d)) return;
  const changed = !state || state.version !== d.version || state.provider !== d.provider || state.model !== d.model || state.configured !== d.configured;
  state = d;
  loadedAt = Date.now();
  emit();
  if (broadcast && changed && channel) {
    try {
      channel.postMessage({ version: d.version });
    } catch (_) {
      /* a closed channel is harmless */
    }
  }
}

/** Read the settings from the server (shared: many callers, one request). */
export function loadAiStatus(force = false) {
  if (!force && state && Date.now() - loadedAt < 15000) return Promise.resolve(state);
  if (inflight) return inflight;
  inflight = api("/api/admin/ai/status")
    .then((d) => {
      publishAiStatus(d, { broadcast: false });
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The current AI settings; re-renders whenever they change anywhere. null while loading. */
export function useAiStatus() {
  const [s, set] = useState(state);
  useEffect(() => {
    subs.add(set);
    if (state) set(state);
    loadAiStatus().catch(() => {});
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt > 60000) loadAiStatus(true).catch(() => {});
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      subs.delete(set);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return s;
}

/** A model's display name, whichever company it belongs to. */
export function modelName(status, id) {
  if (!id) return "";
  return (status && status.names && status.names[id]) || id;
}

/** "the OpenAI API key" style wording for messages. */
export function keyWords(status) {
  return status && status.providerName ? `${status.providerName} API key` : "AI API key";
}

/** Only for tests: forget the shared copy. */
export function _resetAiStatus() {
  state = null;
  loadedAt = 0;
  inflight = null;
}
