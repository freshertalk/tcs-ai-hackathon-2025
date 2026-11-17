"use strict";
// Constants shared by the server. Anything a person might want to change
// without touching logic lives here or in an environment variable.

// Where the admin area lives. The front end uses the same string
// (src/admin/paths.js) — change both together.
const ADMIN_BASE = "/me";

// Whole-segment match: "/me" and "/me/anything" are the private area, but
// "/media", "/menu" or "/me.png" are not. A bare startsWith("/me") would catch them.
const isAdminPath = (p) => p === ADMIN_BASE || String(p).startsWith(`${ADMIN_BASE}/`);

// The one account that can always sign in and is the only one allowed to add or
// remove other admins. It cannot be removed from the admin list because it is
// not *in* the list: it is recognised by address, on every request.
const SUPERADMIN_EMAIL = (
  process.env.SUPERADMIN_EMAIL || "vinaytiwari.iist@gmail.com"
)
  .trim()
  .toLowerCase();

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
// GA4 measurement IDs look like G-ABCDE12345. The value ends up in a script URL,
// so it is matched strictly instead of being "sanitised".
const GA_RE = /^G-[A-Z0-9]{4,20}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET_RE = /^[^\s]{8,200}$/;

// Two spellings of one mailbox are one person. Case never matters, and for Gmail (Google treats the dots
// and anything after a + as the same inbox, and googlemail.com as gmail.com) those are folded too.
// Used to MATCH and to refuse duplicates; the address is kept as it was entered.
const GMAIL_HOSTS = new Set(["gmail.com", "googlemail.com"]);
function canonicalEmail(email) {
  const s = String(email || "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return s;
  let local = s.slice(0, at);
  let host = s.slice(at + 1);
  if (GMAIL_HOSTS.has(host)) {
    local = local.split("+")[0].replace(/\./g, "");
    host = "gmail.com";
  }
  return `${local}@${host}`;
}

// a mail server: a host name or an IPv4 address, nothing else (it is typed by the owner and used to open a socket)
const SMTP_HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

module.exports = {
  canonicalEmail,
  SMTP_HOST_RE,
  ADMIN_BASE,
  isAdminPath,
  SUPERADMIN_EMAIL,
  EMAIL_RE,
  GA_RE,
  CLIENT_ID_RE,
  CLIENT_SECRET_RE,
};
