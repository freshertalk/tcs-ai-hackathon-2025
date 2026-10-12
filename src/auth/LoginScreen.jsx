// src/auth/LoginScreen.jsx
// The sign-in, as a whole page. Used where a page cannot be shown to someone
// who is not signed in: the reading room, the account page, the admin pages.
//
// There is one sign-in on this site (SignInCard). This only gives it a room.

import React from "react";
import { Link } from "react-router-dom";
import { SignInArt, SignInCard } from "./SignInDialog";
import { IconBook, IconBookmark, IconStar } from "../components/ui/icons";
import { contentUrl } from "../library/api";

const WHY = {
  read: {
    h: "पढ़ने के लिए साइन इन कीजिए",
    p: "यह किताब केवल साइन-इन किए हुए पाठकों के लिए खुलती है। एक बार साइन इन कीजिए — फिर 30 दिन तक आपसे कुछ नहीं पूछा जाएगा।",
  },
  account: {
    h: "अपना खाता खोलिए",
    p: "साइन इन करने पर आपकी पढ़ने की प्रगति, बुकमार्क, रेखांकन और आपकी राय एक जगह दिखेंगी।",
  },
  admin: {
    h: "एडमिन के लिए साइन इन",
    p: "डैशबोर्ड केवल एडमिन खातों के लिए है। अपने Google खाते से साइन इन कीजिए।",
  },
  default: {
    h: "स्वागत है",
    p: "Google से साइन इन कीजिए — आपकी पढ़ने की जगह, बुकमार्क और रेखांकन आपके सभी डिवाइस पर साथ चलेंगे।",
  },
};

const BENEFITS = [
  { Icon: IconBook, t: "जहाँ छोड़ा था, वहीं से", d: "आपकी पढ़ने की जगह हर डिवाइस पर एक-सी" },
  { Icon: IconBookmark, t: "बुकमार्क और रेखांकन", d: "आपके पन्ने, आपकी पंक्तियाँ — सहेजी हुई" },
  { Icon: IconStar, t: "अपने नाम से राय", d: "रेटिंग और टिप्पणी, जिसे आप कभी बदल सकें" },
];

export default function LoginScreen({ reason = "default", book = null, error = "" }) {
  const w = WHY[reason] || WHY.default;

  return (
    <main className="ls" data-theme="write">
      <SignInArt />

      <section className="ls__form" aria-labelledby="ls-title">
        <div className="ls__card">
          {book && book.coverSmall ? (
            <img
              className="ls__cover"
              src={contentUrl(book.slug, book.coverSmall)}
              alt=""
              width="84"
              height="118"
            />
          ) : null}
          <p className="ls__eyebrow">दो कुल्हड़ चाय · विनय कुमार तिवारी</p>
          <h1 id="ls-title" className="ls__t hi-d">
            {w.h}
          </h1>
          <p className="ls__p hi">{w.p}</p>

          {error ? (
            <p className="ls__err" role="alert">
              {error}
            </p>
          ) : null}

          <ul className="ls__why">
            {BENEFITS.map(({ Icon, t, d }) => (
              <li key={t}>
                <span className="ls__ico">
                  <Icon size={20} />
                </span>
                <span>
                  <b className="hi-d">{t}</b>
                  <small className="hi">{d}</small>
                </span>
              </li>
            ))}
          </ul>

          <SignInCard />

          <p className="ls__fine" lang="en">
            We never see your Google password. Signing in records your acceptance of the policies as evidence.
          </p>
          <p className="ls__back">
            <Link to="/">← मुख पृष्ठ</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
