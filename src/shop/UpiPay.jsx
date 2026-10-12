// src/shop/UpiPay.jsx
// Paying by Google Pay (or any UPI app) straight to the author's UPI ID.
//
// There is no gateway to tell the site that money arrived, so the order goes
// through one extra, honest step: the reader pays, writes down the 12-digit UPI
// transaction number their app shows, and the order waits until the author has
// seen the money and confirms it (Admin → Sales). Only then is the book opened
// and the receipt mailed. The page offers:
//   • on a phone, a button that opens Google Pay with the amount filled in
//   • on a computer, a QR code to scan from the phone, and the UPI ID to copy

import React, { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Card } from "../admin/ui";
import { IconCheck, IconClock, IconCopy, IconMail } from "../components/ui/icons";
import { inr } from "./format";

const ua = () => (typeof navigator !== "undefined" ? navigator.userAgent || "" : "");

function Qr({ text }) {
  const svg = useMemo(() => {
    try {
      const q = qrcode(0, "M");
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      return "";
    }
  }, [text]);
  if (!svg) return null;
  // the markup is generated here from the payment link; nothing comes from outside
  return <span className="upi__qr" role="img" aria-label="भुगतान का QR कोड" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Copy({ text, label }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* the text is on the screen */
    }
  };
  return (
    <button type="button" className="upi__copy" onClick={go} aria-label={label}>
      {done ? <IconCheck size={14} strokeWidth={2.6} /> : <IconCopy size={14} />}
      {done ? "कॉपी हो गया" : "कॉपी"}
    </button>
  );
}

export default function UpiPay({ order, checkout, onClaim, onRefresh, busy, msg }) {
  const [utr, setUtr] = useState("");
  const u = checkout.upi;
  const agent = ua();
  const android = /Android/i.test(agent);
  const ios = /iPhone|iPad|iPod/i.test(agent);
  const mobile = android || ios;
  const digits = utr.replace(/\D/g, "");
  const ok = digits.length === 12;
  const claim = order.claim;

  /* ---- the number is in; waiting for the author to see the money ---- */
  if (order.status === "pending") {
    return (
      <Card title="भुगतान की जानकारी मिल गई" sub="We have your payment details — waiting for confirmation">
        <div className="upi__wait">
          <span className="upi__clock">
            <IconClock size={26} />
          </span>
          <div>
            <p className="hi">
              आपने <b>{inr(order.amounts.total)}</b> का UPI भुगतान बताया है
              {claim && claim.utr ? (
                <>
                  , लेन-देन संख्या <code>{claim.utr}</code>
                </>
              ) : null}
              ।
            </p>
            <p className="hi">
              लेखक रकम देखते ही पुष्टि करेंगे — उसके बाद किताब आपके खाते में <b>हमेशा के लिए</b> खुल जाएगी और रसीद{" "}
              <b>{order.buyer.email}</b> पर आ जाएगी। इस पन्ने को खुला रखना ज़रूरी नहीं।
            </p>
          </div>
        </div>
        <div className="co__act">
          <button type="button" className="db db--solid" onClick={onRefresh} disabled={busy !== ""}>
            {busy === "refresh" ? "जाँच रहे हैं…" : "स्थिति जाँचिए"}
          </button>
        </div>
        {msg && (
          <p className={`co__msg is-${msg.tone}`} role="status">
            {msg.text}
          </p>
        )}
      </Card>
    );
  }

  /* ---- pay, then say what number the app showed ---- */
  const payHref = android ? u.android : ios ? u.ios : u.link;
  const amount = inr(u.amount);

  return (
    <Card title="Google Pay / UPI से भुगतान कीजिए" sub="Pay directly with Google Pay or any UPI app">
      <div className="co__payRow">
        <div>
          <p className="co__payAmt">{amount}</p>
          <p className="co__payFor hi">{order.item.title} · ई-बुक · हमेशा के लिए</p>
        </div>
        {mobile && (
          <a className="db db--solid db--lg co__pay" href={payHref}>
            Google Pay खोलिए
          </a>
        )}
      </div>

      {claim && claim.rejected ? (
        <p className="co__msg is-warn" role="alert">
          पिछली जानकारी की पुष्टि नहीं हो पाई: {claim.rejected} कृपया नीचे सही संख्या लिखिए।
        </p>
      ) : null}

      <ol className="upi__steps">
        <li>
          <b>भुगतान कीजिए।</b>
          {mobile ? (
            <span>
              ऊपर के बटन से Google Pay खुलेगा और राशि भरी हुई मिलेगी।{" "}
              <a className="upi__alt" href={u.link}>
                कोई दूसरा UPI ऐप?
              </a>
            </span>
          ) : (
            <span>अपने फ़ोन के Google Pay (या किसी भी UPI ऐप) से यह QR स्कैन कीजिए, या नीचे की UPI ID पर {amount} भेजिए।</span>
          )}
          <div className="upi__pay">
            {!mobile && <Qr text={u.link} />}
            <dl className="upi__id">
              <div>
                <dt>UPI ID</dt>
                <dd>
                  <code>{u.vpa}</code> <Copy text={u.vpa} label="UPI ID कॉपी कीजिए" />
                </dd>
              </div>
              <div>
                <dt>राशि</dt>
                <dd>
                  <code>{u.amount.toFixed(2)}</code> <Copy text={u.amount.toFixed(2)} label="राशि कॉपी कीजिए" />
                </dd>
              </div>
              <div>
                <dt>नोट</dt>
                <dd>
                  <code>{u.note}</code>
                </dd>
              </div>
            </dl>
          </div>
        </li>
        <li>
          <b>लेन-देन संख्या लिखिए।</b>
          <span>
            भुगतान पूरा होने पर ऐप में “UPI लेन-देन संख्या” (UTR) दिखती है — 12 अंकों की। वही नीचे लिखिए।
          </span>
          <form
            className="upi__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (ok) onClaim(digits);
            }}
          >
            <label className="sr-only" htmlFor="upi-utr">
              UPI लेन-देन संख्या
            </label>
            <input
              id="upi-utr"
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/[^\d\s]/g, "").slice(0, 16))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="12 अंकों की संख्या"
              aria-invalid={utr !== "" && !ok}
            />
            <button type="submit" className="db db--solid" disabled={!ok || busy !== ""}>
              {busy === "claim" ? "भेज रहे हैं…" : "जानकारी भेजिए"}
            </button>
          </form>
        </li>
        <li>
          <b>पुष्टि।</b>
          <span>लेखक रकम देखकर पुष्टि करेंगे — तब किताब खुल जाएगी और रसीद आपके ई-मेल पर आएगी।</span>
        </li>
      </ol>

      <p className="upi__note">
        <IconMail size={15} /> राशि बिल्कुल <b>{amount}</b> ही भेजिए। ग़लत राशि या ग़लत संख्या होने पर पुष्टि नहीं हो पाएगी।
      </p>

      {msg && (
        <p className={`co__msg is-${msg.tone}`} role="alert">
          {msg.text}
        </p>
      )}
    </Card>
  );
}
