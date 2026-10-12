// src/shop/CheckoutPage.jsx
// Cart → confirm → pay → read, on one page.
//
//   1. कार्ट         the book, a coupon, the price as the collector works it out
//   2. पक्का करें    name, state (for GST), the tick-box — and "Confirm", which
//                    makes the order and its receipt
//   3. भुगतान        the receipt, with "Pay now" — Razorpay's own window takes
//                    the payment; this site never sees a card or a UPI PIN
//   4. पढ़िए         access is already given; the receipt is mailed
//
// Nothing on this page decides a price. A quote and an order are asked of the
// collector, which answers with amounts it has worked out itself; what the
// browser sends is a slug, a code, a name and a state.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import usePrivatePage from "../components/site/usePrivatePage";
import LoginScreen from "../auth/LoginScreen";
import { useAuth } from "../auth/google";
import { loadMe } from "../account/me";
import { BOOK } from "../data/books";
import { useBook } from "../library/hooks";
import { contentUrl } from "../library/api";
import { COUPON_REASON } from "../coupons/reasons";
import { Card, Loading } from "../admin/ui";
import { IconBook, IconCard, IconCart, IconCheck, IconLock, IconMail, IconPrint, IconReceipt, IconTag, IconTrash } from "../components/ui/icons";
import Receipt from "./Receipt";
import { addToCart, clearCart, removeFromCart, setCartCoupon, useCart } from "./store";
import { getQuote, getReceipt, openPayment, placeOrder, resendReceipt, resumePayment, shopMessage, verifyPayment } from "./api";
import { inr, inrShort, receiptLines } from "./format";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

const STEPS = [
  { id: "cart", label: "कार्ट" },
  { id: "details", label: "पक्का करें" },
  { id: "pay", label: "भुगतान" },
  { id: "done", label: "पढ़िए" },
];

function Steps({ step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="co__steps" aria-label="खरीद के चरण">
      {STEPS.map((s, i) => (
        <li key={s.id} className={i < at ? "is-past" : i === at ? "is-now" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="co__dot">{i < at ? <IconCheck size={14} strokeWidth={3} /> : i + 1}</span>
          <span className="co__lbl">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Summary({ amounts, caption = "भुगतान का हिसाब" }) {
  if (!amounts) return null;
  const lines = receiptLines({ amounts, status: "created" });
  return (
    <aside className="co__sum" aria-label={caption}>
      <h3>{caption}</h3>
      <table>
        <tbody>
          {lines.map((l) => (
            <tr key={l.k} className={`${l.total ? "is-total" : ""} ${l.good ? "is-good" : ""}`}>
              <th scope="row">{l.label}</th>
              <td className={l.strike ? "is-strike" : ""}>{l.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {amounts.tax.enabled && (
        <p className="co__sumNote">{amounts.tax.inclusive ? "GST मूल्य में शामिल है।" : "GST ऊपर से जुड़ा है।"}</p>
      )}
      {amounts.saved > 0 && (
        <p className="co__save">
          आप <b>{inr(amounts.saved)}</b> बचा रहे हैं
        </p>
      )}
    </aside>
  );
}

export default function CheckoutPage() {
  usePrivatePage("कार्ट और भुगतान");
  const { user } = useAuth();
  const cart = useCart();
  const [params, setParams] = useSearchParams();
  const { data: book } = useBook(BOOK.slug);

  const slug = BOOK.slug;
  const inCart = cart.items.some((i) => i.slug === slug);

  const [step, setStep] = useState("cart");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);
  const [code, setCode] = useState(cart.coupon || "");
  const [couponMsg, setCouponMsg] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", state: "", accept: false });
  const [order, setOrder] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(""); // order | pay | verify | resume | resend
  const [msg, setMsg] = useState(null); // { tone: bad | warn | ok, text }
  const [loadingOrder, setLoadingOrder] = useState(Boolean(params.get("order")));
  const consumed = useRef(false);
  const [tick, setTick] = useState(0); // a manual retry of the quote
  const working = useRef(false); // a tap in flight: a second one is ignored
  const lastCheck = useRef(0);

  /* arriving with ?buy=1 and/or ?coupon=… (the buy buttons and the coupon box) */
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const next = new URLSearchParams(params);
    let changed = false;
    if (next.get("buy")) {
      addToCart(slug);
      next.delete("buy");
      changed = true;
    }
    if (next.get("coupon")) {
      setCartCoupon(next.get("coupon"));
      setCode(String(next.get("coupon")).toUpperCase());
      next.delete("coupon");
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user && !form.name) setForm((f) => ({ ...f, name: user.name || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.email]);

  /* a return to an order already made (a reload, the account page, another device) */
  const orderId = params.get("order") || "";
  useEffect(() => {
    if (!user || !orderId) {
      setLoadingOrder(false);
      return undefined;
    }
    let live = true;
    setLoadingOrder(true);
    getReceipt(orderId)
      .then((d) => {
        if (!live) return;
        setOrder(d.order);
        if (d.order.status === "paid" || d.order.status === "free" || d.order.status === "refunded") {
          setStep("done");
        } else if (d.checkout) {
          setCheckout(d.checkout);
          setStep("pay");
        } else {
          setStep("cart");
        }
      })
      .catch((e) => live && setMsg({ tone: "bad", text: shopMessage(e) }))
      .finally(() => live && setLoadingOrder(false));
    return () => {
      live = false;
    };
  }, [user, orderId]);

  /* the price, as the collector works it out */
  useEffect(() => {
    if (!user || !inCart || step === "done") return undefined;
    let live = true;
    setQuoting(true);
    setQuoteErr(null);
    getQuote(slug, cart.coupon, form.state)
      .then((d) => {
        if (!live) return;
        setQuote(d);
        setCouponMsg(d.coupon && !d.coupon.valid ? COUPON_REASON[d.coupon.reason] || COUPON_REASON.unknown : "");
        if (d.coupon && !d.coupon.valid && cart.coupon) setCartCoupon("");
      })
      .catch((e) => live && setQuoteErr(e))
      .finally(() => live && setQuoting(false));
    return () => {
      live = false;
    };
  }, [user, inCart, slug, cart.coupon, form.state, step, tick]);

  const finish = useCallback(
    (o) => {
      setOrder(o);
      setCheckout(null);
      setStep("done");
      setMsg(null);
      removeFromCart(slug);
      loadMe({ force: true });
      const next = new URLSearchParams();
      next.set("order", o.id);
      setParams(next, { replace: true });
    },
    [setParams, slug]
  );

  const applyCoupon = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    setCouponMsg("");
    setCartCoupon(c);
  };

  const confirm = async () => {
    if (working.current) return;
    working.current = true;
    setBusy("order");
    setMsg(null);
    try {
      const d = await placeOrder({ slug, code: cart.coupon, name: form.name, phone: form.phone, state: form.state });
      if (d.owned) {
        loadMe({ force: true });
        removeFromCart(slug);
        setMsg({ tone: "ok", text: "यह किताब पहले से आपके खाते में है — आगे कोई भुगतान नहीं करना है।" });
        setStep("cart");
      } else if (d.valid === false) {
        setCartCoupon("");
        setCouponMsg(COUPON_REASON[d.reason] || COUPON_REASON.unknown);
        setStep("cart");
      } else if (d.free) {
        finish(d.order);
      } else {
        setOrder(d.order);
        setCheckout(d.checkout);
        setStep("pay");
        const next = new URLSearchParams();
        next.set("order", d.order.id);
        setParams(next, { replace: true });
      }
    } catch (e) {
      setMsg({ tone: "bad", text: shopMessage(e) });
    }
    working.current = false;
    setBusy("");
  };

  // The money has moved: confirm it, trying again a few times on a poor network
  // before asking the person to do anything (the collector settles it once only).
  const settle = async (r) => {
    setBusy("verify");
    setMsg(null);
    const waits = [0, 1200, 3000, 6000];
    for (let i = 0; i < waits.length; i++) {
      if (waits[i]) await new Promise((res) => setTimeout(res, waits[i]));
      try {
        const d = await verifyPayment(order.id, r);
        working.current = false;
        finish(d.order);
        return;
      } catch (e) {
        // an answer that will not change by asking again
        if (e && (e.code === "signature" || e.code === "mismatch" || e.code === "missing")) {
          setMsg({ tone: "bad", text: shopMessage(e) });
          working.current = false;
          setBusy("");
          return;
        }
      }
    }
    setMsg({
      tone: "warn",
      text: "आपका भुगतान हो गया लगता है, पर उसकी पुष्टि अभी नहीं मिल पाई। नीचे “भुगतान की जाँच कीजिए” दबाइए — पैसा दोबारा नहीं कटेगा।",
    });
    working.current = false;
    setBusy("");
  };

  const pay = async () => {
    if (!checkout || !order || working.current) return;
    working.current = true;
    setBusy("pay");
    setMsg(null);
    try {
      await openPayment(checkout, {
        onPaid: settle,
        onClosed: () => {
          working.current = false;
          setBusy((b) => (b === "pay" ? "" : b));
        },
        onFailed: (why) => {
          setMsg({ tone: "bad", text: why ? `भुगतान नहीं हो पाया: ${why}` : "भुगतान नहीं हो पाया — फिर कोशिश कीजिए।" });
          working.current = false;
          setBusy("");
        },
      });
    } catch {
      setMsg({ tone: "bad", text: "भुगतान की खिड़की खुल नहीं पाई — इंटरनेट देखकर फिर कोशिश कीजिए।" });
      working.current = false;
      setBusy("");
    }
  };

  // Coming back from a UPI app (or another tab) with the page still on "pay":
  // look once for the payment, quietly, so the person is not left wondering.
  useEffect(() => {
    if (step !== "pay" || !order || order.status !== "created") return undefined;
    const back = () => {
      if (document.visibilityState !== "visible" || busy === "verify") return;
      const now = Date.now();
      if (now - lastCheck.current < 15000) return;
      lastCheck.current = now;
      resumePayment(slug, order.id)
        .then((d) => {
          if (d.settled && d.orders && d.orders[0]) finish(d.orders[0]);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [step, order, busy, slug, finish]);

  // never close the tab in the middle of confirming a payment
  useEffect(() => {
    if (busy !== "verify") return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const recheck = async () => {
    setBusy("resume");
    setMsg(null);
    try {
      const d = await resumePayment(slug, order && order.id);
      if (d.settled && d.orders && d.orders[0]) finish(d.orders[0]);
      else setMsg({ tone: "warn", text: "अभी इस ऑर्डर का कोई भुगतान नहीं मिला। भुगतान हुआ हो तो एक-दो मिनट बाद फिर जाँचिए।" });
    } catch (e) {
      setMsg({ tone: "bad", text: shopMessage(e) });
    }
    setBusy("");
  };

  const resend = async () => {
    setBusy("resend");
    try {
      const d = await resendReceipt(order.id);
      setOrder((o) => ({ ...o, mailed: d.mailed }));
      setMsg({ tone: d.mailed === "sent" ? "ok" : "warn", text: d.mailed === "sent" ? `रसीद ${order.buyer.email} पर भेज दी गई है।` : "ई-मेल अभी भेजा नहीं जा सका — थोड़ी देर बाद फिर कोशिश कीजिए।" });
    } catch (e) {
      setMsg({ tone: "bad", text: shopMessage(e) });
    }
    setBusy("");
  };

  const frame = (children) => (
    <div data-theme="write" className="dsh co">
      <Nav links={NAV} kicker="कार्ट · भुगतान" />
      <main className="dsh__main">
        <div className="shell">{children}</div>
      </main>
      <Footer />
    </div>
  );

  if (!user) return <LoginScreen reason="checkout" book={book} />;

  if (loadingOrder) return frame(<Loading label="आपका ऑर्डर खुल रहा है…" />);

  const a = quote && quote.amounts;
  const gstAsksState = Boolean(a && a.tax.enabled && quote.seller && quote.seller.state);
  const stateOk = !gstAsksState || Boolean(form.state);
  const nameOk = form.name.trim().length >= 2;
  const canConfirm = Boolean(quote) && !quote.owned && nameOk && stateOk && form.accept && busy === "" && (a.totalPaise === 0 || quote.payments.ready);

  /* ------------------------------------------------------------- done */
  if (step === "done" && order) {
    const free = order.status === "free";
    const duplicate = order.status === "refunded" && /duplicate/.test(order.payment.status || "");
    const refunded = order.status === "refunded" && !duplicate;
    return frame(
      <>
        <Steps step="done" />
        <section className="co__done">
          <span className={`co__tick ${refunded ? "is-muted" : ""}`}>{refunded ? <IconReceipt size={34} /> : <IconCheck size={36} strokeWidth={2.6} />}</span>
          <h1 className="co__h">
            {duplicate ? "यह किताब पहले से आपकी है" : refunded ? "यह ऑर्डर रिफ़ंड हो चुका है" : free ? "आपका ऑर्डर पूरा हुआ" : "भुगतान सफल रहा — धन्यवाद!"}
          </h1>
          {duplicate && (
            <p className="co__lead hi">
              यह किताब पहले से आपके खाते में थी, इसलिए यह दूसरा भुगतान अपने-आप लौटा दिया गया है — राशि आमतौर पर 5–7 कार्य-दिवस में आपके भुगतान के साधन में आ जाती है।
            </p>
          )}
          {!refunded && !duplicate && (
            <p className="co__lead hi">
              <b>{order.item.title}</b> अब आपके खाते में <b>हमेशा के लिए</b> खुल चुकी है — इसके लिए आगे कोई शुल्क नहीं लगेगा।
            </p>
          )}
          <p className="co__mail" hidden={refunded || duplicate}>
            <IconMail size={17} />
            {order.mailed === "sent" ? (
              <span>रसीद और भुगतान का ब्योरा <b>{order.buyer.email}</b> पर भेज दिया गया है।</span>
            ) : order.mailed ? (
              <span>
                रसीद ई-मेल से अभी भेजी नहीं जा सकी — पर यह पन्ना और “मेरा खाता” में आपकी रसीद सुरक्षित है।{" "}
                <button type="button" className="lnk" onClick={resend} disabled={busy === "resend"}>
                  {busy === "resend" ? "भेज रहे हैं…" : "दोबारा भेजिए"}
                </button>
              </span>
            ) : (
              <span>रसीद आपके ई-मेल <b>{order.buyer.email}</b> पर भेजी जा रही है।</span>
            )}
          </p>
          {msg && (
            <p className={`co__msg is-${msg.tone}`} role="status">
              {msg.text}
            </p>
          )}
          <div className="co__act">
            {!refunded && (
              <Link className="db db--solid db--lg" to={`/read/${order.item.slug}`}>
                <IconBook size={19} /> किताब पढ़िए
              </Link>
            )}
            <button type="button" className="db db--ghost db--lg" onClick={() => window.print()}>
              <IconPrint size={18} /> रसीद प्रिंट कीजिए
            </button>
            <Link className="db db--ghost db--lg" to="/account">
              मेरा खाता
            </Link>
          </div>
        </section>
        <Receipt order={order} className="co__receipt" />
      </>
    );
  }

  /* ---------------------------------------------------- nothing to buy */
  if (!inCart && step !== "pay") {
    return frame(
      <section className="co__empty">
        <span className="co__tick is-muted">
          <IconCart size={32} />
        </span>
        <h1 className="co__h">आपका कार्ट खाली है</h1>
        {msg && (
          <p className={`co__msg is-${msg.tone}`} role="status">
            {msg.text}
          </p>
        )}
        <p className="co__lead hi">किताब कार्ट में जोड़िए, फिर यहीं से पक्का करके भुगतान कीजिए।</p>
        <div className="co__act">
          <button type="button" className="db db--solid db--lg" onClick={() => addToCart(slug)}>
            <IconCart size={18} /> “{BOOK.title}” कार्ट में जोड़िए
          </button>
          <Link className="db db--ghost db--lg" to="/account">
            मेरी खरीदें
          </Link>
        </div>
      </section>
    );
  }

  /* -------------------------------------------------------------- pay */
  if (step === "pay" && order) {
    const test = checkout && checkout.mode === "test";
    return frame(
      <>
        <Steps step="pay" />
        <div className="co__grid">
          <div className="co__main">
            <Card title="ऑर्डर बन गया — अब भुगतान कीजिए" sub="Your receipt is ready; the book opens the moment the payment is confirmed.">
              {test && (
                <p className="co__test" role="note">
                  <b>टेस्ट मोड</b> — असली पैसा नहीं कटेगा। टेस्ट UPI: <code>success@razorpay</code>, टेस्ट कार्ड: <code>4111 1111 1111 1111</code>
                </p>
              )}
              <div className="co__payRow">
                <div>
                  <p className="co__payAmt">{inr(order.amounts.total)}</p>
                  <p className="co__payFor hi">{order.item.title} · ई-बुक · हमेशा के लिए</p>
                </div>
                <button type="button" className="db db--solid db--lg co__pay" onClick={pay} disabled={busy !== "" || !checkout}>
                  <IconCard size={20} />
                  {busy === "verify" ? "पुष्टि हो रही है…" : busy === "pay" ? "भुगतान खुला है…" : `अभी भुगतान कीजिए · ${inr(order.amounts.total)}`}
                </button>
              </div>
              <ul className="co__trust">
                <li>
                  <IconLock size={16} /> भुगतान Razorpay की सुरक्षित खिड़की में होता है — कार्ट/UPI का विवरण इस साइट पर नहीं आता।
                </li>
                <li>
                  <IconCheck size={16} strokeWidth={2.4} /> UPI, कार्ड, नेट-बैंकिंग और वॉलेट से।
                </li>
                <li>
                  <IconMail size={16} /> भुगतान के बाद रसीद आपके ई-मेल पर आएगी और किताब अपने-आप खुल जाएगी।
                </li>
              </ul>
              {msg && (
                <p className={`co__msg is-${msg.tone}`} role="alert">
                  {msg.text}
                </p>
              )}
              <p className="co__small">
                भुगतान कर दिया था पर पन्ना नहीं बदला?{" "}
                <button type="button" className="lnk" onClick={recheck} disabled={busy !== ""}>
                  {busy === "resume" ? "जाँच रहे हैं…" : "भुगतान की जाँच कीजिए"}
                </button>
              </p>
            </Card>
            <Receipt order={order} />
          </div>
          <div className="co__side">
            <Summary amounts={order.amounts} caption="आपका ऑर्डर" />
            <button type="button" className="lnk co__back" onClick={() => { setStep("details"); setOrder(null); setCheckout(null); setParams(new URLSearchParams(), { replace: true }); }}>
              ← विवरण बदलना है
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ---------------------------------------------- cart and confirm */
  const showDetails = step === "details";
  return frame(
    <>
      <Steps step={showDetails ? "details" : "cart"} />
      <div className="co__grid">
        <div className="co__main">
          {!showDetails ? (
            <Card title="आपका कार्ट" sub="1 किताब · ई-बुक · एक बार का भुगतान, हमेशा की पहुँच">
              <div className="co__item">
                {book && book.coverSmall ? (
                  <img src={contentUrl(book.slug, book.coverSmall)} alt="" width="76" height="106" />
                ) : (
                  <span className="co__noimg" />
                )}
                <div className="co__itemBody">
                  <h3 className="hi-d">{BOOK.title}</h3>
                  <p className="hi">{BOOK.byline}</p>
                  <p className="co__price">
                    <s>{inrShort(BOOK.price.mrp)}</s> <b>{a ? inrShort(a.list) : inrShort(BOOK.price.selling)}</b>
                    <span>ई-बुक · आजीवन पहुँच</span>
                  </p>
                </div>
                <button type="button" className="co__rm" onClick={() => removeFromCart(slug)} aria-label="कार्ट से हटाइए">
                  <IconTrash size={18} />
                </button>
              </div>

              <form className="co__coupon" onSubmit={applyCoupon}>
                <label htmlFor="co-code">
                  <IconTag size={16} /> कूपन कोड
                </label>
                <div>
                  <input
                    id="co-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="कोड लिखिए (हो तो)"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck="false"
                    maxLength={24}
                  />
                  <button type="submit" className="db db--ghost" disabled={!code.trim() || quoting}>
                    लगाइए
                  </button>
                  {cart.coupon ? (
                    <button type="button" className="db db--ghost" onClick={() => { setCartCoupon(""); setCode(""); }}>
                      हटाइए
                    </button>
                  ) : null}
                </div>
                {a && a.coupon ? (
                  <p className="co__ok" role="status">
                    <IconCheck size={16} strokeWidth={2.6} /> कूपन <b>{a.coupon}</b> लग गया — {inr(a.discount)} की छूट
                  </p>
                ) : null}
                {couponMsg ? (
                  <p className="co__bad" role="alert">
                    {couponMsg}
                  </p>
                ) : null}
              </form>

              {quoteErr && (
                <p className="co__msg is-bad" role="alert">
                  {shopMessage(quoteErr)}{" "}
                  <button type="button" className="lnk" onClick={() => setTick((n) => n + 1)} disabled={quoting}>
                    फिर कोशिश कीजिए
                  </button>
                </p>
              )}
              {msg && <p className={`co__msg is-${msg.tone}`}>{msg.text}</p>}
              {quote && quote.owned ? (
                <div className="co__own">
                  <p className="hi">यह किताब पहले से आपके खाते में है।</p>
                  <Link className="db db--solid" to={`/read/${slug}`}>
                    <IconBook size={17} /> किताब पढ़िए
                  </Link>
                </div>
              ) : (
                <div className="co__act">
                  <button type="button" className="db db--solid db--lg" disabled={!quote || quoting} onClick={() => setStep("details")}>
                    आगे बढ़िए — पक्का करें
                  </button>
                  <button type="button" className="lnk" onClick={() => { clearCart(); }}>
                    कार्ट खाली कीजिए
                  </button>
                </div>
              )}
            </Card>
          ) : (
            <Card title="ऑर्डर पक्का कीजिए" sub="रसीद इन्हीं विवरणों से बनेगी">
              <div className="co__form">
                <label>
                  <span>रसीद पर नाम</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" maxLength={60} />
                </label>
                <label>
                  <span>ई-मेल (रसीद यहीं आएगी)</span>
                  <input value={user.email} readOnly aria-readonly="true" />
                </label>
                <label>
                  <span>मोबाइल (वैकल्पिक)</span>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+91 98765 43210"
                    maxLength={18}
                  />
                </label>
                {a && a.tax.enabled && (
                  <label>
                    <span>आपका राज्य (GST के लिए){gstAsksState ? "" : " — वैकल्पिक"}</span>
                    <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} autoComplete="address-level1">
                      <option value="">— राज्य चुनिए —</option>
                      {(quote.states || []).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <label className="co__tick2">
                <input type="checkbox" checked={form.accept} onChange={(e) => setForm({ ...form, accept: e.target.checked })} />
                <span className="hi">
                  मैंने <Link to="/terms" target="_blank">उपयोग की शर्तें</Link>, <Link to="/privacy" target="_blank">गोपनीयता नीति</Link> और{" "}
                  <Link to="/refund" target="_blank">रिफ़ंड नीति</Link> पढ़ ली हैं, और मैं समझता/समझती हूँ कि यह एक डिजिटल ई-बुक है जो मेरे खाते में ऑनलाइन पढ़ी जाती है।
                </span>
              </label>

              {quote && !quote.payments.ready && a.totalPaise > 0 && (
                <p className="co__msg is-warn" role="alert">
                  ऑनलाइन भुगतान अभी चालू नहीं है। कृपया थोड़ी देर बाद आइए, या लेखक को लिखिए।
                </p>
              )}
              {msg && (
                <p className={`co__msg is-${msg.tone}`} role="alert">
                  {msg.text}
                </p>
              )}

              <div className="co__act">
                <button type="button" className="db db--solid db--lg" onClick={confirm} disabled={!canConfirm}>
                  {busy === "order" ? "ऑर्डर बन रहा है…" : a && a.totalPaise === 0 ? "ऑर्डर पक्का कीजिए — मुफ़्त" : `ऑर्डर पक्का कीजिए · ${a ? inr(a.total) : ""}`}
                </button>
                <button type="button" className="lnk" onClick={() => setStep("cart")}>
                  ← कार्ट पर लौटिए
                </button>
              </div>
              <p className="co__small">“पक्का कीजिए” दबाने पर आपकी रसीद बनती है और भुगतान का बटन खुलता है। इस चरण पर कोई पैसा नहीं कटता।</p>
            </Card>
          )}
        </div>

        <div className="co__side">
          {quoting && !a ? <Loading label="हिसाब लगा रहे हैं…" /> : <Summary amounts={a} />}
        </div>
      </div>
    </>
  );
}
