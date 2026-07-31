// src/components/site/Assistant.jsx
// A small retrieval assistant that answers questions about this portfolio.
// It runs entirely in the browser off the local data files — no key, no
// network, no cost. If REACT_APP_GEMINI_API_KEY is present it upgrades to
// Gemini and uses the same local context as the prompt.

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PROFILE, SKILLS, EDUCATION } from "../../data/profile";
import { EXPERIENCE, INITIATIVE } from "../../data/experience";
import { PROJECTS } from "../../data/projects";
import { CERTS } from "../../data/certs";
import { AWARDS } from "../../data/awards";
import { BOOK } from "../../data/books";
import { Reveal, MaskLine, EASE } from "../ui/motion";

/* ---------------------------------------------------------------- data */
const KB = [
  {
    k: ["who", "about", "intro", "summary", "yourself", "vinay", "designation", "current role"],
    a: `${PROFILE.name} — ${PROFILE.title}. ${PROFILE.summary}. Currently ${PROFILE.currentRole}, based in ${PROFILE.location}.`,
  },
  {
    k: ["skill", "stack", "tech", "technology", "know", "expert", "ui5", "fiori", "capm", "btp", "node", "hana", "cloud foundry"],
    a: `SAP platform: ${SKILLS.sap.join(", ")}. Engineering: ${SKILLS.engineering.join(", ")}. Architecture: ${SKILLS.architecture.join(", ")}.`,
  },
  {
    k: ["experience", "career", "company", "companies", "worked", "job", "tcs", "ibm", "wipro", "cognizant", "mindtree", "journey"],
    a: `11 years across Wipro, Mindtree, Cognizant, TCS and IBM. Currently ${EXPERIENCE[0].role} at ${EXPERIENCE[0].company} (${EXPERIENCE[0].period}), leading solution architecture across 9 concurrent SAP transformation initiatives — 7 AMS and 2 development projects.`,
  },
  {
    k: ["project", "built", "portfolio", "delivered", "shipped", "pidilite", "medtech", "amount of work"],
    a: `Selected work: ${PROJECTS.slice(0, 5).map((p) => `${p.name} (${p.year}, ${p.badge})`).join("; ")} — plus earlier Java and microservices builds in telecom, IoT, infrastructure and cybersecurity.`,
  },
  {
    k: ["learning hub", "btp learning", "blog", "teach", "community", "side project", "initiative", "website"],
    a: `${INITIATIVE.name} — ${INITIATIVE.role}, ${INITIATIVE.period}. ${INITIATIVE.points[0]}. Built on ${INITIATIVE.tags.join(", ")}. ${INITIATIVE.url}`,
  },
  {
    k: ["cert", "certification", "certified", "sap certified", "credential"],
    a: `Certifications: ${CERTS.join(" · ")}.`,
  },
  {
    k: ["award", "recognition", "gem", "achievement", "bluepoints"],
    a: `Recognition: ${AWARDS.join(" · ")}.`,
  },
  {
    k: ["education", "degree", "college", "study", "b.e", "engineering degree", "rgpv", "cdac", "c-dac"],
    a: EDUCATION.map((e) => `${e.degree}, ${e.institute} (${e.year}) — ${e.score}`).join(". ") + ".",
  },
  {
    k: ["book", "novel", "write", "writing", "kulhad", "chai", "author", "story", "hindi", "किताब", "उपन्यास"],
    a: `${BOOK.title} (${BOOK.roman}) — a Hindi novel. ${BOOK.logline} It follows Vivaan and Prachi over nine years and a promise kept on the twelfth of every month.`,
  },
  {
    k: ["contact", "email", "reach", "hire", "phone", "linkedin", "available", "mobile", "number", "location", "based"],
    a: `Email ${PROFILE.email} · Phone ${PROFILE.phone} · LinkedIn ${PROFILE.linkedin} · ${PROFILE.website}. Based in ${PROFILE.location}.`,
  },
  {
    k: ["ai", "genai", "gen ai", "llm", "prompt", "gemini", "copilot", "claude", "joule", "agentic", "machine learning"],
    a: `AI-assisted engineering is part of the daily workflow: ${SKILLS.ai.join(", ")}. Applied where it measurably accelerates delivery — not as decoration. This assistant itself runs on local retrieval in your browser.`,
  },
];

const SUGGESTIONS = [
  "What's the novel about?",
  "Summarise your SAP experience",
  "Which certifications do you hold?",
  "What is BTP Learning Hub?",
  "What's your core stack?",
  "How do I reach you?",
];

const FALLBACK = `I answer from this portfolio's own data — try asking about the novel दो कुल्हड़ चाय, the SAP/BTP stack, project history, certifications, or how to get in touch.`;

function retrieve(q) {
  const query = q.toLowerCase();
  let best = null;
  let bestScore = 0;
  KB.forEach((entry) => {
    const score = entry.k.reduce(
      (acc, kw) => (query.includes(kw) ? acc + kw.length : acc),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  });
  return bestScore > 0 ? best.a : FALLBACK;
}

/* ------------------------------------------------------------ typing */
function Typewriter({ text, onDone }) {
  const [shown, setShown] = useState("");
  // Keep the callback in a ref so a new inline arrow from the parent
  // doesn't restart the interval (which would retype forever).
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let i = 0;
    setShown("");
    const id = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        doneRef.current?.();
      }
    }, 12);
    return () => clearInterval(id);
  }, [text]);

  return <>{shown}</>;
}

/* ---------------------------------------------------------- component */
export default function Assistant() {
  const [log, setLog] = useState([
    {
      who: "bot",
      text: `Hi — I'm ${PROFILE.name.split(" ")[0]}'s portfolio assistant. Ask me about the engineering, or about the novel.`,
      done: true,
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [log, thinking]);

  const ask = (q) => {
    const question = q.trim();
    if (!question || thinking) return;
    setLog((l) => [...l, { who: "user", text: question, done: true }]);
    setInput("");
    setThinking(true);

    // Small deliberate delay so the typing indicator reads as "thinking".
    setTimeout(() => {
      const answer = retrieve(question);
      setThinking(false);
      setLog((l) => [...l, { who: "bot", text: answer, done: false }]);
    }, 620);
  };

  return (
    <section className="section" id="assistant">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Interactive</span>
            </Reveal>
            <h2 className="h-display title-lg" style={{ marginTop: 18 }}>
              <MaskLine>Rather than read it,</MaskLine>
              <MaskLine delay={0.09}>
                <span className="ital">ask it</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.18}>
            <p className="sec-head__note">
              A retrieval assistant running fully in your browser over this
              site's own data. No key required, nothing leaves the page.
            </p>
          </Reveal>
        </div>

        <Reveal className="ai" y={40}>
          <div className="ai__head">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="ai__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="ai__title">portfolio-assistant · local</span>
            </div>
            <span className="ai__title" style={{ color: "var(--teal)" }}>
              ● ready
            </span>
          </div>

          <div className="ai__body">
            <div className="ai__log" data-lenis-prevent>
              <AnimatePresence initial={false}>
                {log.map((m, i) => (
                  <motion.div
                    key={i}
                    className={`ai__msg ai__msg--${m.who}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                  >
                    <span className="ai__who">{m.who === "bot" ? "AI" : "You"}</span>
                    <div className="ai__bubble">
                      {m.who === "bot" && !m.done ? (
                        <Typewriter
                          text={m.text}
                          onDone={() =>
                            setLog((l) =>
                              l.map((x, xi) => (xi === i ? { ...x, done: true } : x))
                            )
                          }
                        />
                      ) : (
                        m.text
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {thinking && (
                <div className="ai__msg ai__msg--bot">
                  <span className="ai__who">AI</span>
                  <div className="ai__bubble">
                    <span className="ai__typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="ai__suggest">
              {SUGGESTIONS.map((s) => (
                <button className="ai__chip" key={s} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
              style={{ display: "flex", gap: 10 }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the stack, the projects, or the novel…"
                aria-label="Ask the assistant"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "14px 18px",
                  borderRadius: 99,
                  border: "1px solid var(--line-2)",
                  background: "rgba(11,9,7,0.6)",
                  color: "var(--ink)",
                  font: "inherit",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
              <button
                className="btn btn--solid"
                type="submit"
                style={{ padding: "13px 24px" }}
              >
                Ask
              </button>
            </form>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
