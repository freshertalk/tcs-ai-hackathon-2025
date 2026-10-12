// src/coupons/CouponBox.jsx
// "कूपन कोड है?" — where a reader tries a discount code before buying.
//
// The collector checks the code for *this* account (who may use it, how many
// times, until when, for which book) and answers with the price. Nothing is
// counted here: a code is used only when an order that carries it is paid (or
// completes free) — so trying a code costs nothing and uses nothing up.
// "इस कूपन से खरीदिए" takes the reader to the checkout with the code applied.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { BOOK } from "../data/books";
import { useAuth } from "../auth/google";
import { openSignIn } from "../auth/SignInDialog";
import { call, collectorAvailable, explain } from "../api/collector";
import { IconCart, IconCheck, IconTag } from "../components/ui/icons";
import { fmtDate } from "../reader/util";
import { COUPON_REASON } from "./reasons";
import { addToCart, setCartCoupon } from "../shop/store";
import { useOwns } from "../shop/BuyBar";

const rs = (n) => `₹ ${n}/=`;

export default function CouponBox({ slug = BOOK.slug, className = "" }) {
  const { user } = useAuth();
  const owns = useOwns(slug);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [st, setSt] = useState({ phase: "idle" }); // idle | checking | valid | invalid | error

  if (slug !== BOOK.slug || !collectorAvailable() || owns) return null;

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

  const offer = st.offer;

  if (!open) {
    return (
      <button type="button" className={`cpn__open ${className}`} onClick={() => setOpen(true)}>
        <IconTag size={15} />
        <span>कूपन</span>
      </button>
    );
  }

  return (
    <div className={`cpn ${className}`}>
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
        <button type="submit" disabled={!code.trim() || st.phase === "checking"}>
          {st.phase === "checking" ? "जाँच रहे हैं…" : "लगाइए"}
        </button>
        <button
          type="button"
          className="cpn__x"
          aria-label="बंद कीजिए"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          ✕
        </button>
      </form>

      {st.phase === "invalid" && (
        <p className="cpn__bad" role="alert">
          {COUPON_REASON[st.reason] || COUPON_REASON.unknown}
        </p>
      )}
      {st.phase === "error" && (
        <p className="cpn__bad" role="alert">
          {st.text}
        </p>
      )}

      {st.phase === "valid" && offer && (
        <div className="cpn__ok" role="status">
          <p className="cpn__line">
            <IconCheck size={18} strokeWidth={2.4} />
            <span>
              कूपन <b>{offer.code}</b> लग सकता है
            </span>
          </p>
          <p className="cpn__price">
            <s>{rs(offer.list)}</s> <b>{offer.final === 0 ? "मुफ़्त" : rs(offer.final)}</b>
            <span>आप ₹ {offer.discount} बचा रहे हैं</span>
          </p>
          {offer.until ? <p className="cpn__until">{fmtDate(offer.until.slice(0, 10))} तक मान्य</p> : null}
          <Link
            className="cpn__claim"
            to={`/checkout?buy=1&coupon=${encodeURIComponent(offer.code)}`}
            onClick={() => {
              addToCart(slug);
              setCartCoupon(offer.code);
            }}
          >
            <IconCart size={16} /> इस कूपन से खरीदिए
          </Link>
          <p className="cpn__fine">कूपन तभी गिना जाएगा जब आपका ऑर्डर पूरा होगा — यहाँ जाँचने से कुछ खर्च नहीं होता।</p>
        </div>
      )}
    </div>
  );
}
