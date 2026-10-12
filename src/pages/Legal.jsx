// src/pages/Legal.jsx
// Terms of Use, Privacy Policy, Refund Policy — one page component, three
// documents. Small, justified type, as legal text is set.

import React from "react";
import { Link } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import Seo from "../components/seo/Seo";
import { DOCS, LEGAL } from "../data/legal";
import { SITE_LINKS } from "./Library";

export default function Legal({ doc }) {
  const d = DOCS[doc];

  return (
    <div data-theme="write">
      <Seo
        meta={{
          title: `${d.title} — Vinay Kumar Tiwari`,
          description: `${d.title} of ${LEGAL.site}.`,
          path: d.path,
          lang: "en",
        }}
      />
      <Nav links={SITE_LINKS} />

      <main className="legal">
        <article className="shell shell--narrow legal__doc" lang="en">
          <p className="legal__crumb">
            <Link to="/">Home</Link> / {d.title}
          </p>
          <h1 className="legal__h1">{d.title}</h1>

          {d.intro.map((t) => (
            <p key={t.slice(0, 40)} className="legal__p">
              {t}
            </p>
          ))}

          {d.sections.map((s) => (
            <section key={s.h} className="legal__sec">
              <h2 className="legal__h2">{s.h}</h2>
              {s.p.map((p, i) =>
                typeof p === "string" ? (
                  <p key={i} className="legal__p">
                    {p}
                  </p>
                ) : (
                  <ul key={i} className="legal__ul">
                    {p.l.map((li) => (
                      <li key={li.slice(0, 40)}>{li}</li>
                    ))}
                  </ul>
                )
              )}
            </section>
          ))}

          <nav className="legal__more" aria-label="Other policies">
            {Object.values(DOCS)
              .filter((x) => x.id !== doc)
              .map((x) => (
                <Link key={x.id} to={x.path}>
                  {x.title}
                </Link>
              ))}
            <a href={`mailto:${LEGAL.email}`}>Contact: {LEGAL.email}</a>
          </nav>
        </article>
      </main>

      <Footer />
    </div>
  );
}
