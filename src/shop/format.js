// src/shop/format.js
// Money and dates as a receipt prints them.

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,234.50 — always two decimals, lakh grouping. */
export const inr = (n) => `₹${money.format(Number(n) || 0)}`;

/** ₹115 for a whole figure, ₹115.50 otherwise — for prices in running text. */
export const inrShort = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? `₹${whole.format(v)}` : inr(v);
};

const MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

/** 12 अक्टूबर 2026, 07:20 PM IST — the same form the receipt e-mail uses. */
export function stamp(ms) {
  if (!ms) return "";
  const t = new Date(Number(ms) + 330 * 60000); // IST, whatever this device's zone is
  const h = t.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${String(h12).padStart(2, "0")}:${mm} ${h >= 12 ? "PM" : "AM"} IST`;
}

/** The lines of the money table, in the order a receipt shows them. */
export function receiptLines(order) {
  const a = order.amounts;
  const t = a.tax;
  const paid = ["paid", "free", "refunded", "duplicate"].includes(order.status);
  const out = [];
  out.push({ k: "mrp", label: "मूल्य (MRP)", value: inr(a.mrp), strike: true });
  out.push({ k: "list", label: "विशेष मूल्य", value: inr(a.list) });
  if (a.discount > 0) {
    out.push({ k: "disc", label: `कूपन छूट${a.coupon ? ` (${a.coupon})` : ""}`, value: `− ${inr(a.discount)}`, good: true });
  }
  if (t.enabled) {
    out.push({ k: "taxable", label: "कर-योग्य मूल्य", value: inr(a.taxable) });
    if (t.intra) {
      out.push({ k: "cgst", label: `CGST ${t.rate / 2}%`, value: inr(t.cgst) });
      out.push({ k: "sgst", label: `SGST ${t.rate / 2}%`, value: inr(t.sgst) });
    } else {
      out.push({ k: "igst", label: `IGST ${t.rate}%`, value: inr(t.igst) });
    }
  } else if (a.net > 0) {
    out.push({ k: "gst", label: "GST", value: "लागू नहीं" });
  }
  out.push({ k: "total", label: paid ? "कुल भुगतान" : "कुल देय", value: inr(a.total), total: true });
  return out;
}

export const STATUS = {
  created: { label: "भुगतान बाकी", tone: "warn" },
  paid: { label: "भुगतान सफल", tone: "ok" },
  free: { label: "मुफ़्त · कूपन से", tone: "ok" },
  refunded: { label: "रिफ़ंड हुआ", tone: "muted" },
  duplicate: { label: "दोहरा भुगतान", tone: "warn" },
};
