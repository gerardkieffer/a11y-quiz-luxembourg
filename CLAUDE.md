# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A French-language quiz about the digital accessibility of Luxembourg public-sector
websites, built from real official audits published by the [Observatoire de
l'accessibilité numérique](https://observatoire.accessibilite.public.lu/fr/home)
(public API, CC0 license). Personal/non-official project.

## Commands

```bash
npm install
npx playwright install chromium   # once, only needed for capture-screenshots
npm run build-data                 # fetch-data + capture-screenshots + generate-questions (~5-10 min)
npm start                          # http://localhost:3000 (= node server.mjs)
```

Individual data-build steps (see Architecture below for what each does):

```bash
npm run fetch-data          # re-select sites + stats from the API -> data/sites.json
npm run capture-screenshots # screenshot sites without an existing image -> public/screenshots/
node scripts/capture-screenshots.mjs --force  # force re-capture of every site
npm run generate-questions  # data/sites.json -> data/questions.json (copied to public/questions.json)
```

There is no test suite, linter, or build step for the site itself — it's plain
static HTML/CSS/JS. `npm run build-data` scripts are the only "build," and
`generate-questions.mjs` runs its own sanity checks at the end (`checkNoJargon`,
`checkChoicesContainAnswer`), printed to the console/`meta` field in the output
JSON — check those when regenerating questions.

## Architecture

**Two completely separate worlds: data-build (Node, dev-only) and the served site
(static, no framework, no build step).** Nothing in `public/` is regenerated at
request time.

### 1. Data pipeline (`scripts/`, run manually by a developer, never in production)

Three scripts run in sequence (`npm run build-data`), each consuming the previous
one's output:

1. **`fetch-data.mjs`** — queries the Observatory's API (`scripts/lib/api-client.mjs`,
   `type=1` = in-depth/RAWeb audits only; mobile/RAAM and simplified/RGAA audits are
   excluded because they don't map to the RAWeb theme reference used later) and
   curates ~40 sites for varied score, age, sector, and administrative level
   (`curate()` in `fetch-data.mjs`). When a site was audited more than once, only the
   most recent audit becomes a "site"; earlier audits ride along in `previousAudits`
   (used by the score-improvement question type). Raw API responses are cached in
   `data/raw-cache/` (gitignored) keyed by audit ID — delete that directory to force
   a full re-fetch. Writes `data/sites.json`.
2. **`capture-screenshots.mjs`** — opens each site's homepage with Playwright/Chromium,
   attempts to dismiss cookie/consent banners (including inside iframes — see
   `CONSENT_SELECTORS`/`CONSENT_TEXT_PATTERNS`, plus per-site `SITE_OVERRIDES` keyed by
   audit ID for banners the generic rules can't catch), and writes a JPEG to
   `public/screenshots/{auditId}.jpg`. Skips sites that already have an image unless
   `--force` is passed. Failures are logged to `data/screenshot-failures.json`.
3. **`generate-questions.mjs`** — turns `data/sites.json` into a bank of ~450
   questions across 8 generator functions, each producing one question `type`:
   `score-threshold`, `compare-two-sites-score`, `weakest-theme`,
   `theme-compliant-or-not`, `declared-vs-measured`, `statement-update-timing`,
   `score-improvement`, `page-count-or-scope` (see the `generators` array near the
   end of the file). Writes `data/questions.json` and copies it to
   `public/questions.json` — **this copy step is why `public/questions.json` must
   stay in sync**; editing it by hand will be overwritten next run. Per-site data
   embedded in each question is built by `siteRef()`, which strips fields the
   frontend doesn't need and defensively restricts `statementUri` to `http(s)` (it
   comes from external API data and is later rendered as a link `href`).
   `scripts/lib/themes-fr.mjs` provides the plain-French theme labels/explanations
   (not official RAWeb wording) and which themes are visually inspectable
   (`VISUALLY_INSPECTABLE_THEMES`, used to decide `showScreenshot`).

Generated/fetched data and screenshots are committed to the repo (not
regenerated on the server) — that's what makes the production side pure static
hosting.

### 2. Served site (`public/`, 100% static, no framework)

- `index.html` / `styles.css` / `quiz.js` — vanilla JS, no build step, no bundler.
- `quiz.js` fetches `./questions.json` once on load, then per game
  (`assembleSession`) picks 10 questions covering ≥6 distinct types, avoiding two
  consecutive questions about the same audit.
- Any link rendered from data (site homepage, accessibility-statement link) is
  validated to be `http(s)` before being set as an `href` (`isSafeHttpUrl` in
  `quiz.js`) — defense in depth against a stray `javascript:` URI ending up in
  upstream audit data, mirrored by the `http(s)`-only check at generation time in
  `generate-questions.mjs`.
- Accessibility is a first-class concern here (fitting, given the subject matter):
  live regions for timer/progress/reveal announcements, correct/incorrect answers
  signaled by icon + screen-reader text (not color alone), a skip link, focus moved
  to the new question/result heading on screen transitions, and colors/fonts chosen
  with WCAG AA contrast verified numerically rather than eyeballed. When touching
  `styles.css`/`index.html`/`quiz.js`, re-check contrast and focus behavior rather
  than assuming it still holds — small color or markup tweaks have broken this
  before (e.g. browsers apply a low-contrast default color to `disabled` buttons
  that must be explicitly overridden).
- Each question has a fixed 90-second timer (`TIME_LIMIT_SECONDS` in
  `generate-questions.mjs`) — this is an intentional "game" design choice, not an
  oversight; there's no mechanism to extend or disable it.
- Fonts (Figtree for headings, Ubuntu Sans for body) are self-hosted variable
  woff2 files in `public/fonts/` (not loaded from a third party) so the strict CSP
  (`default-src 'self'`) holds.

### 3. `server.mjs`

A minimal Express server whose only job is `express.static("public")` plus a few
security headers (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy;
`X-Powered-By` disabled). No routes, no dynamic logic, no database. It exists
only because the current hosting target (Infomaniak) is a Node.js environment —
on any static host, `public/` could be served directly without it. Respects
`process.env.PORT`.

## Deployment

Infomaniak Node.js hosting: `npm run build-data` locally first (data/screenshots
are committed/uploaded, not regenerated on the host), then `npm install
--production` and `npm start` on the server. See README.md for the full steps.

## Licensing

Project code is MIT. Fonts in `public/fonts/` carry their own licenses (SIL OFL
for Figtree, Ubuntu Font License for Ubuntu Sans) — don't assume MIT covers them
if reusing just the font files elsewhere.
