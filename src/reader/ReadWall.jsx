// src/reader/ReadWall.jsx
// Reading is for signed-in readers. This stands where the book would open.
//
//   signed in, key on the device   → the book, at once (no screen in between)
//   signed in, key to be fetched   → one turning ring, then the book — nothing
//                                    else is shown
//   not signed in                  → the full sign-in screen
//
// The page has no sign-in of its own: the screen it shows is the same one the
// navigation bar's icon opens (src/auth/SignInDialog.jsx), acceptance of the
// Terms of Use, Privacy Policy and Refund Policy included. If the book cannot
// be opened for the person because the sign-in they hold cannot be verified,
// it is ended and they are shown that screen, with the reason.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { signOut, useAuth } from "../auth/google";
import { localTermsAccepted, useLoginIssue } from "../legal/consent";
import { AccessError, accessRequired, ensureAccess } from "../auth/access";
import LoginScreen from "../auth/LoginScreen";
import { contentUrl } from "../library/api";
import { LEGAL } from "../data/legal";

// why the collector would not vouch for a lapsed sign-in (see verifyLapsedGoogle_)
const LAPSE = {
  "too-old": "आपका पिछला साइन-इन 30 दिन से भी पुराना है।",
  "key-unknown": "आपका पिछला साइन-इन इतना पुराना है कि उस पर Google की चाबी अब सर्वर नहीं जाँच सकता।",
  "other-app": "यह साइन-इन किसी और ऐप के लिए बना था।",
  "email-unverified": "इस खाते का ई-मेल Google ने सत्यापित नहीं किया है।",
};

const REASONS = {
  auth: "Google की जाँच पूरी नहीं हुई — फिर कोशिश कीजिए।",
  consent: "शर्तों की स्वीकृति सर्वर पर दर्ज नहीं हो पाई।",
  "consent-record": "आपकी स्वीकृति सर्वर पर दर्ज है, पर मेल नहीं खा रही — एडमिन को बताइए।",
  nokey: "इस संस्करण की चाबी सर्वर पर अभी नहीं है।",
  invalid: "सर्वर की स्क्रिप्ट पुरानी लगती है — नया संस्करण डिप्लॉय कीजिए।",
  unknown: "सर्वर की स्क्रिप्ट पुरानी लगती है — नया संस्करण डिप्लॉय कीजिए।",
  server: "सर्वर पर कोई गड़बड़ी हुई।",
  network: "सर्वर तक पहुँचा नहीं जा सका — इंटरनेट देखिए।",
};

function reasonText(i) {
  if (!i) return "";
  if (i.code === "edition-skew") {
    return `साइट अभी अपडेट हो रही है, इसलिए किताब अभी नहीं खुल सकती — थोड़ी देर बाद फिर कोशिश कीजिए। (साइट के मालिक के लिए: शर्तों का संस्करण साइट पर ${LEGAL.version} है, पर Google स्क्रिप्ट पर ${i.why || "पुराना"}। scripts/reviews-apps-script.gs को नए संस्करण (New version) के रूप में डिप्लॉय कीजिए।)`;
  }
  if (i.code === "renew-auth") {
    return LAPSE[i.why] || `पुराने साइन-इन को सर्वर ने नहीं माना${i.why ? ` (${i.why})` : ""}।`;
  }
  return REASONS[i.code] || `कारण: ${i.code}`;
}

export default function ReadWall({ book, children }) {
  const gated = accessRequired(book);
  const { user } = useAuth();
  const issue = useLoginIssue();
  // a person who is plainly signed out never sees a spinner first
  const [state, setState] = useState(!gated ? "ok" : user ? "checking" : "signin"); // checking | ok | signin | nokey | error
  const [why, setWhy] = useState("");
  const [seen, setSeen] = useState(null);
  const redirected = useRef(false);
  const ended = useRef(false);

  const check = useCallback(() => {
    if (!gated) return;
    if (!user) {
      setState("signin");
      return;
    }
    setState("checking");
    ensureAccess(book)
      .then(() => setState("ok"))
      .catch((e) => {
        const code = e instanceof AccessError ? e.code : "error";
        if (code === "consent" && !redirected.current && !localTermsAccepted()) {
          // no acceptance on record anywhere: back to the one place it is given
          redirected.current = true;
          setWhy("consent");
          signOut();
          return;
        }
        setState(code === "signin" || code === "consent" ? "signin" : code);
      });
  }, [gated, user, book]);

  // signing out takes the book away again, at once
  useEffect(() => {
    check();
  }, [check]);

  // The book could not be opened for someone who is "signed in": that sign-in
  // cannot be verified. End it, once, and keep the reason for the screen.
  useEffect(() => {
    if (state !== "signin" || ended.current || !user) return;
    ended.current = true;
    setSeen(issue);
    signOut();
  }, [state, user, issue]);

  if (!gated || state === "ok") return children;

  if (state === "checking") {
    return (
      <div className="qgate" role="status" aria-live="polite">
        <span className="qgate__ring" />
        <span className="sr-only">किताब खुल रही है…</span>
      </div>
    );
  }

  if (state === "signin") {
    const i = issue || seen;
    return (
      <LoginScreen
        reason="read"
        book={book}
        error={why === "consent" ? "आगे पढ़ने के लिए फिर से साइन इन कीजिए।" : reasonText(i)}
      />
    );
  }

  return (
    <div className="rd rd--scroll rdw" data-theme="paper">
      <div className="rdw__card">
        {book.coverSmall && (
          <img className="rdw__cover" src={contentUrl(book.slug, book.coverSmall)} alt="" width="120" height="168" />
        )}
        <h1 className="rdw__t hi-d">{book.title}</h1>
        <p className="rdw__by">{book.author}</p>

        {state === "nokey" ? (
          <p className="rdw__p hi" role="alert">
            यह संस्करण अभी पढ़ने के लिए खोला नहीं गया है। कृपया थोड़ी देर बाद फिर आइए।
          </p>
        ) : (
          <>
            <p className="rdw__p hi" role="alert">
              अभी किताब नहीं खुल पाई। इंटरनेट देखकर फिर कोशिश कीजिए।
            </p>
            <button type="button" className="rdw__go" onClick={check}>
              फिर कोशिश कीजिए
            </button>
          </>
        )}

        <p className="rdw__back">
          <Link to="/">← मुख पृष्ठ</Link>
        </p>
      </div>
    </div>
  );
}
