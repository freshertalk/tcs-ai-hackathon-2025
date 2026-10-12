# दो कुल्हड़ चाय — विनय कुमार तिवारी

A website dedicated to the Hindi novel **दो कुल्हड़ चाय** (Do Kulhad Chai) by
Vinay Kumar Tiwari — and a small publishing platform behind it: a book is
published from an EPUB file, listed in a library, and read in the browser, on
any device, in an e-reader style reader.

## Run it

```bash
npm install          # only if node_modules is missing
npm start            # http://localhost:3000 — also watches public/ebooks
npm run build        # publishes (if changed) → production bundle → prerender
```

## Publishing, and replacing, the book

The book lives at **`public/ebooks/दो कुल्हड़ चाय.epub`**.

| You want to… | Do this |
| --- | --- |
| Publish / update the book | Put the `.epub` in `public/ebooks/` (same name replaces it) |
| Name it, date it | `public/ebooks/books.json` (below) |
| See it in development | `npm start` — it republishes the moment the file changes |
| Ship it | `npm run build` — republishes first if the file changed |
| Publish by hand | `npm run book:publish` (`-- --force` to redo an unchanged one) |

`public/ebooks/books.json` is keyed by file name:

```json
{
  "दो कुल्हड़ चाय.epub": { "slug": "do-kulhad-chai", "published": "2026-10-16" }
}
```

`slug` is the URL name (`/books/do-kulhad-chai`); `published` is the
publication date shown on the site and in the structured data. Optional:
`title`, `author`, `description` override what the EPUB says.

### What "replace the file" does

1. The publisher hashes the EPUB (plus `books.json`). A changed hash means a
   new edition: it unzips the book and rewrites `public/content/<slug>/` —
   chapters, cover, contents, word counts, reading time — and stamps a new
   `version` on it. An unchanged file is skipped.
2. Everything a reader fetches is tied to that `version` (chapters are
   requested as `?v=<version>`; `book.json` is always revalidated). So no one
   has to clear a cache to see the new text.
3. A reader who has the book open is told **"नया संस्करण आ गया है — ताज़ा करें"**
   the next time the tab comes to the foreground.
4. Reading positions are kept (chapter + how far through it).

On static hosting nothing can run between "file uploaded" and "site updated"
except a build: deploy with `npm run build` (it publishes first), and the new
edition is live.

### Cover pictures

Put the cover art in `public/ebooks/coverimages/` and publish. Files are
recognised by name: **सामने / front**, **पीछे / back**, **रीढ़ / spine**,
**जैकेट / jacket** (png, jpg or webp). Web sizes are made for the pages
(`cover.jpg`, `cover-md.jpg`, `cover-sm.jpg`, `back.jpg`, `jacket.jpg`,
`spine.png`) and the originals are kept in `public/content/<slug>/art/` for the
**download** button in the cover viewer. Replace a picture, keep its name, and
the next `npm start` / `npm run build` picks it up. With no pictures there, the
cover inside the EPUB is used and the back cover is typeset from the book's own
words. Resizing uses System.Drawing (Windows), ImageMagick or `sips`; where none
exists, sizes already made are reused.

### What is, and is not, offered

- There is **no download** and no copy of the EPUB on the site: the publisher
  never writes it to `public/content`, and the build deletes the `public/ebooks`
  drop box from `/build`.
- In the reader, selecting, copying, cutting, dragging, the context menu and
  printing are switched off (a copied clip says it is for reading only), and
  `robots.txt` closes the chapter files and `/read/` to crawlers.
- Chapter files are stored scrambled, not as readable HTML, so a casual
  `curl` or a crawler walking the folder gets nothing useful.

**Be clear-eyed about the limit:** a browser can only show text it has been
given. Someone determined — reading the page's code, a screenshot, retyping —
can still take it. This stops casual copying and automated scraping; it is not
DRM, and nothing running in a web page can be.

## Routes

| Path | What |
| --- | --- |
| `/` | The book's front page: cover, author, about, Read button; then the opening, the lines, the author |
| `/library` | Every published book |
| `/books/:slug` | One book — cover, description, contents |
| `/read/:slug` | The reader; opens on the cover, then resumes where you left off |
| `/read/:slug/:chapter` | A specific section (`cover`, `ch01` … `ch36`, `author`) |
| `/technical`, `/writings` | Retired — redirect to `/` |

## The reader

`src/reader/` — an e-reader in the browser.

- **Opens on the cover**, like the physical book, with a one-time hint for
  turning pages. Pages is the default mode; Scroll is one tap away.
- **Pages** lays the chapter out like a printed book — one page on a phone,
  a two-page spread on a wide window. Every page is its own element showing
  one column of the chapter; a page being turned is a 3D sheet hinged at the
  spine, with its back and the pages beneath already in place. Resizing or
  changing type re-pours the text and keeps your place.
- **Turning:** tap an edge, swipe or drag (the leaf follows your finger and
  lets go by distance and speed), arrow keys / Space / PageUp / PageDown, or
  the wheel/trackpad sideways. The last leaf of a chapter lands on the next
  chapter's first page. Style is a setting: page-turn, slide, fade or none;
  optional synthesised paper sound and a light haptic tick. Reduced motion is
  honoured.
- **Running foot, like the printed page:** left-hand pages carry
  `विनय कुमार तिवारी / 10`, right-hand pages `दो कुल्हड़ चाय / 11`. Even numbers
  are always left, odd right, so the same page can be a left page on one
  screen and a right page on another. The cover, title page, copyright and
  dedication are not numbered; the story begins at page 1 on the right
  (`src/reader/folio.js`). A chapter laid out on this screen is counted
  exactly; the rest are estimated from the words-per-page of those that have
  been, so the numbers settle as you read.
- **Kindle-style status:** the line at the foot cycles on tap through page x
  of y · time left in the chapter · time left in the book · percent, and a seek
  bar covers the whole book (a "back to where you were" chip follows any jump).
- **Yours to set:** theme (**white by default**; auto, paper, sepia, night, black), text
  size 10–36 (**default 20**, 18 on phones), line spacing, text width, alignment, bold text,
  brightness and a warm-light wash — saved once for every book. The typeface is
  fixed: every book is set in Noto Sans Devanagari.
- **Marks** (in this browser only): a bookmark ribbon (`B`), and
  press-and-hold on a paragraph to highlight it in four colours and add a
  note. Highlights are paragraph-level because free text selection is off —
  that is what keeps the book read-only. The **चिह्न** tab lists them all, and
  the contents tab can jump to a page number or a percentage.
- **Remembers you** in your own browser (no accounts); finished chapters are
  ticked in the contents.
- **Search** runs over the whole book and jumps to the line.
- **Input:** tap edges to turn, swipe, tap the centre for the bars;
  `←` `→` `Space` page, `T` contents, `S` search, `A` settings, `B`
  bookmark, `+` `−` size, `F` full screen, `Esc` bars. Nothing depends on
  hover.
- Honours reduced-motion and system dark mode, respects notches and safe
  areas, keeps iOS from zooming into the search box, and can keep the screen
  awake (opt-in).

Reader pages are `noindex`; the book page is the canonical address.

## Structure

```
public/
├─ ebooks/                     drop box: the EPUB + books.json (not deployed)
└─ content/                    published output (generated — commit it)
   ├─ index.json               the catalogue
   └─ <slug>/  book.json  chapters/*.dat  assets/  cover.jpg  cover-sm.jpg
scripts/
├─ publish-book.js             EPUB → public/content (no dependencies)
├─ dev.js                      `npm start`: publish, watch the drop box, dev server
└─ prerender.js                static HTML per route + sitemap, after build
src/
├─ App.js                      routes; the reader opts out of the site shell
├─ pages/                      Home · Library · Book
├─ reader/                     Reader · ScrollView · PagedView (the book and its
│                              leaves) · folio (page numbers) · Contents ·
│                              Settings · MarkSheet · annotations · prefs ·
│                              sound
├─ library/                    api (versioned fetch, cache, search) · progress ·
│                              hooks · BookCard (cover, card, Read button)
├─ sections/write/             the home page's sections (Hero is the listing)
├─ data/                       books.js (the novel's copy) · seo.js
└─ styles/                     site.css · library.css · reader.css
```

## The house

The site is the front of a small publishing house, with the novel as its first
book. The name is one constant, `PUBLISHER` in `src/data/books.js`, so it can
be changed in one place. The copyright of the book itself stays with the author.

- **The shelf** (`src/sections/write/Shelf.jsx`): the novel face-out on a plank,
  its spine beside it, a pair of kulhads, and the way in. Its words are the
  book own; the four perks are facts about how the reader works.
- **The front door** is a pale, rain-washed light with a clay-red button, so
  the navy cover is the darkest thing in view (`.bh` in `src/styles/library.css`).
- **Nav:** the pair of kulhads; Instagram, Facebook, LinkedIn. An address left
  empty in `AUTHOR.connect.social` draws the icon without a link.
- **रचनाएँ** (`/library`) is the catalogue; it was called पुस्तकालय, then किताबघर.

## Type

- **One Hindi face:** Noto Sans Devanagari, for the whole site and every
  book. The family tokens are at the top of `src/styles/site.css`; each Latin
  display face names Noto Sans Devanagari next, so Hindi inside a Latin stack
  lands on it.
- **One text size: 17px on the site** (`--fs-text` in
  `src/styles/typography.css`, which loads last) and **20px in the reader**
  (`DEFAULT_SIZE` in `src/reader/prefs.js`; 18 on phones; the reader can change it). The
  site size covers running text, descriptions, labels, buttons and
  navigation. Headings keep their designed sizes;
  display lettering (pull-quotes, the ticker, big numerals) is left alone. In
  the reader, headings are sized from `--rd-hb`, so lowering the text size
  never shrinks a chapter title.
- No Hindi italics: Noto Sans Devanagari has none, and a browser's slanted
  copy breaks the headline bar, so emphasis is colour and weight.

## Editing content

The novel's own words — logline, premise, cast, themes, the opening page, the
lines, the author note — live in `src/data/books.js`. The text of the book
comes from the EPUB.

Everything the site **quotes** there is word for word from the published
edition, and the descriptions stick to what the book reveals early (the first
night and the chapters after it) so the site never tells the story for it.
After replacing the EPUB, `npm run book:check` reads the published chapters
back and lists any quoted line the new edition no longer contains — and
`npm run book:publish` runs it for you.

## The hidden technical page

The engineering portfolio is no longer part of the site: `/technical`
redirects home and nothing links to it, it is not in the sitemap, and its SEO
and structured data are gone. The source is kept — `src/pages/Technical.jsx`,
`src/sections/tech/`, `src/data/{profile,experience,projects,...}.js` — so
restoring it is: add the route in `App.js`, a link in `Nav`, a sitemap entry
and a real `PAGES` entry in `data/seo.js`.

## SEO / answer engines

`npm run build` prerenders `/`, `/library` and every `/books/<slug>` to real
HTML (with the catalogue inlined), writes `build/sitemap.xml` from the
catalogue, and `data/seo.js` emits JSON-LD (`Person`, `Book` with its
`datePublished`, `FAQPage`). Hosting needs an SPA fallback (`_redirects` for
Netlify/Cloudflare, `.htaccess` for Apache are included) so `/read/…` works on
a hard refresh.

## Motion notes

- **Smooth scroll** keeps native scroll as the source of truth and lerps toward
  a target each frame. Disabled on touch devices, under reduced motion, and
  inside the reader.
- `MotionConfig reducedMotion="user"` collapses every animation to a cross-fade
  for visitors with the OS setting enabled.
- Add `data-lenis-prevent` to any inner scrollable element to opt it out.
- Add `data-cursor="Label"` to any element to show a label inside the cursor ring.

## Previous version

The earlier MUI portfolio is preserved at
`src/components/TCSinterviewAssistantAI.jsx` (no longer imported).
