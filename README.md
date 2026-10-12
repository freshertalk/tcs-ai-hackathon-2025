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

## Ratings and comments (no sign-in)

`src/reviews/` — readers press stars, may add a name and a few words, and
send. It appears on the home page (**राय**), on each book's page, and at the
end of the book in the reader. Nothing is invented: until there are ratings it
says so, and no rating is ever added to the page's structured data.

- **Where they are kept:** in a Google Sheet you own, through the small web app in
  `scripts/reviews-apps-script.gs` (set-up steps are at the top of that file —
  about five minutes). Put the web-app URL in `REVIEWS.endpoint` in
  `src/data/books.js` and rebuild. Until then a reader's rating stays on their own
  device and the page offers to e-mail it to you.
- **Moderation:** every rating counts at once; a comment shows only after you
  type `Y` in its *approved* cell. Delete a row to remove a rating.
- **Sign in with Google (optional):** put a Google OAuth *Web* client id in
  `AUTH.googleClientId` (`src/data/books.js`) and in `CLIENT_ID` in the script
  (steps at the top of `scripts/reviews-apps-script.gs`). Readers then sign in
  with Google to rate: one rating per account, their name and picture beside a
  comment, and the right to change their own. Reading never needs a sign-in.
  The browser sends Google's signed token; the script checks it with Google
  every time. **Admin:** `author.vinaytiwari1@gmail.com` (`ADMIN_EMAIL`) sees a
  moderation list under the comments — show/hide, delete — and the script
  refuses the same calls from anyone else. E-mail addresses stay in your Sheet
  and are never sent to the page. No server, no database of your own.
- **Sync across devices (signed-in readers):** `src/sync/` keeps the reader's
  place, finished chapters, bookmarks and highlights in step through the
  **Sync** tab of the same Sheet (one row per reader per book, readable only
  with that reader's own Google token). Bookmarks and highlights are merged
  (union; the newer edit of a highlight wins; a removal travels as a
  tombstone). A device with no place yet adopts the saved one; a device that
  already has a place is *offered* the newer one ("वहाँ चलें"), never moved.
  Status and sign-out are in the reader's settings (**Aa**) and in the account
  button in the navigation bar. Reading stays possible with no sign-in at all.
- **The OAuth client secret is not used** by any of this (the browser flow
  needs only the public client id) and must never be put in this repository.
- **One voice per device:** (when sign-in is not on) a random id kept in the browser lets a returning
  reader change their rating instead of adding another. It identifies nobody.
  Without sign-in this cannot stop a determined person; it stops accidents.
- **Other places:** `REVIEWS.places` shows links (Google Books, Goodreads,
  Amazon) once you have the addresses. `REVIEWS.googleBooksId` shows Google's
  own rating beside yours when Google has one for the volume — labelled as
  Google's, never merged into ours.

## Reading is for signed-in readers

The chapter files on the server are **encrypted** (AES-256-GCM). The key is not
in the site and not on the web server: it is a row in the **Keys** tab of the
collector's Sheet, and `scripts/reviews-apps-script.gs` hands it only to a
request that carries a Google token it can verify **and** comes from an account
whose latest row in the **Consent** tab is for the current edition of the legal
documents. So the sign-in requirement holds even for someone who fetches the
chapter files directly. The reader (`src/reader/ReadWall.jsx`) shows the
sign-in card until the key is granted; signing out forgets it.

**One login, then no more asking.** Google's ID token lives only about an hour,
so it is used once: at sign-in the collector verifies it, records the
acceptance, and answers with its own **session token** (signed with a secret it
keeps in Script Properties, valid 30 days). The browser sends that from then on,
so nothing is re-asked when Google's hour runs out. If the session itself ends
(30 days) and the person already accepted, the reading page shows their name and
one Google button — no tick-box. The tick-box and policy text exist only in the
sign-in dialog. To sign everyone out at once, delete the `SESSION_SECRET` script
property.

**Already signed in? Never asked again.** Three things make the card a last
resort rather than a routine:

- *The key stays on the device.* Once released to a signed-in reader it is kept
  in `localStorage` (`vkt.bk.<slug>.<version>`, tied to the account and to the
  edition of the documents). Opening a chapter then needs neither the collector
  nor Google. Sign-out removes it; a new edition of the documents or of the book
  invalidates it.
- *A lapsed Google token is renewed in the background.* A browser that signed in
  before sessions existed holds a Google token that is long past its hour. The
  collector checks that token's RSA signature against Google's published keys
  (`verifyLapsedGoogle_`, needs the V8 runtime — the default) and accepts it for
  **two things only**: issuing a session (`session`) and re-writing an acceptance
  the browser already holds (`consent` with `source: signin-retry`, noted in the
  Consent tab as "token had lapsed"). Never for the book key, reviews or sync
  directly. Limit: 30 days past expiry (`LAPSED_DAYS`), and only while Google
  still lists the signing key — the script remembers keys it has seen
  (`GOOGLE_KEYS` script property).
- *Only then* the one-press card (name + Google button). With a script that
  predates this, the card is where a lapsed login ends up. The card says why the
  collector would not vouch for the old login (`too-old`, `key-unknown`,
  `other-app`, …); the same reason is in the browser console as `[login] …`.
  To keep Google's older signing keys available, the script notes the current
  keys at most once an hour when the tally is requested (up to 16 are kept).

## Account, admin dashboard, coupons and the audit log

Two screens sit behind sign-in. Neither has a server or database of its own:
everything is kept in the same Google Sheet, by the same script
(`scripts/reviews-apps-script.gs`).

| Address  | For      | What it is |
|----------|----------|------------|
| `/account` | any signed-in reader | profile, time spent, where they are in the book, highlights, their rating, coupons used, what is on record about them, **download my data**, **erase my data** |
| `/admin`   | admins only | **Analytics**, **Readers**, **Sales**, **Coupons**, **Audit log**, **Comments** (moderation), **Team & system** |
| `/checkout` | any signed-in reader | cart → confirm → pay → read (see "Selling the book") |
| `/receipt/<order>` | the buyer, and admins | the receipt, to look at, print or save as PDF |

The navigation bar's sign-in icon opens the one sign-in dialog; once signed in
it becomes the person's picture with a menu (My account · Admin dashboard ·
Sign out). Reading shows a single turning ring while the key is checked and
then the book; anyone not signed in gets the full-page sign-in
(`src/auth/LoginScreen.jsx`).

### Tabs the script creates (on first use)

| Tab | Holds |
|-----|-------|
| `Events` | one row per page view, per chapter opened, and per batch of seconds spent on a page |
| `Users` | one row per signed-in account: first/last seen, sign-in count, role, status |
| `Coupons` | the codes, with their rules |
| `Redemptions` | the ledger: every time a code was used by a paid or free order (order number, price, discount) |
| `Orders` | one row per order, with the receipt exactly as it was issued (last column) |
| `Entitlements` | who may read which book: written when a payment is verified, a free order completes, or the admin grants a copy |
| `Audit` | who did what and when — append-only; nothing in the script edits or deletes a row |

### Analytics: what is counted, and for whom

- A page view when the address changes; the **seconds a person is actually
  there** (tab visible and a tap, key or scroll in the last minute — three
  minutes inside the reader); a chapter opened.
- **Signed in** → by account. **“Accept”** → by a random id kept in the
  browser. **“Necessary only”** → page views only, no id. **No choice yet** →
  nothing is sent. Bots and the admin's own browsing are left out.
- Batched every 30 s and when the tab is hidden; nothing ever blocks a page.
- The dashboard asks the script for any period — today, yesterday, 7/30/90 days,
  this/last month, all time, or two dates — with the change against the
  period before, a daily (weekly/monthly for long ranges) series, hours of the
  day, devices, referrers, top pages, most-opened chapters, new vs returning
  visitors, time spent (signed-in vs others, reading vs elsewhere), and the
  most engaged readers. Results are cached for a minute.
- **Scale.** Each tracked page view is about two rows. A Sheet holds 10 million
  cells; at nine columns that is ~1 million rows. When the Events tab gets
  large, copy old rows to another file and delete them here — the dashboard
  reads whatever is in the tab.

### Coupons

An admin makes a code with: type (**percent off**, **flat ₹ off**, **fixed
price**), amount, **total uses**, **uses per person**, **valid from / until**,
a **group** (a list of e-mail addresses and/or a whole domain such as
`@college.edu`), the book it is for, and a note. The script enforces all of
it — the price it applies a code to is its own table, `PRICES` at the top of
the coupons section (keep it the same as `BOOK.price` in `src/data/books.js`).

A reader opens “कूपन कोड है?” under the price, sees the price after the code,
and presses **इस कूपन से खरीदिए**, which takes them to the checkout with the code
applied. **Trying a code uses nothing up**: it is counted only when an order that
carries it is paid (or, if it makes the total ₹0, confirmed).

### Audit log

Recorded with the actor's verified e-mail, role, time and device string:
`auth.consent` (every sign-in), `book.key` (key released), `review.create/
update/approve/hide/delete`, `coupon.create/update/pause/resume/refused`,
`order.create/paid/refund/resend/bad-signature/mismatch`, `access.grant/revoke`,
`book.locked`, `admin.view`, `team.add/remove`, `data.export/erase`, and
`security.denied` (an admin action tried by someone who is not one). The
script cannot see an IP address, so none is recorded. Filter by period,
person, action and text; export to CSV.

### Admins

`ADMIN_EMAIL` in the script is the **owner**. The owner adds or removes other
admins in **Team & system** (kept in the script property `ADMINS`). The
dashboard only decides what to show: every request is checked again by the
script against the verified e-mail.

### The documents edition

Collecting usage statistics, keeping an audit log and offering coupons had to
be in the Privacy Policy and Terms, so the **edition is `2026-10-12.4`**
(`LEGAL.version` in `src/data/legal.js` and `LEGAL_VERSION` in the script —
always change both together). A new edition ends the sign-ins made under the
old one: every reader (the owner included) signs in once more and ticks the
box, and the book key is fetched again. Do not change the edition for small
corrections; change it when the documents change in substance.

### What the legal documents now say about responsibility

Three things were added to the Terms (and referred to from the Privacy Policy
and the Refund Policy):

- **A hard monetary limit (clause 10).** The most the Owner can be made to pay
  any one person — damages, compensation, penalty, fine, charge, interest,
  costs, refund or any other recovery, before any court, tribunal, commission
  or forum — is the amount that person actually paid for the access in
  question, and is nil where they paid nothing.
- **Responsibility for use (clause 17)**, **release and no reliance (clause
  18)**, and **notice before proceedings, with costs for unjustified claims
  (clause 19)**.
- **Contact and complaints** is a plain line (clauses 14, Privacy 13, Refund
  11): the author's e-mail, 48 hours to acknowledge, 30 days to resolve. The
  Owner is not styled the statutory "Grievance Officer"; the text lets him name
  another person on the Website.

No document can stop a case being filed or guarantee a result, and a term that
tries to excuse fraud, wilful wrongdoing, or duties the law imposes (for
example under the Digital Personal Data Protection Act, 2023, or consumer
law) is void and can weaken the rest. These clauses are written as strongly as
the law allows and each carries a saving clause. Have an advocate who practises
in your court read them before relying on them.

### Selling the book

The whole cycle is on the site and in the script — nothing else to host.

**What a reader goes through**

1. **Add to cart** / **Buy now** (the front page, the book page, the phone's
   sticky bar). The cart is a slug in this browser; it holds no price.
2. **Checkout** (`/checkout`): the cart, a coupon box, and the price worked out by the
   script — MRP, price, coupon, the discounted price, GST, the total.
3. **Confirm**: name, state (for GST), the tick-box. This makes the **order and its
   receipt** (an order summary with "payment due") and nothing is charged yet.
4. **Pay now**: Razorpay's own window (UPI, card, net banking, wallet). The card
   or UPI details never reach this site or the Sheet.
5. The script checks Razorpay's **signature** with the key secret, then reads the
   payment back from Razorpay (amount, order, status). Only then does it write
   the access, issue the invoice number, and mail the receipt with the payment
   details. The page opens the book — **access is automatic, once, for good**.
6. If the tab is closed after paying, the next visit to the reading page (or the
   "भुगतान की जाँच कीजिए" button, or Razorpay's webhook) finds the payment by
   asking Razorpay and finishes the order. Paying twice for one book is
   refused: an owner is told they own it.

**What the script decides** (`SELLING THE BOOK` in `scripts/reviews-apps-script.gs`)

- the price (`PRICES`), the coupon, the tax (`GST`: rate, inclusive or on top, CGST+SGST
  inside the seller's state, IGST outside it) and the total — in whole paise, so
  the parts always add up;
- who may read: `book_key` answers `purchase` unless the account owns the book
  (or is in the admin team). `PAYWALL = false` switches this off for testing;
- the receipt, kept exactly as issued (a later price change does not alter it);
  invoice numbers run `KC/2627/000001…` in sequence for each financial year.

**To go live** (Razorpay test mode first — the Sales tab says which you are in)

1. razorpay.com ▸ create an account ▸ Settings ▸ API keys ▸ generate **test** keys.
2. In the script: Project Settings ▸ **Script properties** ▸ add
   `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. They never go in the file, in
   git or in the browser.
3. Fill `SELLER` (address, state, GSTIN) and `GST` at the top of the selling
   section. **If you are not registered for GST, set `GST.enabled = false`** — you
   may not charge it; receipts then say GST is not applicable. `GST.sac` is the
   service code of an e-book: confirm it with your accountant.
4. In the editor run **`setupPayments`** once: it asks for permission to send mail,
   checks the keys with Razorpay and mails you a test receipt.
5. Deploy ▸ Manage deployments ▸ ✏ ▸ **New version**. `?check=1` should show
   `build 2026-10-12-shop`, `legal 2026-10-12.4` and a `shop` block (`payments`
   true, `mode` test, `mail` true).
6. Try it: sign in, buy with Razorpay's test UPI `success@razorpay` (or test card
   `4111 1111 1111 1111`). Look at **Admin ▸ Sales**.
7. When happy, put the **live** key id/secret in the same two properties.

*Optional:* Razorpay ▸ Webhooks ▸ add the web-app URL, event `payment.captured`.
The script believes nothing in a notification — it looks the order up and asks
Razorpay. (Apps Script cannot read Razorpay's signature header, and Razorpay
may report the redirect Google answers with as a failure; the return-visit
check above does the same job, so the webhook is a bonus, not a need.)

**Who already had the book.** With the paywall on, accounts that read before it
existed do not own it. Give them access from **Admin ▸ Sales ▸ Give someone the
book**, or sell it to them. Someone who already fetched the key keeps it on that
device until a new edition is published (a new edition has a new key).

**Limits worth knowing.** Mail goes out from your Gmail through `MailApp`: about
100 recipients a day on a free account (1,500 on Workspace). When the quota is
used up the order still completes; the receipt is on the page and in "मेरा खाता",
and **Resend** works the next day. A refund (Admin ▸ Sales) goes through Razorpay
and takes the reader's copy away with it. Two people using the last use of a
limited coupon in the same minute may both succeed.

### Putting these on

1. Paste the new script over the old one and **Deploy → Manage deployments → ✏ →
   New version**. Open `<web-app URL>?check=1`: `build` should read
   `2026-10-12-shop` and `analytics` should be `true`.
2. `npm run build`, upload the contents of `build/`, then
   `node scripts/verify-deploy.js`.
3. Sign in as the owner and open **/admin**. The tabs above appear in the
   Sheet as they are first used.

**Sheets turns text into numbers and dates.** A Google account id is a
21-digit number and the edition is `2026-10-12`; written with a plain
`appendRow`, Sheets rounds the first and makes the second a date, so an
acceptance could never be found again. The script now writes those rows with a
plain-text cell format (`appendText_`), stores the id as `g:<id>`, and still
recognises older rows by the e-mail beside them (`hasConsent_`). If you add a
column that holds ids or version strings, write it the same way.

The reading page has no sign-in of its own. If the book cannot be opened for
the person, the sign-in they hold is ended and the one sign-in dialog (the same
as the navigation bar's) opens, with the reason shown on the page.

**Putting it on the server (nginx on the VPS).** `public/_headers` and
`public/_redirects` are for Netlify / Cloudflare Pages; nginx ignores them, so
`deploy/nginx.example.conf` carries the same rules (single-page fallback,
no-cache for `index.html`, long cache for `/static`, revalidation for
`/content`, www → plain address). Then:

1. `npm run build` — it needs `.book-keys.json`; the Keys tab row must be the one
   in `book-keys-for-sheet.tsv` for this edition.
2. Upload the **whole contents of `build/`** (including `content/`, `static/`
   and `read/`) to the web root.
3. `node scripts/verify-deploy.js https://vinaytiwari.org` — reads the public
   site and checks: it is this build, the edition matches, chapters are
   ciphertext and identical, every route opens, the collector is current.
4. In Google Cloud ▸ Credentials ▸ your Web client, **Authorised JavaScript
   origins** must list `https://vinaytiwari.org` (and `https://www.vinaytiwari.org`
   unless www redirects).

Health check, no editor needed: open `<web-app URL>?check=1`. It returns the
`build` name and yes/no answers (V8 runtime, Keys tab, signature check) and
nothing private. If the editor's Run button says "An unknown error has
occurred", that is the editor, not the script.

Each time you publish an edition (`npm run book:publish`, or `npm start`):

1. A new random key is made and kept in `.book-keys.json` (git-ignored — **back
   it up**; with it you can re-publish, without it you simply publish again and
   get a new key and version).
2. `book-keys-for-sheet.tsv` is written. Paste its row (slug, version, key) into
   the **Keys** tab of the Sheet. Until you do, nobody can open the book.
   Older rows may stay: readers who still have an older edition open keep working.
3. Builds on another machine (`--soft`, no `.book-keys.json`) never invent a key:
   they keep the edition as published.

## Motion, in one place

`src/components/site/MotionHost.jsx` + `src/styles/motion.css`. As a heading,
paragraph, picture or card scrolls into view it settles (a short rise and fade;
a picture eases down from a slight zoom), neighbours a few tens of
milliseconds apart.

- Only `transform` and `opacity` animate. A device with ≤ 2 cores or ≤ 1 GB
  gets a plain fade; small screens travel less.
- Nothing is hidden until JavaScript has run, so the prerendered pages and
  search engines see everything.
- `prefers-reduced-motion` switches it off entirely.
- Each element is released once it has arrived, so its own hover and press
  effects work. State is kept in `data-mx*` attributes, never in `className`.
- Left alone: the hero, the ticker, pinned rails, the reader, and anything a
  framer-motion wrapper controls (it leaves an inline opacity or transform).
  Add `data-mx-skip` to any element to exclude it.

## Legal pages and consent

`src/data/legal.js` holds the **Terms of Use**, **Privacy Policy** and **Refund
Policy** (pages `/terms`, `/privacy`, `/refund`; small, justified, English;
Ghazipur jurisdiction; e-mail author.vinaytiwari1@gmail.com). `LEGAL.version`
is the edition people accept.

- **First visit:** a cookie and privacy notice (`src/legal/CookieNotice.jsx`);
  the choice is kept with the edition. The footer can reopen it.
- **Sign-in:** the box must be ticked before Google's button appears; when
  Google returns the token, the acceptance is written — append-only — to the
  **Consent** tab: time, Google account id, e-mail, name, edition, cookie choice,
  browser, language, page and time zone. **Access** records each key release.
- **Changing the documents:** edit `legal.js`, bump `LEGAL.version`, and set the
  same `LEGAL_VERSION` in the script. Everyone is asked to accept again before
  the key is released.
- These texts are a careful draft, not legal advice: have an advocate review
  them. No document can exclude liability that the law does not allow to be
  excluded (statutory consumer rights, data-protection duties, fraud).

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

## The shelf

The site is the author's own: a shelf with the novel as its first book. There
is no publisher name anywhere on it (the book is self-published, as its EPUB
says), and the copyright of the book stays with the author.

- **The shelf** (`src/sections/write/Shelf.jsx`): the novel face-out on a plank,
  its spine beside it, a pair of kulhads, and the way in. Its words are the
  book own.
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
