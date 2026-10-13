// src/shop/PurchaseGate.jsx
// Shown where the book would open, to someone who is signed in but does not
// own it yet. A short, polite note in plain Hindi: what to do, what they get,
// what it costs — and a way back if they have in fact already paid (the check
// asks the collector again) or bought with another account.
//
// Reading is for paid accounts only; this page is the whole of what anyone
// else is shown. The text of the book is not on this page, nor in any file the
// browser can open without the key the collector releases to owners.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import { signOut, useAuth } from "../auth/google";
import { contentUrl } from "../library/api";
import { BOOK } from "../data/books";
import { IconBook, IconCard, IconCart, IconCheck, IconMail } from "../components/ui/icons";
import { loadMe } from "../account/me";
import { addToCart } from "./store";
import { resumePayment } from "./api";
import { inrShort } from "./format";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

const POINTS = [
  { Icon: IconCard, t: "एक बार का भुगतान", d: "कोई सब्सक्रिप्शन नहीं" },
  { Icon: IconBook, t: "हमेशा के लिए आपकी", d: "आगे कोई शुल्क नहीं · वेबसाइट की उपलब्धता के अधीन" },
  { Icon: IconCheck, t: "भुगतान होते ही खुल जाती है", d: "अपने-आप, बिना किसी इंतज़ार के" },
  { Icon: IconMail, t: "रसीद ई-मेल पर", d: "आपके खाते के पते पर" },
];

export default function PurchaseGate({ book, onRecheck }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const first = String((user && user.name) || "").trim().split(/\s+/)[0];
  const cover = book.coverSmall ? contentUrl(book.slug, book.coverSmall) : contentUrl(BOOK.slug, "cover-sm.jpg");
  const priced = book.slug === BOOK.slug;

  const recheck = async () => {
    setBusy(true);
    setNote("");
    try {
      const d = await resumePayment(book.slug);
      if (d && (d.settled || d.owned)) {
        loadMe({ force: true });
        onRecheck();
        return;
      }
      setNote("अभी इस खाते में इस किताब का कोई भुगतान नहीं मिला। भुगतान अभी किया हो तो एक-दो मिनट बाद फिर देखिए।");
    } catch {
      setNote("जाँच नहीं हो पाई — इंटरनेट देखकर फिर कोशिश कीजिए।");
    }
    setBusy(false);
  };

  return (
    <div data-theme="write" className="lp">
      <Nav links={NAV} kicker="किताब खोलिए" />

      <main className="lp__main">
        <section className="lp__card pg" aria-labelledby="pg-title">
          <header className="lp__head">
            <img className="lp__cover" src={cover} alt="" width="52" height="73" />
            <div>
              <p className="lp__eyebrow">
                {book.title} · {book.author}
              </p>
              <h1 id="pg-title" className="lp__t hi-d">
                इस पुस्तक को पढ़ने के लिए कृपया पहले इसे खरीदें
              </h1>
            </div>
          </header>

          <p className="lp__p hi">
            {first ? `नमस्ते ${first}! ` : "नमस्ते! "}
            आप <b>{user && user.email}</b> से साइन इन हैं, और यह किताब अभी आपके खाते में उपलब्ध नहीं है।
          </p>

          <ul className="pg__points">
            {POINTS.map(({ Icon, t, d }) => (
              <li key={t}>
                <span className="pg__ico">
                  <Icon size={16} />
                </span>
                <span>
                  <b className="hi-d">{t}</b>
                  <small className="hi">{d}</small>
                </span>
              </li>
            ))}
          </ul>

          {priced && (
            <p className="pg__price">
              <span>ई-बुक · विशेष मूल्य</span>
              <s>{inrShort(BOOK.price.mrp)}</s>
              <b>{inrShort(BOOK.price.selling)}</b>
            </p>
          )}

          <div className="pg__act">
            <Link className="db db--solid db--lg" to="/checkout?buy=1" onClick={() => addToCart(book.slug)}>
              <IconCart size={18} /> किताब खरीदिए
            </Link>
            <a className="db db--ghost db--lg" href="/#opening">
              पहला पन्ना देखिए
            </a>
          </div>

          <div className="pg__help">
            <p className="hi">
              पहले ही खरीद चुके हैं?{" "}
              <button type="button" className="lnk" onClick={recheck} disabled={busy}>
                {busy ? "जाँच रहे हैं…" : "भुगतान की जाँच कीजिए"}
              </button>
            </p>
            <p className="hi">
              किसी और खाते से खरीदी थी?{" "}
              <button type="button" className="lnk" onClick={signOut}>
                दूसरे खाते से साइन इन कीजिए
              </button>
            </p>
            {note && (
              <p className="pg__note" role="status">
                {note}
              </p>
            )}
          </div>
        </section>

        <p className="lp__back">
          <Link to="/">← मुखपृष्ठ पर लौटिए</Link>
        </p>
      </main>

      <Footer />
    </div>
  );
}
