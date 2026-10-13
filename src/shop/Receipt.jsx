// src/shop/Receipt.jsx
// The receipt, drawn from the order exactly as the collector issued it: the
// price list, the coupon, what the discount left, the tax and where it was
// split, and how it was paid. It is the same document before payment (an order
// summary with "payment due") and after it (an invoice number and the payment
// details), so what the buyer confirms is what they are later given.

import React from "react";
import { receiptLines, STATUS, inr, stamp } from "./format";

function Party({ title, lines }) {
  const rows = lines.filter(Boolean);
  return (
    <div className="rcp__party">
      <h4>{title}</h4>
      {rows.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}

export default function Receipt({ order, className = "" }) {
  const paid = ["paid", "free", "refunded", "duplicate"].includes(order.status);
  const a = order.amounts;
  const t = a.tax;
  const st = STATUS[order.status] || STATUS.created;
  const title =
    t.enabled && order.seller.gstin && paid
      ? "टैक्स इनवॉइस · Tax Invoice"
      : paid
      ? "रसीद · Receipt"
      : "ऑर्डर सारांश · Order summary";
  const lines = receiptLines(order);

  return (
    <article className={`rcp ${paid ? "is-paid" : ""} ${className}`} aria-label="रसीद">
      <header className="rcp__head">
        <div>
          <p className="rcp__brand">{order.seller.brand}</p>
          <h2 className="rcp__title">{title}</h2>
        </div>
        <span className={`rcp__st rcp__st--${st.tone}`}>{st.label}</span>
      </header>

      <dl className="rcp__meta">
        <div>
          <dt>इनवॉइस संख्या</dt>
          <dd>{order.invoice || "भुगतान के बाद"}</dd>
        </div>
        <div>
          <dt>ऑर्डर संख्या</dt>
          <dd className="rcp__mono">{order.id}</dd>
        </div>
        <div>
          <dt>{paid ? "भुगतान की तारीख" : "तारीख"}</dt>
          <dd>{stamp(order.paidAt || order.createdAt)}</dd>
        </div>
      </dl>

      <div className="rcp__parties">
        <Party
          title="विक्रेता · Seller"
          lines={[
            order.seller.name,
            order.seller.address,
            order.seller.phone ? `फ़ोन: ${order.seller.phone}` : "",
            order.seller.gstin ? `GSTIN: ${order.seller.gstin}` : "",
            order.seller.email,
          ]}
        />
        <Party
          title="खरीदार · Buyer"
          lines={[order.buyer.name, order.buyer.email, order.buyer.phone, order.buyer.state ? `राज्य: ${order.buyer.state}` : ""]}
        />
      </div>

      <div className="rcp__item">
        <div>
          <b className="hi">{order.item.title}</b>
          <small>
            {order.item.author} · {order.item.note}
            {order.item.sac ? ` · SAC ${order.item.sac}` : ""}
          </small>
        </div>
        <span>× {order.item.qty}</span>
      </div>

      <table className="rcp__lines">
        <tbody>
          {lines.map((l) => (
            <tr key={l.k} className={`${l.total ? "is-total" : ""} ${l.good ? "is-good" : ""}`}>
              <th scope="row">{l.label}</th>
              <td className={l.strike ? "is-strike" : ""}>{l.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {t.enabled && (
        <p className="rcp__note">{t.inclusive ? "ऊपर का मूल्य GST सहित है — इसके अलावा कुछ नहीं देना।" : "GST मूल्य के ऊपर जोड़ा गया है।"}</p>
      )}
      {a.saved > 0 && (
        <p className="rcp__saved">
          MRP के मुकाबले आपकी बचत <b>{inr(a.saved)}</b>
        </p>
      )}

      {paid && (
        <div className="rcp__pay">
          <h4>भुगतान का ब्योरा</h4>
          <dl>
            <div>
              <dt>साधन</dt>
              <dd>
                {order.payment.method || "—"}
                {order.payment.detail ? ` · ${order.payment.detail}` : ""}
              </dd>
            </div>
            {order.gateway.paymentId ? (
              <div>
                <dt>भुगतान संख्या</dt>
                <dd className="rcp__mono">{order.gateway.paymentId}</dd>
              </div>
            ) : null}
            {order.gateway.name ? (
              <div>
                <dt>गेटवे</dt>
                <dd>{order.gateway.name}</dd>
              </div>
            ) : null}
            <div>
              <dt>स्थिति</dt>
              <dd>{order.status === "refunded" ? "रिफ़ंड हुआ" : order.payment.status === "not required" ? "भुगतान की ज़रूरत नहीं थी" : "सफल"}</dd>
            </div>
          </dl>
        </div>
      )}

      <footer className="rcp__foot">
        {paid
          ? "यह किताब आपके खाते में हमेशा के लिए है — इसके लिए आगे कोई शुल्क नहीं लगेगा; पहुँच वेबसाइट की उपलब्धता के अधीन है (उपयोग की शर्तें, खंड 20)। यह कंप्यूटर से बनी रसीद है; हस्ताक्षर की आवश्यकता नहीं।"
          : "भुगतान की पुष्टि होने पर पुस्तक आपके खाते में स्वतः उपलब्ध हो जाएगी तथा रसीद आपके पंजीकृत ई-मेल पर भेजी जाएगी।"}
      </footer>
    </article>
  );
}
