# TanStack Start ↔ Next.js Parity Review

**Date:** 2026-07-26
**Local (under review):** `http://[::1]:3001` — branch `migration/tanstack-start`, vite dev server
**Production (source of truth):** `https://flext.dev` — old Next.js `master`
**Evidence:** `docs/testing/2026-07-26-parity-screenshots/` — 69 LOCAL/PROD screenshots, **gitignored**
(3.9 MB, deliberately kept out of git history). Filenames referenced below exist only in the local
working tree; regenerate them by re-running the review if the directory is gone.

> **Status: items 1-6 fixed and verified in the browser on 2026-07-26** (branch
> `fix/tanstack-parity-regressions`, commits `ca6587b`, `72309cc`, `e979531`). See
> "Fix outcomes" directly below. The findings are preserved as originally written so the
> before/after is legible; each fixed item is marked in place.

## Fix outcomes (verified 2026-07-26)

| Item | Fix | Verified outcome |
| --- | --- | --- |
| S1 `color-scheme` | Set alongside the `dark` class in the provider and the anti-flash script | **PASS** — computed `colorScheme` is `dark`/`light` correctly both ways; `/notes` dark is readable and matches prod; `/portfolio`'s "Work" is visible |
| S2 SSR bailout | Dropped `react-use`: `navigator.clipboard` + a local `useWindowSize` | **PASS** — zero "Switched to client rendering" errors; `/` serves 17,540 chars of body text (was blank), `/resume` 9,985, `/liz` 11,390 |
| S3 hydration mismatches | Theme read after mount + `suppressHydrationWarning` on `<html>`; `useId` for the star gradient; client-resolved seconds tooltip | **PASS** — zero hydration errors on every route in both themes |
| S4 invalid nesting | Closed `<p>` before `<ul>`/`<ol>` | **PASS** — `p ul, p ol` count is 0; `/notes` and `/posts/redesign` are pixel-identical to prod (bullets at identical y-offsets) |
| Home about-photos | Reveal on load, plus a mount check for images already complete | **PASS** — 0 elements stuck at `!opacity-0`; photos render and cycle on click |
| Home timeline | Resolved indirectly by S2, as predicted | **PASS** — starts at 1986 with `scrollLeft: 0`, held at 0 across 14 one-second samples. Prod overlaps its event cards at the same stage; local does not |

Two regressions were introduced by the S3 work and fixed in `e979531`: the toggle icon stuck on
the sun after every full load (`useMotionValue` captures only its initial value, and the theme now
resolves after mount), and the `data-tip="… seconds"` counter still mismatched because it was baked
at module load. Both re-verified: the icon inverts correctly in both themes, and `/`'s console is
clean across full reloads.

**Still open:** the `/auth/*` UI (item 7), the trivia in the tables below, and the `/posts/redesign`
prose dark variant. Mobile has since been verified at 614px — see the "Mobile pass" section.

## How this was reviewed

Four browser batches compared every route side by side at desktop width in both light and dark mode,
scrolling fold by fold, exercising tooltips, menus, toggles, filters and animations, and capturing the
console on both sides. A separate HTTP-level sweep (curl) compared status codes, SSR markup, SEO meta
and sitemaps. Every finding below was re-verified against production in the same viewport and theme
before being called a gap, and the headline findings were additionally confirmed in the source code.

### Coverage limitations (read before trusting a "no gap" verdict)

- **Mobile was tested at 614px, not at true phone width.** See the "Mobile pass" section below. Chrome
  clamps its minimum window width to ~614px on macOS, which is under Tailwind's `sm` breakpoint (640px)
  so mobile layouts and the hamburger nav do engage — but anything specific to ~390px (tight text
  wrapping, cramped touch targets) remains **unverified** and needs a real device or DevTools device
  emulation.
- **Print styles** (`print:` utilities on `/resume` and `/liz`) were not tested.
- **The local database is not serving data** (see S7), so `/books` was reviewed as rendering-only.
- Comparisons ran at whatever width the window had (1440–1728px), but always **identical on both sides**,
  so the comparisons remain valid.

## Severity summary

| Severity | Count | Items |
| --- | --- | --- |
| broken | 7 | S1 `color-scheme`, S2 SSR bailout, S3 hydration mismatches, S4 invalid nesting, home about-photos invisible, home timeline drift, `/auth/*` unported |
| visual drift | 2 | S5 nav pill on hash links, hero Twitter card absent |
| trivial | 3 | S6 NUL bytes + empty titles, `/components` 404-vs-Error, sitemap `lastmod` |
| confirm intent | 2 | `/liz` content divergence, `/posts/redesign` anchor change |

Three things to take away before the detail:

1. **The count overstates the work.** Most findings collapse into a few root causes with very small fix
   surfaces — S1 is one line, S2 is two import lines, and the home about-photos bug is a single dropped callback.
2. **The migration itself is in good shape.** Every route that was supposed to look identical does, including the
   two files with the heaviest automated class-reorder churn. No drift was traced to the Biome pass, the Tailwind
   reordering, the a11y markup changes, react-tooltip v4, or the TS7 strict pass — the four areas the brief was
   most worried about. Local also server-renders SEO meta and article content that production only rendered
   client-side.
3. **The real blocker is feature completeness, not parity:** the five `/auth/*` routes are still scaffold stubs.

---

## Cross-cutting issues

These are not per-route bugs; they affect the whole site and should be fixed once.

### S1 — `color-scheme: dark` is never set → invisible text in dark mode · **broken**

Production's `next-themes` set `style="color-scheme: dark"` on `<html>`, which flips the user-agent default
text colour to white. The hand-rolled provider only toggles the `dark` **class** — `document.documentElement.classList.toggle("dark", …)`
at `src/components/theme-provider.tsx:41` and `:50`, and the anti-flash inline script at `src/routes/__root.tsx:54`.
Nothing ever writes `style.colorScheme`; verified by grep that the only `color-scheme` occurrences in the
codebase are `prefers-color-scheme` **media queries** (reading, never setting).

Consequence: any text not explicitly coloured by a Tailwind class keeps the UA default black, on a dark
background. Also affects native scrollbars and form controls site-wide.

- `/notes` is **completely unreadable** in dark mode — `26-local-notes-dark-unreadable.jpg` vs `27-prod-notes-dark-readable.jpg` (visually confirmed).
- `/portfolio`'s "Work" text is invisible — `20-local-portfolio-dark-work-text-invisible.jpg` vs `21-prod-portfolio-dark-work-text-visible.jpg`.
- The `/auth/*` stubs are the worst case — pure `rgb(0,0,0)` on `rgb(15,23,42)`.

**Scope caveat — this does not explain every dark-mode problem.** `color-scheme` only affects text with *no*
explicit colour. On `/posts/redesign` the prose is explicitly `gray-700` from the typography plugin, and that page
is **exactly as unreadable on production** (verified side by side in the same theme) — a separate, pre-existing
missing dark-variant in the prose styles, not something this fix will touch. So: fixing S1 resolves `/notes`,
`/portfolio` and the auth stubs; `/posts/redesign` needs its own prose dark variant and is not a regression.

### S2 — SSR fails on most routes and falls back to client rendering · **broken**

Vite's SSR module runner cannot take a named export off the CommonJS `react-use` package, so the server
render throws and React bails out to client-only rendering. The body is empty until JS hydrates, then the
page pops in (`06-local-home-midload-empty-body-ssr-bailout.jpg` → `07-local-home-loaded-after-hydration.jpg`).

Exactly **two** files import `react-use`, so the fix surface is tiny:

- `src/components/copy-button.tsx:4` — `useCopyToClipboard` (reached via `code-editor.tsx`, breaks `/`)
- `src/components/resume/resume-section.tsx` — `useWindowSize` (breaks `/resume`, `/liz`)

Console, verbatim: `Error: Switched to client rendering because the server rendering errored: [vite] Named
export 'useCopyToClipboard' not found. The requested module 'react-use' is a CommonJS module…`

This costs the site its server rendering — the thing the migration was for. Worth confirming whether it also
occurs in a production build or only under the dev server.

### S3 — Hydration attribute mismatches on every load · **broken** (console-level)

Three distinct causes, all logging `A tree hydrated but some attributes of the server rendered HTML didn't match`:

1. **Theme** — the server HTML has no `className="dark"` on `<html>`; the client adds it. Fires on every dark load.
2. **framer-motion** — theme-toggle SVG path attributes differ server vs client: `strokeDasharray "0 1"` vs `"1 1"`,
   `transform: scale(0)` vs `none`, and camelCase `transformOrigin`/`transformBox` vs kebab-case.
3. **Random SVG gradient IDs** on `/books` placeholders (`url(#oDrcYf…)` vs `#mf755z…`) — non-deterministic IDs
   generated separately on server and client.

No light-mode flash was observable (the inline script wins the first paint), but the mismatches are real.

### S4 — Hydration hard-fails on invalid HTML nesting (`/notes`, `/posts/redesign`) · **broken**

React 19 errors with ``In HTML, `<ul>` cannot be a descendant of `<p>` `` followed by
`Hydration failed because the server rendered HTML didn't match the client`, and regenerates the tree client-side.
It fires on **`/notes`** and on **`/posts/redesign`** (three `<ul>`/`<ol>`-in-`<p>` occurrences there, in both themes,
escalating to a thrown exception on every load).

Important nuance: **the markup is not a regression** — the same `<ul>`-inside-`<p>` nesting exists on production
(`pages/notes.tsx:18-49` on `master`, identical structure at `src/routes/notes.tsx:21-47` and `:67-88`). Next
tolerated it silently; React 19 + TanStack SSR turns it into a full hydration failure. So: **pre-existing markup,
new consequence.** Fixing the nesting fixes the error.

### S5 — Header nav pill breaks on in-page hash links · **visual drift**

Clicking a side-nav anchor on `/resume` rewrites the URL to `/resume/#projects` — note the added trailing
slash — and the header's active-route match then fails against `/resume`, so the "Resume" pill disappears
(`10-local-resume-header-pill-lost.png` vs `11-prod-resume-header-pill-kept.png`). Production keeps `/resume#projects`
and the pill. `createRouter` at `src/router.tsx:11` sets no trailing-slash option, so this is best fixed once at
router level rather than per page.

### S6 — Malformed SSR HTML: NUL bytes and empty `<title>` elements · **trivial**

Every sampled local route ships 5–9 NUL bytes and at least one empty `<title></title>` in its SSR output
(`/` 5 NULs, `/resume` 5 + two empty titles, `/posts/redesign` 9). Production has zero of both. Cosmetically
harmless today and no rendering impact was observed, but it is malformed markup that some crawlers and
parsers will treat as a broken document — worth understanding before launch.

### S7 — The local database is not serving; `/books` renders a static fallback · **not a code gap, but hides one**

`src/routes/books.tsx:30-55` catches a failed DB fetch and falls back to the static `content/books.tsx` module.
That fallback is definitively what is rendering locally:

- The fallback filters `read: true` → **87 entries**, exactly the 87 books rendered locally (production shows 95 from the DB).
- All local vote counts are 0.
- The fallback derives `id: book.isbn10 || book.asin || book.name` (`books.tsx:40`), overriding the DB's UUID primary key.
  The static data contains **exactly the 7 duplicate `isbn10` values** that appear in the console's duplicate-key
  warnings (`0345391802`, `0062464345`, `1451648537`, `1328519163`, `9780091929114`, `1591847788`, and an empty string).

**Latent bug worth noting:** while on the fallback path, the upvote button sends that ISBN-derived `id`
(`books.tsx:135`) to a mutation that matches on the UUID primary key (`server/orpc/books.ts:60`,
`eq(books.id, input.id)`). It would match zero rows, and since a zero-row update is not an error, the optimistic
UI increment would never roll back — the vote silently vanishes. Not reproducible once the DB is healthy, and
**not tested** (upvoting was off-limits as a DB write).

---

## Per-route findings

### `/` — home · 3 gaps

1. **About-section photo stack is invisible** · **broken** — all 17 `/images/about/*.jpg` load correctly
   (`naturalWidth: 2000`) but never become visible. The images carry `!opacity-0` (`src/components/sections/about.tsx:65`),
   and Tailwind's `!important` beats the inline `opacity: 1`. On `master` this class was **removed on load** by
   `next/image`'s `onLoadingComplete` callback (`components/sections/about.tsx:80-84`); the replacement
   `src/components/image.tsx` has no load callback, so the removal logic was silently dropped in the migration.
   Evidence: `04-local-home-dark-fold2-photos-invisible-timeline-drift.jpg` vs `05-prod-home-dark-fold2-photos-visible.jpg`
   (visually confirmed: a blank grey card where the photo stack should be).
2. **Timeline starts at the wrong year and drifts** · **broken** — freshly loaded at identical scroll, the "1986"
   label sits at x=-871 locally vs x=+329 on production (~1200px over-advanced, showing ~2005-2009 instead of
   1986-2002). Locally the offset then advances monotonically across remounts (-871 → -3271 → -4591, ending at
   2019/2020), auto-activates an event, and crossfades two event cards on top of each other. Production stays
   fixed at 1986 and only activates on click. Same evidence pair as above.

   **Diagnosis — likely a symptom of S2, not a framer-motion regression.** The timeline is *designed* to auto-play:
   a debounced effect advances the selected event and scrolls 120px per index every 2400ms for as long as
   `inView` is true (`src/components/sections/timeline.tsx:28-60`). That logic is **identical on `master`** — the only
   difference is a cosmetic rewrite of `indexLength`. So the question is not why it moves, but why it starts before
   the user reaches it. The most probable cause is the SSR bailout (S2): with the server render discarded, the whole
   page mounts client-side at once and `useInView` reports true at mount, kicking off the auto-play immediately —
   whereas production server-renders and the timeline stays out of view until scrolled to. **Re-test this after
   fixing S2 before treating it as a separate bug.**
3. **Hero Twitter follow card missing** · **data, not code** — production shows a @FelixTellmann card
   (218 Following / 50 Followers); locally it is absent from the DOM entirely. Cause: `src/routes/index.tsx`
   fetches Twitter live per request and renders the card only `{twitterData && …}` (`hero.tsx:111`); the API
   returns 402 locally, so the card is skipped. Production's numbers are stale 2022 build-time data.
   **Decision needed:** on the new stack this is a runtime fetch, so with a dead Twitter token the card will
   never render in production either. Evidence: `00-prod-home-light-top.jpg` vs `01-local-home-light-top-twitter-card-missing.jpg`.

Also on this route: S2 (SSR bailout) and S3 (hydration mismatch) both reproduce.

**Verified equivalent:** typewriter, confetti star, and the nav hover-pill all behave identically on both sites.

### `/resume` · 1 gap (S5) — otherwise **pixel-identical**

This route had the single heaviest automated Tailwind class-reorder churn (364 lines) and shows **zero drift**.
Section heading offsets match production exactly at every fold (147/377/3893/4569/5121/5597/6599) and
`scrollHeight` is identical (4350/7158). The a11y `span` → `button` change on section titles produces **no
visual difference** — same classes, position, font and spacing, with UA button styles fully reset. Chevron
collapse/expand, the all/relevant filter, and the contact-icon tooltips (react-tooltip v4) all work and match.

### `/liz` · content divergence — **needs your confirmation**, not a bug

Layout and styling match production exactly. The **content differs wholesale**: different profile photo, intro,
experience entries, education, capabilities, and five new `lizt.dev` project links that production lacks.
This is a `content/liz-cv.tsx` data change, and git confirms the direction: `master`'s last commit is from
**2023-08-26**, while the current file already contains the newer content. So **production is stale and the
migration branch is newer** — an intentional content update, not a migration regression. Flagged only because
you asked for production to be the reference. Evidence: `14-local-liz-light-top-content-divergence.jpg` vs `15-prod-…`.

### `/portfolio` · 1 gap (S1 dark-mode text) — otherwise identical

Production's `/portfolio` is itself just the word "Work" plus header/footer (161 chars of body text on both
sides, identical strings). **This is not an unfinished migration stub** — it matches production exactly.

### `/books` · rendering at parity; see S7 for the data situation

Card rendering matches production precisely: cover, star-rating pill, heart + count pill, title, author link,
and the red hover state. The differences (87 vs 95 books, all-zero vote counts, different order) are entirely
explained by the static fallback in S7. The 7 duplicate-key console errors come from the fallback's ISBN-derived
keys, not from the DB path. Upvote was never clicked.

### `/notes` · 2 gaps (S1 unreadable in dark, S4 hydration failure)

Content itself is identical to production (3289 vs 3131 chars, same opening and closing text). Both defects are
covered above; note that S4's underlying markup is pre-existing.

### `/components` · 1 gap · **trivial**

The briefing's expectation of prism code blocks, a code editor and toasts on this route is **outdated** — neither
site has them today. Both show a sidebar plus placeholder text ("main content" / "asd"), identical. Subpages are
dead on both: `/components/headings` renders the styled 404 locally, and a bare "Error" page on production;
production's sidebar click is a complete no-op. Locally, no working functionality is lost.

### `/gallery`, `/test` · no gaps

Both are near-empty on production too (`/gallery` = the word "Gallery"; `/test` = an empty `<main>` with identical
`scrollHeight` of 1106). **At genuine parity — not stubs.**

### `/posts/redesign` · 1 content change — otherwise **pixel-identical**

Typography, spacing, blockquote rules, list markers, heading sizes, footer and even line-wrap points match
production exactly across all five folds in both themes. Two corrections to the review brief: this page has
**no code blocks at all** (`<pre>`, `<code>` and `<img>` counts are 0 on both sites), so there was no Prism
highlighting, copy button or toast to test; and **S2 does not fire here** — the page server-renders its full
article (36 KB of HTML), because it imports neither `copy-button.tsx` nor `resume-section.tsx`.

The one real difference is a copy change in the first paragraph — production reads
`check out my other sites <a href="#">here</a>` (dead link), local reads
`check out <a href="/portfolio">my other sites</a>` (`src/routes/posts/redesign.tsx:27`). `/portfolio` is a real
route, so this is an improvement. **Please confirm it was intentional.** Evidence:
`55-local-posts-redesign-dark-anchor-zoom.png` vs `58-prod-posts-redesign-dark-anchor-zoom.png`.

S4 also fires here, in both themes and more severely than on `/notes` — three occurrences of `<ul>`/`<ol>` inside
`<p>` produce two nesting errors plus a thrown `Hydration failed…` exception on every load.

Worth noting as a migration **win**: production serves this route as an empty client-rendered shell
(`<div id="__next"></div>`, 6.2 KB); local server-renders the whole article. That is also precisely why production
never trips a hydration error on the invalid nesting and local does.

### `/auth/*` — five unported scaffold stubs · **broken** (feature-completeness)

The single largest outstanding item in the migration. All five routes render the plan's **placeholder text
verbatim, in the browser**, in an unstyled bare `<div>` — confirmed in the source:

| Route | Renders |
| --- | --- |
| `/auth/sign-in` | `Sign In Page — port from existing auth UI` |
| `/auth/sign-up` | `Sign Up Page — port from existing auth UI` |
| `/auth/error` | `Auth Error` (no code, message, or recovery link) |
| `/auth/verify-request` | `Check your email for a sign-in link.` |
| `/auth/sign-out` | `Signed Out` (asserts a completed sign-out; no confirm control) |

There is **no auth UI whatsoever**: zero `<form>` elements, zero inputs, and no provider buttons on any of the
five pages — the only buttons present belong to the site header. So there is currently no way to sign in, and the
missing `/auth/callback/$provider` route is moot because nothing could ever reach it.

The site chrome (header and footer) does render correctly, so the root layout is wired up; the page bodies simply
ignore the site's centered content column and sit flush at `x=0`. In dark mode these are the **worst case of S1** —
pure `rgb(0,0,0)` text on `rgb(15,23,42)` — because the stubs carry no colour class at all
(`65-local-auth-sign-out-dark-zoom-black-on-dark.png`).

These have no production counterpart (prod 404s, having used NextAuth's `/api/auth/*`), so this is a
feature gap rather than a visual-parity regression — but it is a blocker for closing the migration.

---

## Mobile pass (2026-07-26, after the fixes)

Run at **614px** — Chrome's minimum window width on macOS. `matchMedia('(max-width: 640px)')` returned
true throughout, so mobile layouts and the hamburger nav were genuinely active. Requests for 390px and
380px both clamped to 614, so **true phone width remains untested**.

**Result: all seven routes pass.** `/`, `/resume`, `/notes`, `/books`, `/liz`, `/posts/redesign` and
`/portfolio` matched production fold by fold in both light and dark. No layout breakage, clipping,
image-fit problems or touch-target collisions were found.

- **Horizontal overflow: none anywhere.** `scrollWidth === clientWidth === 614` on every route, both
  sites, both themes.
- **Console: zero hydration errors** across all seven routes — the fixes hold at mobile width. The only
  output is the `/books` duplicate-ISBN key warnings (S7), which cannot be compared against production
  because React strips key warnings in production builds.
- **Mobile nav overlay: pixel-identical to production** on `/` and `/resume` — dashed leader lines,
  right-aligned descriptions, rainbow CTA, close icon.
- **`/resume` mobile footer tooltips: pass.** The collapsed 40px strip expands correctly and the GitHub
  tooltip lands at exactly the same position and size on both sites (310, 685 · 81×36). It slightly
  overlaps the "Cape Town" text — identically on production.
- **Theme toggle and dark readability: pass**, confirming S1 at mobile width. After a full reload with
  `theme=dark`, `/notes` is white-on-navy with `colorScheme: dark` and the header shows the moon; light
  shows the sun. `/portfolio`'s "Work" is readable in dark on both sites.

### Newly discovered pre-existing issues (reproduce identically on production — not regressions)

- **The `/resume` and `/liz` fixed mobile footer stays white in dark mode.** `--resume-footer-bg` is
  hard-set to `rgb(248 250 252/1)` (gray-50) with no dark override. A genuine bug on both sites, and a
  small fix if you want it.
- `/notes`, `/portfolio` and `/posts/redesign` have **zero horizontal padding at mobile** — text sits
  flush against x=0. Identical on production.

### Worth knowing about the S1 fix

If the `dark` class is ever added to `<html>` *without* the accompanying `color-scheme` update — as a
JS-only toggle would do — `/notes` renders black-on-black again. No current user path does this, but it
means the fix depends on `color-scheme` being set alongside the class, never on the class alone. Keep
them together in any future theme work.

## Confirmed *not* regressions

Verified present on production too, or intentional:

- **Draft artifacts on `/posts/redesign`** — the literal `asd`, the `"link to 2.0 themes"` placeholder href, the
  destination-less anchors, and the `<ul>`/`<ol>`-inside-`<p>` nesting.
- **Dead "Lets work" CTA** in the mobile nav (`header.mobile-nav.tsx:108-112`, no handler) — not reachable for
  testing since mobile is blocked.
- **Malformed `0.0.2s` transition** on the desktop nav hover pill (`header.desktop-nav.hover-effect.tsx:58`, `:84`).
- **Dead `/resume` side-nav anchors** — `document.getElementById('projects')` is null on **both** sites; clicking
  scrolls nowhere on production either.
- **`/liz` references and interests are Felix's**, not Liz's — identical on production.
- **Transient blank book covers** during lazy-load — a production-side timing artifact.
- **Missing console easter egg** was reported by an agent but is a **false positive**: it is deliberately gated
  behind `process.env.NODE_ENV !== "development"` (`src/routes/__root.tsx:87`), so it is correctly silent on the dev server.
- **By design:** no image blur-up (simplified `Image`), tooltips mounting a frame late (lazy-loaded),
  `href`-less links rendering as `<span>`.

## HTTP-level sweep results

- **All 10 content routes return 200** on both sides.
- **Auth routes have no production counterpart** — `/auth/*` returns 200 locally and **404 on production**, which
  used NextAuth's `/api/auth/*` (302). Reviewed standalone below rather than diffed.
- **SEO meta is an improvement, not a gap** — local server-renders the full title, description and OG tags;
  production ships `next-head-count=2` and injects them client-side.
- **Sitemaps match** — identical URL sets; only `lastmod` differs (2022-10-24 local vs 2022-11-15 prod). No action.
- **`/api/tweets` fails on both**, differently: 402 locally, 500 on production. Consistent with the dead Twitter
  credentials behind the missing hero card.

## Suggested priority (for your decision — nothing has been actioned)

1. **S1 `color-scheme`** — one line, fixes the unreadable `/notes`, the invisible `/portfolio` text and the auth stubs.
2. **S2 SSR bailout** — two import lines; restores server rendering site-wide, and may fix the timeline too.
3. **Home about-photos `!opacity-0`** — a visibly broken section, and the cause is precisely known.
4. **S4 invalid nesting** (`/notes`, `/posts/redesign`) and **S3 hydration mismatches** — correctness of the new stack.
5. **Timeline drift** — re-test after S2 before investigating separately.
6. **`/auth/*` UI** — the big one by effort, but it is net-new feature work rather than a parity fix, so it does not
   have to block the other items. Worth deciding whether it blocks the migration's completion.
7. **S5 trailing slash**, **S7 books keys/upvote id**, **S6 NUL bytes**, prose dark variant on `/posts/redesign` — lower urgency.
8. **Re-run this review at mobile widths** — the largest untested surface; needs Chrome out of macOS fullscreen.

Two questions for you: was the `/liz` content update intentional (production is stale — its last commit is
2023-08-26), and was the `/posts/redesign` anchor rewrite intentional? Also worth an early decision: the hero
Twitter card now fetches live per request, so with the current dead token it will be missing in production too,
not just locally.
