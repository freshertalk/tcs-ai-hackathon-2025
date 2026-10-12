// src/auth/LoginScreen.jsx
// The sign-in, as a whole page. Used where a page cannot be shown to someone
// who is not signed in: the reading room, the cart, the account page, the
// admin pages.
//
// One quiet card under the site's own navigation bar: who is asking, why
// signing in is needed here, the acceptance of the policies, Google's button.
// There is one sign-in on this site (SignInCard); this only gives it a room.

import React from "react";
import { Link } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import { SignInCard } from "./SignInDialog";
import { contentUrl } from "../library/api";
import { BOOK } from "../data/books";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

const WHY = {
  read: {
    h: "पढ़ने के लिए साइन इन कीजिए",
    p: "किताब खोलने के लिए कृपया अपने Google खाते से एक बार साइन इन कीजिए। इसके बाद 30 दिन तक आपसे दोबारा नहीं पूछा जाएगा।",
  },
  account: {
    h: "अपना खाता देखने के लिए साइन इन कीजिए",
    p: "साइन इन करने पर आपकी खरीद, रसीदें और पढ़ने की प्रगति एक ही जगह दिखाई देंगी।",
  },
  checkout: {
    h: "खरीदने के लिए साइन इन कीजिए",
    p: "आपकी रसीद और खरीदी हुई किताब आपके खाते से जुड़ी रहेगी, इसलिए भुगतान से पहले एक बार साइन इन कीजिए।",
  },
  admin: {
    h: "एडमिन के लिए साइन इन",
    p: "यह पन्ना केवल एडमिन खातों के लिए है। कृपया अपने Google खाते से साइन इन कीजिए।",
  },
  default: {
    h: "साइन इन कीजिए",
    p: "कृपया अपने Google खाते से साइन इन कीजिए।",
  },
};

export default function LoginScreen({ reason = "default", book = null, error = "" }) {
  const w = WHY[reason] || WHY.default;
  const cover = book && book.coverSmall ? contentUrl(book.slug, book.coverSmall) : contentUrl(BOOK.slug, "cover-sm.jpg");

  return (
    <div data-theme="write" className="lp">
      <Nav links={NAV} kicker="साइन इन" />

      <main className="lp__main">
        <section className="lp__card" aria-labelledby="lp-title">
          <header className="lp__head">
            <img className="lp__cover" src={cover} alt="" width="52" height="73" />
            <div>
              <p className="lp__eyebrow">दो कुल्हड़ चाय · विनय कुमार तिवारी</p>
              <h1 id="lp-title" className="lp__t hi-d">
                {w.h}
              </h1>
            </div>
          </header>

          <p className="lp__p hi">{w.p}</p>

          {error ? (
            <p className="lp__err" role="alert">
              {error}
            </p>
          ) : null}

          <SignInCard />

          <p className="lp__fine hi">आपका Google पासवर्ड हमें कभी दिखाई नहीं देता। केवल आपका नाम, ई-मेल और फ़ोटो हमें मिलते हैं।</p>
        </section>

        <p className="lp__back">
          <Link to="/">← मुखपृष्ठ पर लौटिए</Link>
        </p>
      </main>

      <Footer />
    </div>
  );
}
