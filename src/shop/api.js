// src/shop/api.js
// What the shop asks of the collector, and how it takes Razorpay's payment
// window. No amount is ever sent: the collector prices the order itself.

import { call, explain } from "../api/collector";
import { LEGAL } from "../data/legal";

export const getQuote = (slug, code, state) =>
  call("shop_quote", { slug, code: code || undefined, state: state || undefined });

export const placeOrder = ({ slug, code, name, phone, state }) =>
  call("shop_order", { slug, code: code || undefined, name, phone, state: state || undefined, accept: true, legal: LEGAL.version });

export const verifyPayment = (orderId, r) =>
  call("shop_verify", { orderId, paymentId: r.paymentId, rzpOrderId: r.rzpOrderId, signature: r.signature });

export const resumePayment = (slug, orderId) => call("shop_resume", { slug, orderId });
export const listOrders = () => call("shop_orders");
export const getReceipt = (orderId) => call("shop_receipt", { orderId });
export const resendReceipt = (orderId) => call("shop_resend", { orderId });
export const claimPayment = (orderId, utr) => call("shop_claim", { orderId, utr });

const SHOP_ERRORS = {
  payments_off: "ऑनलाइन भुगतान अभी चालू नहीं है। कृपया थोड़ी देर बाद आइए, या लेखक को लिखिए।",
  gateway: "भुगतान का पन्ना बन नहीं पाया — थोड़ी देर बाद फिर कोशिश कीजिए।",
  limited: "बहुत ज़्यादा कोशिशें हो गईं — कुछ मिनट बाद फिर कोशिश कीजिए।",
  consent: "शर्तों की स्वीकृति दर्ज नहीं हो पाई — एक बार फिर साइन इन कीजिए।",
  signature: "भुगतान की पुष्टि का हस्ताक्षर नहीं मिला। पैसा कटा हो तो “भुगतान की जाँच कीजिए” दबाइए।",
  mismatch: "भुगतान की राशि ऑर्डर से मेल नहीं खाई — कृपया लेखक को लिखिए, हम देखेंगे।",
  pending: "भुगतान अभी प्रक्रिया में है — एक-दो मिनट बाद “भुगतान की जाँच कीजिए” दबाइए।",
  failed: "भुगतान सफल नहीं हुआ — फिर कोशिश कीजिए।",
  missing: "यह ऑर्डर नहीं मिला।",
  utr_used: "यह लेन-देन संख्या किसी और ऑर्डर पर दर्ज है। कृपया अपनी ऐप में दिखने वाली सही संख्या लिखिए।",
  duplicate: "यह किताब पहले से इस खाते में है।",
};

/** A sentence for a shop failure; anything else falls back to the general ones. */
export function shopMessage(e) {
  const c = e && e.code;
  if (c === "invalid") {
    const why = e.why;
    if (why === "name") return "रसीद पर नाम कम से कम दो अक्षर का लिखिए।";
    if (why === "state") return "राज्य चुनिए — GST उसी से तय होता है।";
    if (why === "phone") return "मोबाइल नंबर सही नहीं लगता।";
    if (why === "accept") return "आगे बढ़ने के लिए शर्तों वाले डिब्बे पर निशान लगाइए।";
    if (why === "utr") return "लेन-देन संख्या ठीक 12 अंकों की होती है — ऐप में दिखने वाली संख्या देखकर फिर लिखिए।";
  }
  return SHOP_ERRORS[c] || explain(e);
}

/* ---------------------------------------------------- Razorpay Checkout */
let loading = null;

/** Razorpay's own script, fetched when a payment is about to start — not before. */
export function loadCheckout() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.async = true;
      s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("razorpay")));
      s.onerror = () => {
        loading = null;
        s.remove();
        reject(new Error("razorpay"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * Open the payment window for an order the collector has made.
 * onPaid({ paymentId, rzpOrderId, signature }) · onClosed() · onFailed(message)
 */
export async function openPayment(checkout, { onPaid, onClosed, onFailed }) {
  const Razorpay = await loadCheckout();
  const rz = new Razorpay({
    key: checkout.keyId,
    order_id: checkout.rzpOrderId,
    amount: checkout.amount,
    currency: checkout.currency,
    name: checkout.name,
    description: checkout.description,
    prefill: checkout.prefill,
    notes: { order: checkout.receipt },
    theme: { color: "#7b2b2b" },
    modal: { ondismiss: () => onClosed && onClosed(), confirm_close: true },
    handler: (r) =>
      onPaid({ paymentId: r.razorpay_payment_id, rzpOrderId: r.razorpay_order_id, signature: r.razorpay_signature }),
  });
  rz.on("payment.failed", (r) => onFailed && onFailed((r && r.error && r.error.description) || ""));
  rz.open();
}
