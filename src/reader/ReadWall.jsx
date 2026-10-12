// src/reader/ReadWall.jsx
// Reading is for signed-in readers. This stands where the book would open:
// it checks that this account is signed in and has been given the key — and
// only then lets the reader mount.
//
// Acceptance of the Terms of Use, Privacy Policy and Refund Policy is asked in
// one place only: the sign-in dialog (src/auth/SignInDialog.jsx). This page
// carries no tick-box and no policy text of its own: when the reader is not
// signed in it opens that dialog, and offers a button to open it again. If an
// account turns out to have no acceptance on record, it is signed out and the
// same dialog is opened — never a second, different question mid-reading.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { signOut, useAuth } from "../auth/google";
import { localTermsAccepted, useLoginIssue } from "../legal/consent";
import { AccessError, accessRequired, ensureAccess } from "../auth/access";
import { openSignIn } from "../auth/SignInDialog";
import { contentUrl } from "../library/api";
// why the collector would not vouch for a lapsed sign-in (see verifyLapsedGoogle_)
const LAPSE = {
  "too-old": "आपका पिछला साइन-इन 30 दिन से भी पुराना है।",
  "key-unknown": "आपका पिछला साइन-इन इतना पुराना है कि उस पर Google की चाबी अब सर्वर नहीं जाँच सकता।",
  "other-app": "यह साइन-इन किसी और ऐप के लिए बना था।",
  "email-unverified": "इस खाते का ई-मेल Google ने सत्यापित नहीं किया है।",
};

const REASONS = {
  auth: "Google की जाँच पूरी नहीं हुई — बटन फिर दबाइए।",
  consent: "शर्तों की स्वीकृति सर्वर पर दर्ज नहीं हो पाई।",
  "consent-record": "आपकी स्वीकृति सर्वर पर दर्ज है, पर मेल नहीं खा रही — एडमिन को बताइए।",
  nokey: "इस संस्करण की चाबी सर्वर पर अभी नहीं है।",
  invalid: "सर्वर की स्क्रिप्ट पुरानी लगती है — नया संस्करण डिप्लॉय कीजिए।",
  unknown: "सर्वर की स्क्रिप्ट पुरानी लगती है — नया संस्करण डिप्लॉय कीजिए।",
  server: "सर्वर पर कोई गड़बड़ी हुई।",
  network: "सर्वर तक पहुँचा नहीं जा सका — इंटरनेट देखिए।",
};


export default function ReadWall({ book, children }) {
  const gated = accessRequired(book);
  const { user } = useAuth();
  const issue = useLoginIssue();
  const [state, setState] = useState(gated ? "checking" : "ok"); // checking | ok | signin | nokey | error
  const [why, setWhy] = useState("");
  const redirected = useRef(false);
  const asked = useRef(false);

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

  // This page has no sign-in of its own. If the book cannot be opened for the
  // person it is because the sign-in they hold could not be verified; it is
  // ended, and the one sign-in (the same as in the navigation bar) opens, once.
  const [seen, setSeen] = useState(null);
  useEffect(() => {
    if (state !== "signin" || asked.current) return;
    asked.current = true;
    setSeen(issue);
    if (user) signOut();
    openSignIn("read");
  }, [state, user, issue]);

  if (!gated || state === "ok") return children;

  return (
    <div className="rd rd--scroll rdw" data-theme="paper">
      <div className="rdw__card">
        {book.coverSmall && (
          <img
            className="rdw__cover"
            src={contentUrl(book.slug, book.coverSmall)}
            alt=""
            width="120"
            height="168"
          />
        )}
        <h1 className="rdw__t hi-d">{book.title}</h1>
        <p className="rdw__by">{book.author}</p>

        {state === "checking" && (
          <p className="rdw__p" role="status">
            आपका खाता जाँचा जा रहा है…
          </p>
        )}

        {state === "signin" && (
          <>
            <p className="rdw__p hi">
              {why === "consent"
                ? "आगे पढ़ने के लिए फिर से साइन इन कीजिए।"
                : "यह किताब केवल साइन-इन किए हुए पाठकों के लिए खुलती है। Google से साइन इन कीजिए — आपकी पढ़ने की जगह, बुकमार्क और रेखांकन भी आपके सभी डिवाइस पर साथ चलेंगे।"}
            </p>
            {issue || seen ? (
              <p className="rdw__issue" role="alert">
                {(() => {
                  const i = issue || seen;
                  return i.code === "renew-auth"
                    ? LAPSE[i.why] || `पुराने साइन-इन को सर्वर ने नहीं माना${i.why ? ` (${i.why})` : ""}।`
                    : REASONS[i.code] || `कारण: ${i.code}`;
                })()}
              </p>
            ) : null}
            <button type="button" className="rdw__go" onClick={() => openSignIn("read")}>
              साइन इन
            </button>
          </>
        )}

        {state === "nokey" && (
          <p className="rdw__p hi" role="alert">
            यह संस्करण अभी पढ़ने के लिए खोला नहीं गया है। कृपया थोड़ी देर बाद फिर आइए।
          </p>
        )}

        {state === "error" && (
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
