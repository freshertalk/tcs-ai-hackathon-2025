// Where the private area lives. The server uses the same string
// (server/config.js) — change both together.
export const ADMIN_BASE = "/vinay-personal-tasks";
export const adminPath = (p = "") => `${ADMIN_BASE}${p}`;
export const isAdminPath = (pathname) =>
  pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`);
