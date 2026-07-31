# Vinay Kumar Tiwari — Engineer & Author

A single-page, motion-led portfolio covering two bodies of work: eleven years
of enterprise engineering (SAP BTP · CAPM · Fiori/UI5 · HANA Cloud · GenAI) and
the Hindi novel **दो कुल्हड़ चाय**.

Current role: **Package Consultant — SAP BTP, IBM India Pvt. Ltd.**

## Run it

```bash
npm install      # only if node_modules is missing
npm start        # http://localhost:3000
npm run build    # production bundle in /build
```

## Structure

```
src/
├─ App.js                     page composition + preloader gate
├─ styles/site.css            design tokens & all component styles
├─ hooks/useSmoothScroll.js   dependency-free inertial scroll (Lenis-style)
├─ components/
│  ├─ ui/motion.jsx           Reveal · MaskLine · SplitWords · Magnetic ·
│  │                          Counter · Parallax · Tilt
│  └─ site/
│     ├─ Preloader.jsx        counter + curtain wipe
│     ├─ Cursor.jsx           dot + lagging ring with contextual labels
│     ├─ Nav.jsx              sticky nav, scroll progress, full-screen menu
│     ├─ Hero.jsx             parallax layers, masked line reveal, counters
│     ├─ Intro.jsx            portrait with duotone wash + 3D tilt, short bio
│     ├─ Marquee.jsx          velocity-reactive infinite ticker
│     ├─ Kulhad.jsx           animated clay-cup + steam SVG
│     ├─ Book.jsx             cover (3D tilt) + pinned horizontal synopsis
│     ├─ Craft.jsx            skills, certifications, awards, education
│     ├─ Work.jsx             sticky aside + scroll-linked experience list
│     ├─ Projects.jsx         expandable project rows
│     ├─ Assistant.jsx        in-browser retrieval assistant
│     └─ Contact.jsx          magnetic email CTA + footer
└─ data/                      profile · experience · projects · certs ·
                              awards · books   ← edit content here
```

## Editing content

Everything readable lives in `src/data/`. The novel — title, logline, the
eight synopsis beats, themes — is in `src/data/books.js`. Nothing in
`components/` needs to change to update copy.

## Images

All generated from a single source photo into `public/`:

| File | Used for |
| --- | --- |
| `vinay-portrait.jpg` / `-sm.jpg` | Intro section portrait (responsive `srcSet`), hero background motif |
| `vinay-avatar.jpg` | Nav brand mark, signature, contact block |
| `favicon.ico`, `favicon-512.png` | Browser tab — circular crop with an amber ring |
| `apple-touch-icon.png`, `logo192/512.png` | iOS home screen + PWA manifest |
| `og-image.jpg` | Link previews on social / WhatsApp / LinkedIn |

To swap the photo, replace these files keeping the same names and dimensions.

## Motion notes

- **Smooth scroll** keeps native scroll as the source of truth and lerps toward
  a target each frame, so `position: sticky`, anchors and scroll-linked
  animations all keep working. Disabled on touch devices and when the visitor
  prefers reduced motion.
- Two things will silently kill the wheel if reintroduced:
  1. `html { scroll-behavior: smooth }` — the browser then animates toward
     every `scrollTo()` the engine issues, so `scrollY` lags the target.
     The engine forces `scroll-behavior: auto` while it is active.
  2. Resyncing the target on every `scroll` event. Those events are
     asynchronous echoes of the engine's own writes; treating them as user
     input collapses the target onto the current position and eats all
     momentum. The engine ignores them while its loop is running.
- `MotionConfig reducedMotion="user"` collapses every animation to a cross-fade
  for visitors with the OS setting enabled.
- Add `data-lenis-prevent` to any inner scrollable element to opt it out.
- Add `data-cursor="Label"` to any element to show a label inside the cursor ring.

## Performance & mobile

- Images ship as WebP with JPEG fallback via `components/ui/Picture.jsx`; the
  nav/signature/contact avatars use a 200px variant (5 KB) instead of the
  1024px original (170 KB).
- Google Fonts request only the weights actually used.
- Hover styles are gated behind `@media (hover: hover)` so they don't stick
  after a tap; `:active` gives press feedback instead.
- Tap targets are ≥42px under `@media (pointer: coarse)`; the assistant input
  is pinned to 16px on small screens so iOS doesn't zoom on focus.
- The pinned horizontal synopsis becomes a native snap-scrolling swipe rail
  below 860px — a long scroll-pin reads as a frozen page on a phone.
- Grain, heavy shadows and the hero portrait are dropped on small screens and
  under `prefers-reduced-data`.
- Safe-area insets are respected for notched devices.

## Previous version

The earlier MUI portfolio is preserved at
`src/components/TCSinterviewAssistantAI.jsx` (no longer imported).
