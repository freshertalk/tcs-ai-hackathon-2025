// Thin fetch wrapper for the private API. The X-Requested-With header is the
// server's CSRF check: a cross-site form cannot send it.

// The last good answer to each market read, kept for this visit. A screen that was open a
// moment ago — a stock you come back to, a workspace you switch back to — is drawn at once
// from here while the fresh answer is on its way, instead of starting from "Loading…".
// Account and order data are never kept: those are always read fresh.
const seen = new Map();
const KEEP = 120;
const keeps = (path) => path.startsWith("/api/admin/market/") && !path.includes("/search");

/** The remembered answer to a read, or null when there is none or it is older than maxAgeMs. */
export function peek(path, maxAgeMs = 5 * 60 * 1000) {
  const hit = seen.get(path);
  return hit && Date.now() - hit.at <= maxAgeMs ? hit.data : null;
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "vpt",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = new Error(
      (data && data.message) ||
        (res.status === 404 || res.status === 502 || res.status === 504
          ? "The server is not reachable."
          : `Request failed (${res.status}).`)
    );
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  if (method === "GET" && data && keeps(path)) {
    seen.delete(path);
    if (seen.size >= KEEP) seen.delete(seen.keys().next().value);
    seen.set(path, { at: Date.now(), data });
  }
  return data;
}
