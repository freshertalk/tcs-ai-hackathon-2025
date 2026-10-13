// Checks the Razorpay keys in .env against Razorpay itself (read-only: it lists
// one order, creates nothing, charges nothing) and tells you what is left to do.
//
//   node scripts/check-razorpay.js
//
// The keys live in .env (git-ignored) for this check only. The website's
// backend is the Google Apps Script, which cannot read this file: it reads the
// same two values from its Script properties (README, "Selling the book").
// The secret is never printed and never reaches the browser bundle.

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return {};
  const out = {};
  fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  return out;
}

(async () => {
  const env = { ...loadEnv(), ...process.env };
  const id = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) {
    console.log("FAIL  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set (see .env).");
    process.exit(1);
  }
  const mode = id.startsWith("rzp_live_") ? "LIVE" : "test";
  console.log(`Key id ${id} (${mode} mode)`);

  let res;
  try {
    res = await fetch("https://api.razorpay.com/v1/orders?count=1", {
      headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
    });
  } catch (e) {
    console.log("FAIL  could not reach api.razorpay.com: " + e.message);
    process.exit(1);
  }
  if (res.status === 401) {
    console.log("FAIL  Razorpay refused these keys (401). Check the key id and secret are a pair, from the same mode.");
    process.exit(1);
  }
  if (!res.ok) {
    console.log(`FAIL  Razorpay answered ${res.status}.`);
    process.exit(1);
  }
  console.log("PASS  Razorpay accepts these keys.");
  console.log("");
  console.log("Still to do by hand (the script cannot be reached from here):");
  console.log("  1. Apps Script → Project Settings → Script properties:");
  console.log("       RAZORPAY_KEY_ID      = the key id above");
  console.log("       RAZORPAY_KEY_SECRET  = the secret from .env");
  console.log("  2. Run setupPayments once in the editor (mail permission, test receipt).");
  console.log("  3. Deploy → Manage deployments → ✏ → New version.");
})();
