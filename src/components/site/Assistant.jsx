// src/components/site/Assistant.jsx
// A small retrieval assistant that answers questions about this portfolio.
// It runs entirely in the browser off the local data files — no key, no
// network, no cost. If REACT_APP_GEMINI_API_KEY is present it upgrades to
// Gemini and uses the same local context as the prompt.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PROFILE, SKILLS, EDUCATION, YEARS } from "../../data/profile";
import { EXPERIENCE, INITIATIVE } from "../../data/experience";
import { PROJECTS } from "../../data/projects";
import { CERTS } from "../../data/certs";
import { AWARDS } from "../../data/awards";
import { BOOK, AUTHOR } from "../../data/books";
import { HUB } from "../../data/hub";
import { Reveal, MaskLine, EASE } from "../ui/motion";

/* ---------------------------------------------------------------- data */
const KB = [
  {
    k: [
      "who", "intro", "introduce", "summary", "yourself", "vinay", "bio",
      "background", "profile", "designation", "current role", "about you",
      "about vinay", "who is vinay",
    ],
    a: `${PROFILE.name} — ${PROFILE.title}. ${PROFILE.summary}. Currently ${PROFILE.currentRole}, based in ${PROFILE.location}.`,
  },
  {
    k: ["skill", "skills", "stack", "tech", "technology", "expert", "sap", "ui5", "fiori", "capm", "btp", "node", "hana", "cloud foundry"],
    a: `SAP platform: ${SKILLS.sap.join(", ")}. Engineering: ${SKILLS.engineering.join(", ")}. Architecture: ${SKILLS.architecture.join(", ")}.`,
  },
  {
    k: ["experience", "career", "company", "companies", "worked", "job", "years", "tcs", "ibm", "wipro", "cognizant", "mindtree", "journey"],
    a: `${YEARS}+ years across Wipro, Mindtree, Cognizant, TCS and IBM. Currently ${EXPERIENCE[0].role} at ${EXPERIENCE[0].company} (${EXPERIENCE[0].period}), leading solution architecture across 9 concurrent SAP transformation initiatives — 7 AMS and 2 development projects.`,
  },
  {
    k: ["project", "built", "portfolio", "delivered", "shipped", "pidilite", "medtech", "amount of work"],
    a: `Selected work: ${PROJECTS.slice(0, 5).map((p) => `${p.name} (${p.year}, ${p.badge})`).join("; ")} — plus earlier Java and microservices builds in telecom, IoT, infrastructure and cybersecurity.`,
  },
  {
    k: ["learning hub", "btp learning", "blog", "teach", "community", "side project", "initiative", "website", "own site", "tutorial", "course"],
    a: `${HUB.name} (${HUB.urlLabel}) — my own technical website. ${HUB.tagline} ${HUB.intro} Six learning tracks: ${HUB.tracks
      .map((t) => t.t)
      .join(", ")}. Built solo on ${HUB.stack.join(", ")} — ${INITIATIVE.role}, ${INITIATIVE.period}. Free to read, no sign-up: ${HUB.url}`,
  },
  {
    k: ["what can i learn", "tracks", "topics", "syllabus", "curriculum", "capm tutorial", "cap tutorial"],
    a: HUB.tracks.map((t) => `${t.n} ${t.t} — ${t.d}`).join(" "),
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
    k: [
      "book", "novel", "kulhad", "chai", "story", "plot", "synopsis",
      "prachi", "vivaan",
      "train", "promise", "twelfth", "do kulhad chai", "किताब", "उपन्यास",
      "कहानी", "अंश", "कुल्हड़", "चाय", "दो कुल्हड़ चाय",
    ],
    // Deliberately spoiler-free: the later chapters are not described here.
    a: `${BOOK.title} (${BOOK.roman}) is a completed Hindi novel spanning ${BOOK.span}. ${BOOK.logline} Vivaan is in seat 36; Prachi is in seat 37. They talk all night, drink two kulhads of tea, and ask each other's names last. A year and a half later they meet again and make one rule: the twelfth of every month, the same train, the same two seats — and if one of them cannot come, the other still goes. What that promise costs them is the rest of the book. ${BOOK.closing}`,
  },
  {
    k: [
      "spoiler", "spoilers", "reveal", "ending", "end", "ends", "finish",
      "conclusion", "chapter", "chapters", "excerpt", "climax",
    ],
    a: `No spoilers here — the later chapters are not published on this site. ${BOOK.premise}`,
  },
  {
    k: ["write", "writing", "writer", "author", "hindi", "लेखक"],
    a: `${AUTHOR.nameRoman} writes in Hindi. ${AUTHOR.lines[1]} ${AUTHOR.lines[3]} His debut novel is ${BOOK.title} (${BOOK.roman}). "${AUTHOR.motto}"`,
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

const FALLBACK = `I answer from this portfolio's own data — try asking about the novel दो कुल्हड़ चाय, the SAP/BTP stack, project history, BTP Learning Hub, certifications, or how to get in touch.`;

/* -------------------------------------------------------------- retrieval
   Plain substring matching was wrong in two ways:
     • generic question words scored — "what's the novel ABOUT?" tied the
       bio entry against the novel entry, and the bio won on order alone;
     • short keys matched inside longer words — "ai" hit "chai" and "email".
   So: strip stopwords, match whole tokens (with a plural/prefix allowance),
   match multi-word keys as bounded phrases, and break ties on specificity.
   ------------------------------------------------------------------------ */
const STOP = new Set([
  "a","an","the","is","are","was","were","be","been","am","do","does","did",
  "can","could","would","should","will","shall","may","might","must",
  "i","you","your","yours","me","my","mine","we","us","our","he","she","they",
  "it","its","this","that","these","those","there","here",
  // NB: "who" is deliberately NOT a stopword — the profile entry keys on it.
  "what","whats","which","whom","whose","when","where","why","how",
  "about","of","on","in","at","to","for","from","with","by","as","and","or",
  "but","if","then","than","so","too","very","have","has","had","get","got",
  "tell","give","show","explain","describe","say","said","know","please",
  "some","any","much","many","more","most","also","just","really","like",
  "thing","things","stuff","hi","hello","hey","ok","okay","thanks","thank",
  "u","ur","pls","plz","us",
]);

// \p{M} matters: Devanagari matras and viramas are combining marks, not
// letters. Without it "उपन्यास" is shredded into loose consonants.
const normalise = (s) =>
  String(s)
    .normalize("NFC") // ड + ़ and ड़ must compare equal
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s.+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenise = (s) =>
  normalise(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));

const isWordChar = (c) => Boolean(c) && /[\p{L}\p{N}\p{M}]/u.test(c);

/** Bounded phrase match — "about you" must not match "about yourself". */
function phraseHit(haystack, phrase) {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(phrase, from);
    if (i === -1) return false;
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + phrase.length]))
      return true;
    from = i + 1;
  }
}

/**
 * Whole-token match, tolerant of plurals and truncations.
 * Returns the weight of the match, or 0. An exact hit must always outrank a
 * partial one — otherwise the key "novelist" would beat the key "novel" for
 * the query "novel", purely because it is a longer string.
 */
function tokenScore(token, kw) {
  if (token === kw) return kw.length + 2;
  if (kw.length >= 4 && token.startsWith(kw)) return kw.length + 1; // certifications → certification
  if (token.length >= 4 && kw.startsWith(token)) return token.length; // cert → certification
  return 0;
}

const MIN_SCORE = 2;

// Keys run through the same normaliser as the query, so a Devanagari key
// typed here always compares equal to the same word typed in the box.
const KB_INDEX = KB.map((e) => ({ a: e.a, k: e.k.map(normalise) }));

export function retrieve(q) {
  const query = normalise(q);
  const tokens = tokenise(q);
  if (!query) return FALLBACK;

  let best = null;
  let bestScore = 0;
  let bestSpecificity = 0;

  for (const entry of KB_INDEX) {
    let score = 0;
    let specificity = 0;

    for (const kw of entry.k) {
      const isPhrase = /[\s.-]/.test(kw);
      let weight = 0;

      if (isPhrase) {
        weight = phraseHit(query, kw) ? kw.length * 2 : 0;
      } else {
        for (const t of tokens) weight = Math.max(weight, tokenScore(t, kw));
      }

      if (!weight) continue;
      score += weight;
      specificity = Math.max(specificity, weight);
    }

    // Ties go to the entry whose single best keyword is the most specific.
    if (
      score > bestScore ||
      (score === bestScore && score > 0 && specificity > bestSpecificity)
    ) {
      bestScore = score;
      bestSpecificity = specificity;
      best = entry;
    }
  }

  return bestScore >= MIN_SCORE ? best.a : FALLBACK;
}

/* ------------------------------------------------------------ typing */
function Typewriter({ text, onDone }) {
  const [count, setCount] = useState(0);
  // Keep the callback in a ref so a new inline arrow from the parent
  // doesn't restart the interval (which would retype forever).
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Type by grapheme, not by code unit. String.slice() would cut Devanagari
  // matras and nukta marks off their base letter, so हिन्दी flickers through
  // broken shapes on the way in.
  const units = useMemo(() => {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(seg.segment(text), (s) => s.segment);
    }
    return Array.from(text);
  }, [text]);

  useEffect(() => {
    let i = 0;
    setCount(0);
    const step = Math.max(1, Math.round(units.length / 220)); // ~2.6s, any length
    const id = setInterval(() => {
      i += step;
      setCount(i);
      if (i >= units.length) {
        clearInterval(id);
        doneRef.current?.();
      }
    }, 12);
    return () => clearInterval(id);
  }, [units]);

  return <>{units.slice(0, count).join("")}</>;
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
  const logRef = useRef(null);
  const mounted = useRef(false);

  // Keep the transcript pinned to the newest message — but scroll the log
  // box itself, never the page. scrollIntoView() on mount used to drag the
  // whole window down to this section on first paint.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
            <span className="ai__title ai__ready">● ready</span>
          </div>

          <div className="ai__body">
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role */}
            <div
              className="ai__log"
              ref={logRef}
              data-lenis-prevent
              role="log"
              aria-live="polite"
            >
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
            </div>

            <div className="ai__suggest">
              {SUGGESTIONS.map((s) => (
                <button className="ai__chip" key={s} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>

            <form
              className="ai__form"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <input
                className="ai__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the stack, the projects, or the novel…"
                aria-label="Ask the assistant"
              />
              <button className="btn btn--solid" type="submit">
                Ask
              </button>
            </form>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
