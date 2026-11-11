// Thin fetch wrapper for the private API. The X-Requested-With header is the
// server's CSRF check: a cross-site form cannot send it.

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
  return data;
}
