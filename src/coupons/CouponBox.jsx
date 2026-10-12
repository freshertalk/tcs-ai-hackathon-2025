// src/coupons/CouponBox.jsx
// "कूपन कोड है?" — where a reader tries a discount code.
//
// The reader types a code; the collector checks it for *this* account (who may
// use it, how many times, until when, for which book) and answers with the
// price. A code is only counted once the reader presses "कूपन पक्का करें", which
// writes a receipt (a reference like KC-…) in the owner's ledger.
//
// There is no payment gateway on this site. The receipt says what to pay and
// carries a reference; where payment is taken (BOOK.price.buyUrl, once there is
// one) the reference and amount are passed along, and until then the receipt
// offers an e-mail to the author with the same details.

import React, { useState } from "react";
import { BOOK, AUTHOR } from "../data/books";
import { useAuth } from "../auth/google";
import { openSignIn } from "../auth/SignInDialog";
import { call, collectorAvailable, explain } from "../api/collector";
import { IconCheck, IconCopy, IconTag } from "../components/ui/icons";
import { fmtDate } from "../reader/util";

const REASON = {
  unknown: "यह कूपन कोड सही नहीं लगता — लिखावट देखकर फिर कोशिश कीजिए।",
  inactive: "यह कूपन अभी रुका हुआ है।",
  expired: "इस कूपन की अवधि पूरी हो चुकी है।",
  not_started: "यह कूपन अभी शुरू नहीं हुआ है।",
  exhausted: "यह कूपन पूरा इस्तेमाल हो चुका है।",
  used_by_you: "आप यह कूपन पहले ही इस्तेमाल कर चुके हैं।",
  not_eligible: "यह कूपन आपके खाते के लिए नहीं है।",
  wrong_book: "यह कूपन इस किताब के लिए नहीं है।",
  signin: "कूपन लगाने के लिए पहले साइन इन कीजिए।",
  limited: "बहुत ज़्यादा कोशिशें हो गईं — थोड़ी देर बाद फिर कोशिश कीजिए।",
};

const rs = (n) => `₹ ${n}/=`;

export default function CouponBox({ slug = BOOK.slug, className = "" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [st, setSt] = useState({ phase: "idle" }); // idle | checking | valid | invalid | claiming | claimed | error
  const [copied, setCopied] = useState(false);

  if (slug !== BOOK.slug || !collectorAvailable()) return null;

  const reset = () => setSt({ phase: "idle" });

  const check = async (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    if (!user) {
      setSt({ phase: "invalid", reason: "signin" });
      openSignIn("coupon");
      return;
    }
    setSt({ phase: "checking" });
    try {
      const d = await call("coupon_check", { code: c, slug });
      if (d.valid) setSt({ phase: "valid", offer: d });
      else setSt({ phase: "invalid", reason: d.reason || "unknown" });
    } catch (err) {
      setSt({ phase: "error", text: explain(err) });
    }
  };

  const claim = async () => {
    const c = code.trim().toUpperCase();
    setSt((s) => ({ ...s, phase: "claiming" }));
    try {
      const d = await call("coupon_redeem", { code: c, slug });
      if (d.valid === false) setSt({ phase: "invalid", reason: d.reason || "unknown" });
      else setSt({ phase: "claimed", offer: d });
    } catch (err) {
      setSt({ phase: "error", text: explain(err) });
    }
  };

  const offer = st.offer;
  const payUrl = (() => {
    if (!offer) return "";
    const q = `coupon=${encodeURIComponent(offer.code)}&ref=${encodeURIComponent(offer.reference || "")}&amount=${offer.final}`;
    if (BOOK.price.buyUrl) return `${BOOK.price.buyUrl}${BOOK.price.buyUrl.includes("?") ? "&" : "?"}${q}`;
    const body = `${BOOK.title}\nकूपन: ${offer.code}\nरसीद संख्या: ${offer.reference}\nदेय राशि: ₹${offer.final}\nखाता: ${user ? user.email : ""}\n`;
    return `mailto:${AUTHOR.connect.email}?subject=${encodeURIComponent(`${BOOK.title} — कूपन ${offer.code} (${offer.reference})`)}&body=${encodeURIComponent(body)}`;
  })();

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(offer.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the number is on the screen */
    }
  };

  if (!open) {
    return (
      <button type="button" className={`cpn__open ${className}`} onClick={() => setOpen(true)}>
        <IconTag size={16} />
        <span>कूपन कोड है?</span>
      </button>
    );
  }

  return (
    <div className={`cpn ${className}`}>
      {st.phase !== "claimed" && (
        <form className="cpn__form" onSubmit={check}>
          <label className="sr-only" htmlFor={`cpn-${slug}`}>
            कूपन कोड
          </label>
          <input
            id={`cpn-${slug}`}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (st.phase !== "idle") reset();
            }}
            placeholder="कूपन कोड लिखिए"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            maxLength={24}
          />
          <button type="submit" disabled={!code.trim() || st.phase === "checking" || st.phase === "claiming"}>
            {st.phase === "checking" ? "जाँच रहे हैं…" : "लगाइए"}
          </button>
          <button type="button" className="cpn__x" aria-label="बंद कीजिए" onClick={() => { setOpen(false); reset(); }}>
            ✕
          </button>
        </form>
      )}

      {st.phase === "invalid" && (
        <p className="cpn__bad" role="alert">
          {REASON[st.reason] || REASON.unknown}
        </p>
      )}
      {st.phase === "error" && (
        <p className="cpn__bad" role="alert">
          {st.text}
        </p>
      )}

      {(st.phase === "valid" || st.phase === "claiming") && offer && (
        <div className="cpn__ok" role="status">
          <p className="cpn__line">
            <IconCheck size={18} strokeWidth={2.4} />
            <span>
              कूपन <b>{offer.code}</b> लग गया
            </span>
          </p>
          <p className="cpn__price">
            <s>{rs(offer.list)}</s> <b>{offer.final === 0 ? "मुफ़्त" : rs(offer.final)}</b>
            <span>आप ₹ {offer.discount} बचा रहे हैं</span>
          </p>
          {offer.until ? <p className="cpn__until">{fmtDate(offer.until.slice(0, 10))} तक मान्य</p> : null}
          <button type="button" className="cpn__claim" onClick={claim} disabled={st.phase === "claiming"}>
            {st.phase === "claiming" ? "पक्का कर रहे हैं…" : "कूपन पक्का करें"}
          </button>
          <p className="cpn__fine">पक्का करने पर आपकी रसीद बनेगी और यह कूपन आपके खाते से एक बार गिना जाएगा।</p>
        </div>
      )}

      {st.phase === "claimed" && offer && (
        <div className="cpn__done" role="status">
          <p className="cpn__line">
            <IconCheck size={18} strokeWidth={2.4} />
            <span>आपकी रसीद बन गई</span>
          </p>
          <p className="cpn__price">
            <s>{rs(offer.list)}</s> <b>{offer.final === 0 ? "मुफ़्त" : rs(offer.final)}</b>
          </p>
          <p className="cpn__ref">
            रसीद संख्या <code>{offer.reference}</code>
            <button type="button" className="cpn__copy" onClick={copyRef} aria-label="रसीद संख्या कॉपी कीजिए">
              <IconCopy size={15} /> {copied ? "कॉपी हो गई" : "कॉपी"}
            </button>
          </p>
          <a className="cpn__claim" href={payUrl} {...(BOOK.price.buyUrl ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {offer.final === 0 ? "लेखक को ई-मेल कीजिए" : BOOK.price.buyUrl ? "भुगतान कीजिए" : "भुगतान के लिए लेखक को लिखिए"}
          </a>
          <p className="cpn__fine">यह रसीद आपके “मेरा खाता” पन्ने पर भी दिखेगी।</p>
        </div>
      )}
    </div>
  );
}
