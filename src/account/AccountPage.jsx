// src/account/AccountPage.jsx
// "मेरा खाता": a reader's own page — who they are, where they are in the book,
// what they have marked, what they have said, what they have used, what is on
// record about them, and the two things the law asks a site to offer: a copy
// of their data and its erasure.

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import usePrivatePage from "../components/site/usePrivatePage";
import LoginScreen from "../auth/LoginScreen";
import { signOut, useAuth } from "../auth/google";
import { useMe } from "./me";
import { call, explain } from "../api/collector";
import { BOOK } from "../data/books";
import { LEGAL } from "../data/legal";
import { useBook, useProgress } from "../library/hooks";
import { contentUrl } from "../library/api";
import { readBook, onMarksChange } from "../reader/annotations";
import { fmtDate } from "../reader/util";
import { StarRow } from "../reviews/Stars";
import { getCookieChoice, reopenCookieNotice } from "../legal/consent";
import { Card, Chip, Empty, Failure, Kpi, Loading } from "../admin/ui";
import { inr } from "../shop/format";
import { download, fmtAgo, fmtDur, fmtN, fmtWhen, rupees } from "../admin/format";
import {
  IconBook,
  IconBookmark,
  IconCart,
  IconClock,
  IconDownload,
  IconReceipt,
  IconShield,
  IconSignOut,
  IconStar,
  IconTag,
  IconTrash,
  IconUsers,
} from "../components/ui/icons";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

function useMarks(slug) {
  const [m, setM] = useState(() => readBook(slug));
  useEffect(() => {
    const read = () => setM(readBook(slug));
    read();
    return onMarksChange((changed) => {
      if (!changed || changed === slug) read();
    });
  }, [slug]);
  return m;
}

function Continue({ book, progress }) {
  const chapters = (book && book.chapters) || [];
  const real = chapters.filter((c) => c.kind === "chapter");
  const cur = progress && chapters.find((c) => c.id === progress.chapter);
  const done = progress && progress.done ? Object.keys(progress.done).length : 0;
  const pct = progress ? Math.round(Math.min(1, Math.max(0, progress.overall || 0)) * 100) : 0;

  return (
    <Card title="पढ़ना जारी रखिए" sub={BOOK.title} className="cont">
      <div className="cont__row">
        {book && book.coverSmall ? (
          <img className="cont__cover" src={contentUrl(book.slug, book.coverSmall)} alt="" width="92" height="130" />
        ) : (
          <span className="cont__cover cont__cover--blank" />
        )}
        <div className="cont__body">
          {progress && cur ? (
            <>
              <p className="cont__where hi">
                <b>{cur.num ? `${cur.num} · ` : ""}</b>
                {cur.title}
              </p>
              <div className="bar2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="पढ़ाई की प्रगति">
                <i style={{ width: `${pct}%` }} />
              </div>
              <p className="cont__meta">
                {pct}% पूरा · {done} अध्याय पढ़े{real.length ? ` / ${real.length}` : ""} · {fmtAgo(new Date(progress.at || Date.now()).toISOString())}
              </p>
              <Link className="db db--solid" to={`/read/${BOOK.slug}/${progress.chapter}`}>
                <IconBook size={17} /> वहीं से पढ़िए
              </Link>
            </>
          ) : (
            <>
              <p className="cont__where hi">आपने अभी पढ़ना शुरू नहीं किया।</p>
              <Link className="db db--solid" to={`/read/${BOOK.slug}`}>
                <IconBook size={17} /> पढ़ना शुरू कीजिए
              </Link>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

const ORDER_LABEL = { paid: "भुगतान सफल", free: "मुफ़्त", created: "भुगतान बाकी", pending: "पुष्टि की प्रतीक्षा", refunded: "रिफ़ंड" };
const ORDER_TONE = { paid: "ok", free: "ok", created: "warn", pending: "warn", refunded: "muted" };

/** What they have bought: receipts, and the way back to an unpaid order. */
function Purchases({ me }) {
  const rows = (me && me.purchases) || [];
  const owns = Boolean(me && me.access && me.access[BOOK.slug]);
  return (
    <Card title="आपकी खरीद" sub="Your purchases and receipts">
      {rows.length ? (
        <ul className="ordl">
          {rows.map((o) => (
            <li key={o.id}>
              <IconReceipt size={22} />
              <div>
                <b className="hi">{o.title}</b>
                <small>
                  {o.invoice ? `${o.invoice} · ` : ""}
                  {fmtWhen(o.paidAt || o.at)}
                  {o.coupon ? ` · कूपन ${o.coupon}` : ""}
                </small>
                <small>
                  <Link to={o.status === "created" || o.status === "pending" ? `/checkout?order=${encodeURIComponent(o.id)}` : `/receipt/${encodeURIComponent(o.id)}`}>
                    {o.status === "created" ? "भुगतान कीजिए" : o.status === "pending" ? "स्थिति देखिए" : "रसीद देखिए"}
                  </Link>
                </small>
              </div>
              <div className="ordl__r">
                <span className="ordl__amt">{inr(o.total)}</span>
                <Chip tone={ORDER_TONE[o.status] || "muted"}>{ORDER_LABEL[o.status] || o.status}</Chip>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>आपने अभी कोई किताब नहीं खरीदी।</Empty>
      )}
      {!owns && (
        <Link className="db db--solid db--sm" to="/checkout?buy=1">
          <IconCart size={15} /> किताब खरीदिए · {inr(BOOK.price.selling)}
        </Link>
      )}
      {owns && (
        <p className="co__small">
          यह किताब आपके खाते में <b>हमेशा के लिए</b> है — आगे कोई शुल्क नहीं।
        </p>
      )}
    </Card>
  );
}

function YourData({ onErased }) {
  const [busy, setBusy] = useState("");
  const [word, setWord] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);

  const exportAll = async () => {
    setBusy("export");
    setMsg(null);
    try {
      const d = await call("export_me");
      const mine = {
        exportedAt: new Date().toISOString(),
        source: "vinaytiwari.org",
        ...d,
      };
      delete mine.ok;
      download(`my-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(mine, null, 2), "application/json;charset=utf-8");
      setMsg({ ok: true, text: "Your data was downloaded as a JSON file." });
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    }
    setBusy("");
  };

  const erase = async () => {
    setBusy("erase");
    setMsg(null);
    try {
      await call("erase_me", { confirm: "ERASE" });
      onErased();
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
      setBusy("");
    }
  };

  return (
    <Card title="आपका डेटा" sub="You can take a copy of what is kept about you, or ask for it to be erased.">
      <div className="dta">
        <div className="dta__c">
          <h4>Download my data</h4>
          <p>Your account record, acceptance history, ratings, coupons, reading place, bookmarks, highlights and activity — as one file.</p>
          <button type="button" className="db db--ghost" onClick={exportAll} disabled={busy === "export"}>
            <IconDownload size={16} /> {busy === "export" ? "Preparing…" : "Download (JSON)"}
          </button>
        </div>
        <div className="dta__c dta__c--danger">
          <h4>Erase my data</h4>
          <p>
            Removes your synchronised reading place, your comment and name on ratings, and your picture and e-mail from
            activity records. Your acceptance records and the audit log are kept as evidence, as the Privacy Policy
            says. You will be signed out.
          </p>
          {!open ? (
            <button type="button" className="db db--danger" onClick={() => setOpen(true)}>
              <IconTrash size={16} /> Erase my data…
            </button>
          ) : (
            <div className="dta__confirm">
              <label>
                Type <b>ERASE</b> to confirm
                <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" spellCheck="false" />
              </label>
              <div className="row">
                <button type="button" className="db db--danger" disabled={word !== "ERASE" || busy === "erase"} onClick={erase}>
                  {busy === "erase" ? "Erasing…" : "Erase now"}
                </button>
                <button type="button" className="db db--ghost" onClick={() => { setOpen(false); setWord(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {msg && (
        <p className={`note ${msg.ok ? "is-ok" : "is-bad"}`} role="status">
          {msg.text}
        </p>
      )}
    </Card>
  );
}

export default function AccountPage() {
  usePrivatePage("मेरा खाता");
  const { user } = useAuth();
  const { me, status, error, reload, isAdmin } = useMe();
  const { data: book } = useBook(BOOK.slug);
  const progress = useProgress(BOOK.slug);
  const marks = useMarks(BOOK.slug);
  const cookie = getCookieChoice();

  const titleOf = useMemo(() => {
    const map = {};
    ((book && book.chapters) || []).forEach((c) => {
      map[c.id] = `${c.num ? `${c.num} · ` : ""}${c.title}`;
    });
    return (id) => map[id] || id;
  }, [book]);

  const frame = (children) => (
    <div data-theme="write" className="dsh">
      <Nav links={NAV} kicker="मेरा खाता" />
      <main className="dsh__main">{children}</main>
      <Footer />
    </div>
  );

  if (!user) return <LoginScreen reason="account" />;

  const erased = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("vkt.") && k !== "vkt.consent.v1")
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* nothing more to clear */
    }
    signOut();
    window.location.assign("/");
  };

  const latest = marks.marks
    .slice()
    .sort((a, b) => (b.u || b.at || 0) - (a.u || a.at || 0))
    .slice(0, 5);

  const mine = me && me.reviews && me.reviews.find((r) => r.slug === BOOK.slug);

  return frame(
    <div className="shell">
      <header className="acc">
        {user.picture ? <img className="acc__pic" src={user.picture} alt="" width="84" height="84" referrerPolicy="no-referrer" /> : <span className="acc__pic acc__pic--i">{String(user.name || "?").slice(0, 1)}</span>}
        <div className="acc__id">
          <p className="dsh__eyebrow">मेरा खाता</p>
          <h1 className="acc__name">{user.name}</h1>
          <p className="acc__mail">{user.email}</p>
          <p className="acc__chips">
            <Chip tone="ink">{isAdmin ? "Admin" : "Reader"}</Chip>
            {me && me.member ? <Chip tone="muted">Member since {fmtDate(me.member.since.slice(0, 10))}</Chip> : null}
          </p>
        </div>
        <div className="acc__act">
          {isAdmin && (
            <Link className="db db--ghost" to="/admin">
              <IconShield size={16} /> Admin dashboard
            </Link>
          )}
          <button type="button" className="db db--ghost" onClick={signOut}>
            <IconSignOut size={16} /> साइन-आउट
          </button>
        </div>
      </header>

      {status === "loading" && !me && <Loading label="आपका खाता खुल रहा है…" />}
      {status === "error" && !me && <Failure error={error} text={explain(error)} onRetry={reload} />}

      {me && (
        <div className="kpis kpis--4">
          <Kpi label="Time spent here" icon={<IconClock size={18} />} value={fmtDur(me.usage.seconds)} hint={`${fmtN(me.usage.sessions)} visits`} />
          <Kpi label="Chapters opened" icon={<IconBook size={18} />} value={fmtN(me.usage.chapters)} hint="in the reader" />
          <Kpi label="Sign-ins" icon={<IconUsers size={18} />} value={fmtN(me.member ? me.member.signins : 1)} hint={me.member ? `last ${fmtAgo(me.member.lastSeen)}` : ""} />
          <Kpi label="Bookmarks · highlights" icon={<IconBookmark size={18} />} value={`${fmtN(marks.bookmarks.length)} · ${fmtN(marks.marks.length)}`} hint="on this device" />
        </div>
      )}

      {me && <Purchases me={me} />}

      <div className="grid2">
        <Continue book={book} progress={progress} />

        <Card title="आपके रेखांकन" sub={`${marks.marks.length} रेखांकन · ${marks.bookmarks.length} बुकमार्क`}>
          {latest.length ? (
            <ul className="hl2">
              {latest.map((m) => (
                <li key={m.id}>
                  <i className={`hl2__c hl2__c--${m.color || "y"}`} aria-hidden="true" />
                  <div>
                    <p className="hi">{m.text || "—"}</p>
                    <Link to={`/read/${BOOK.slug}/${m.chapter}`}>{titleOf(m.chapter)}</Link>
                    {m.note ? <small className="hl2__n hi">✎ {m.note}</small> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>रीडर में किसी अनुच्छेद को देर तक दबाकर रेखांकित कीजिए — वह यहाँ दिखेगा।</Empty>
          )}
        </Card>
      </div>

      <div className="grid2">
        <Card title="आपकी राय" sub="Your rating and comment">
          {mine ? (
            <div className="myrev">
              <StarRow value={mine.rating} size={22} />
              {mine.comment ? <p className="hi">“{mine.comment}”</p> : <p className="hi">केवल रेटिंग</p>}
              <p className="myrev__s">
                {mine.comment ? (mine.approved ? <Chip tone="ok">दिख रही है</Chip> : <Chip tone="warn">लेखक की जाँच के लिए रुकी है</Chip>) : null}{" "}
                <span>{fmtWhen(mine.at)}</span>
              </p>
              <Link className="db db--ghost db--sm" to="/#reviews">
                <IconStar size={15} /> राय बदलिए
              </Link>
            </div>
          ) : (
            <>
              <Empty>आपने अभी राय नहीं दी है।</Empty>
              <Link className="db db--ghost db--sm" to="/#reviews">
                <IconStar size={15} /> राय दीजिए
              </Link>
            </>
          )}
        </Card>

        <Card title="कूपन" sub={`E-Book: ${rupees(BOOK.price.selling)} (MRP ${rupees(BOOK.price.mrp)})`}>
          {me && me.coupons.length ? (
            <ul className="cpl">
              {me.coupons.map((c) => (
                <li key={c.reference}>
                  <IconTag size={18} />
                  <div>
                    <b className="dmono">{c.code}</b>
                    <small>
                      {rupees(c.list)} → <b>{rupees(c.final)}</b> · −{rupees(c.discount)} · {fmtWhen(c.at)}
                    </small>
                    <small className="dmono">{c.reference}</small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>आपने अभी कोई कूपन इस्तेमाल नहीं किया। किताब के पन्ने पर “कूपन कोड है?” खोलिए।</Empty>
          )}
          <Link className="db db--ghost db--sm" to={`/books/${BOOK.slug}`}>
            <IconTag size={15} /> कूपन लगाइए
          </Link>
        </Card>
      </div>

      <Card title="गोपनीयता और स्वीकृति" sub="What is on record, and what you agreed to">
        <dl className="dl">
          <div>
            <dt>Terms, Privacy and Refund Policy</dt>
            <dd>
              {me && me.consent ? (
                <>
                  Edition <code>{me.consent.version}</code> accepted {fmtWhen(me.consent.at)}
                  {me.consent.version === LEGAL.version ? <Chip tone="ok">current</Chip> : <Chip tone="warn">newer edition exists</Chip>}
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Cookie choice</dt>
            <dd>
              {cookie ? (cookie.choice === "all" ? "Accepted" : "Necessary only") : "Not chosen yet"}{" "}
              <button type="button" className="lnk" onClick={reopenCookieNotice}>
                change
              </button>
            </dd>
          </div>
          <div>
            <dt>Statistics</dt>
            <dd>While you are signed in, pages you open and the time you are active on them are counted against your account.</dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>
              <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Use</Link> · <Link to="/refund">Refund Policy</Link>
            </dd>
          </div>
        </dl>
      </Card>

      <YourData onErased={erased} />
    </div>
  );
}
