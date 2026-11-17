"use strict";
// Outgoing email (sign-in links and codes, invitations, security notices) through the owner's own SMTP server.
//
// The settings are kept in the private record with the password encrypted like every other secret; set from the
// admin panel (Email & sign-in) or, for a first run, from SMTP_* environment variables. The database wins when it
// has a host; the environment is used only when it has none, never mixed field by field.
//
//   SMTP_HOST  SMTP_PORT  SMTP_SECURITY (starttls | ssl | none)  SMTP_USER  SMTP_PASS  SMTP_FROM  SMTP_FROM_NAME

const nodemailer = require("nodemailer");
const { BRAND } = require("./brand");
const { EMAIL_RE, SMTP_HOST_RE } = require("./config");

const clean = (x, max = 200) => String(x == null ? "" : x).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

class MailError extends Error {
  constructor(message, code = "mail") {
    super(message);
    this.code = code;
  }
}

/** What a person can act on, for what the mail library throws. The raw text goes to the log only. */
function friendly(err, host, port) {
  const code = String((err && err.code) || "");
  const text = String((err && err.message) || "");
  if (code === "EAUTH" || /invalid login|authentication|535|534/i.test(text)) return "The mail server did not accept the user name or password. (Gmail and Outlook need an app password, not your normal one.)";
  if (/self.signed|certificate|CERT_|altnames|wrong version number|SSL routines/i.test(text)) return "Could not make a secure connection: the server's certificate is not trusted, or the security setting does not match the port (465 is “SSL”, 587 is “STARTTLS”).";
  if (code === "ETIMEDOUT" || code === "ESOCKET" || /timeout|timed out/i.test(text)) return `The mail server at ${host}:${port} did not answer in time.`;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EDNS" || code === "ECONNECTION" || code === "EHOSTUNREACH") return `Could not reach the mail server at ${host}:${port}. Check the host name and the port.`;
  if (code === "EENVELOPE" || /recipient|sender|550|553|554/i.test(text)) return "The mail server refused the message (the From address may not be allowed for this account, or the recipient was refused).";
  return "The mail could not be sent. Check the server settings and try again.";
}

class Mailer {
  /**
   * @param store    the private record (settings.smtp)
   * @param secrets  { encrypt, decrypt } for the password
   * @param env      process.env or a stand-in
   * @param createTransport  nodemailer.createTransport, replaced in tests
   */
  constructor({ store, secrets, env = {}, createTransport = nodemailer.createTransport.bind(nodemailer), log = console } = {}) {
    this.store = store;
    this.secrets = secrets;
    this.env = env;
    this.createTransport = createTransport;
    this.log = log;
  }

  /** The settings in force: { host, port, security, user, pass, fromEmail, fromName, source }. */
  config() {
    const s = (this.store.data.settings && this.store.data.settings.smtp) || {};
    const e = this.env;
    if (s.host) {
      let pass = "";
      if (s.passEnc) {
        try {
          pass = this.secrets.decrypt(s.passEnc);
        } catch (_) {
          pass = ""; // the key changed or the record is damaged: as if not set
        }
      }
      const security = ["starttls", "ssl", "none"].includes(s.security) ? s.security : "starttls";
      return { host: s.host, port: Number(s.port) || (security === "ssl" ? 465 : 587), security, user: s.user || "", pass, fromEmail: s.fromEmail || s.user || "", fromName: s.fromName || BRAND.name, source: "database" };
    }
    if (e.SMTP_HOST) {
      const port = Number(e.SMTP_PORT) || 587;
      const security = ["starttls", "ssl", "none"].includes(String(e.SMTP_SECURITY || "").toLowerCase()) ? String(e.SMTP_SECURITY).toLowerCase() : port === 465 ? "ssl" : "starttls";
      return { host: clean(e.SMTP_HOST), port, security, user: clean(e.SMTP_USER), pass: String(e.SMTP_PASS || ""), fromEmail: clean(e.SMTP_FROM || e.SMTP_USER), fromName: clean(e.SMTP_FROM_NAME) || BRAND.name, source: "environment" };
    }
    return { host: "", port: 587, security: "starttls", user: "", pass: "", fromEmail: "", fromName: BRAND.name, source: "none" };
  }

  /** Can mail be sent at all? (A host, a valid From address, and a password when a user name is given.) */
  configured() {
    const c = this.config();
    return Boolean(c.host && SMTP_HOST_RE.test(c.host) && EMAIL_RE.test(c.fromEmail) && (!c.user || c.pass));
  }

  _transport(c) {
    return this.createTransport({
      host: c.host,
      port: c.port,
      secure: c.security === "ssl",
      requireTLS: c.security === "starttls",
      ignoreTLS: c.security === "none",
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      tls: { minVersion: "TLSv1.2" },
    });
  }

  /** Send one message. Throws MailError with a sentence for the owner. */
  async send({ to, subject, text, html }) {
    if (!this.configured()) throw new MailError("Email is not set up yet.", "not_configured");
    if (!EMAIL_RE.test(String(to || "")) || /[\r\n]/.test(String(to))) throw new MailError("That is not a valid email address.", "bad_address");
    const c = this.config();
    try {
      const info = await this._transport(c).sendMail({
        from: { name: clean(c.fromName, 80), address: c.fromEmail },
        to,
        subject: clean(subject, 200),
        text,
        html,
        headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
      });
      return { messageId: (info && info.messageId) || "" };
    } catch (err) {
      this.log.error(`[mail] send to ${clean(to, 80)} failed: ${clean(err && err.message)}`);
      throw new MailError(friendly(err, c.host, c.port), "send_failed");
    }
  }

  /** Check the connection and login without sending anything. */
  async verify() {
    if (!this.configured()) throw new MailError("Email is not set up yet.", "not_configured");
    const c = this.config();
    try {
      await this._transport(c).verify();
      return true;
    } catch (err) {
      throw new MailError(friendly(err, c.host, c.port), "verify_failed");
    }
  }
}

module.exports = { Mailer, MailError, friendly };
