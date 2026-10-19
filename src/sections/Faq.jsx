// src/sections/Faq.jsx
// Plain questions with plain answers. The same list feeds the FAQPage JSON-LD
// in data/seo.js, so what a search engine reads is exactly what a visitor can
// read here. Native <details>: keyboard accessible, no script, and the answers
// stay in the prerendered HTML.

import React from "react";
import { Reveal, MaskLine } from "../components/ui/motion";
import { FAQ } from "../data/seo";

export default function Faq() {
  return (
    <section className="section faq" id="faq">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">In short</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>Questions people ask</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">about Vinay</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              The short version of who he is, what he does and where to find
              his work.
            </p>
          </Reveal>
        </div>

        <Reveal y={24} amount={0.1}>
          <div className="faq__list">
            {FAQ.map((f, i) => (
              <details className="faq__item" key={f.q} open={i === 0}>
                <summary className="faq__q" lang={f.lang}>
                  <span>{f.q}</span>
                  <i aria-hidden="true" />
                </summary>
                <p className="faq__a" lang={f.lang}>
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
