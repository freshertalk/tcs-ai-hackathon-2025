// src/shop/ReceiptPage.jsx
// /receipt/<order id> — a receipt, to look at, print or save as PDF, whenever
// it is wanted. Only the person who bought (or an admin) can open it; the
// collector decides that, not this page.

import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import usePrivatePage from "../components/site/usePrivatePage";
import LoginScreen from "../auth/LoginScreen";
import { useAuth } from "../auth/google";
import { Failure, Loading } from "../admin/ui";
import { IconBook, IconCard, IconMail, IconPrint } from "../components/ui/icons";
import Receipt from "./Receipt";
import { getReceipt, resendReceipt, shopMessage } from "./api";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/account", label: "मेरा खाता" },
];

export default function ReceiptPage() {
  usePrivatePage("रसीद");
  const { id } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ phase: "loading" }); // loading | ready | error
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    setState({ phase: "loading" });
    getReceipt(id)
      .then((d) => live && setState({ phase: "ready", order: d.order }))
      .catch((e) => live && setState({ phase: "error", error: e }));
    return () => {
      live = false;
    };
  }, [id, user]);

  const frame = (children) => (
    <div data-theme="write" className="dsh co">
      <Nav links={NAV} kicker="रसीद" />
      <main className="dsh__main">
        <div className="shell">{children}</div>
      </main>
      <Footer />
    </div>
  );

  if (!user) return <LoginScreen reason="account" />;
  if (state.phase === "loading") return frame(<Loading label="रसीद खुल रही है…" />);
  if (state.phase === "error") {
    return frame(<Failure error={state.error} text={shopMessage(state.error)} onRetry={() => window.location.reload()} />);
  }

  const o = state.order;
  const paid = o.status === "paid" || o.status === "free";

  const resend = async () => {
    setSending(true);
    setNote("");
    try {
      const d = await resendReceipt(o.id);
      setNote(d.mailed === "sent" ? `रसीद ${o.buyer.email} पर भेज दी गई है।` : "ई-मेल अभी भेजा नहीं जा सका — थोड़ी देर बाद फिर कोशिश कीजिए।");
    } catch (e) {
      setNote(shopMessage(e));
    }
    setSending(false);
  };

  return frame(
    <>
      <div className="co__bar">
        <Link className="lnk" to="/account">
          ← मेरा खाता
        </Link>
        <div className="co__act">
          {paid ? (
            <>
              <Link className="db db--solid" to={`/read/${o.item.slug}`}>
                <IconBook size={17} /> किताब पढ़िए
              </Link>
              <button type="button" className="db db--ghost" onClick={resend} disabled={sending}>
                <IconMail size={17} /> {sending ? "भेज रहे हैं…" : "ई-मेल पर भेजिए"}
              </button>
            </>
          ) : o.status === "created" ? (
            <Link className="db db--solid" to={`/checkout?order=${encodeURIComponent(o.id)}`}>
              <IconCard size={17} /> भुगतान कीजिए
            </Link>
          ) : null}
          <button type="button" className="db db--ghost" onClick={() => window.print()}>
            <IconPrint size={17} /> प्रिंट / PDF
          </button>
        </div>
      </div>
      {note && (
        <p className="co__msg is-ok" role="status">
          {note}
        </p>
      )}
      <Receipt order={o} className="co__receipt" />
    </>
  );
}
