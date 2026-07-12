# SlugSeek: Agent Guide

Fully client-side `.com` domain finder: combines words pairwise →
checks availability (DNS-over-HTTPS → RDAP) → scores brandability. Two files,
native ES modules, no build: **`engine.js`** (DOM-free name-finding engine,
exposing `findNames`/`scoreDomain`/`buildCombos`, runs in browser + Node 18+) and
**`index.html`** (~2900 lines, inline `<style>` + `<script type="module">`) which
imports the engine and owns all UI/DOM/render/cache logic.

## Build / test / run
- **No build, no package manager, no dependencies.** Edit `index.html` (UI) and
  `engine.js` (logic). The only test is the headless smoke test:
  `node test-engine.mjs` (CI runs the same offline on push/PR to main). (Only
  external assets: Google Fonts + three free public APIs.)

- **Headless CLI:** `cli.mjs` is a thin agent/shell wrapper over `findNames`.
  Config in via `--groups`/`--file`/`--stdin` (same JSON shape as an in-app
  export), JSON results out on stdout, progress/errors on stderr. Example:
  `node cli.mjs --groups "swift,bright / lab,forge" --open-only --limit 20`.
  Run `node cli.mjs --help` for all flags.
- **Must be served over HTTPS in a real browser.** Live `fetch()` to DNS/RDAP/
  Datamuse is blocked from `file://` and sandboxed contexts, so the app shows a
  "network blocked" banner. Locally: `/serve` (or `npx serve` then open the URL).
  Deploy: see `DEPLOY.md`.

## Where things are
- **`engine.js`**: `buildCombos()`, `scoreDomain()` (phonetics + lightweight
  semantics), `deepCheckLinks`/`attachDeepCheck`/`formatDeepCheckText` (shortlist
  diligence, max 20), `dohNS`/`rdapCheck`/`pool`/`makePacer`, `findNames()`
  (shared DNS/RDAP pipeline for CLI and UI; optional cache/incremental/
  confirm-mode hooks).
- **`index.html`** tunable constants (top of `<script>`): `REGISTRAR`,
  `MAX_COMBOS`, `DOH_CONC`, `RDAP_CONC`, `AUTO_T2_MAX`, `DISPLAY_CAP`/
  `SHOW_MORE_CHUNK`, `CACHE_STORE_MAX`. `sweep()` owns session incremental
  batching + progressive render, then calls `findNames` for network checks.

## Hard constraints (don't regress)
- **`.com` only** by design.
- **Render windowed:** results are plain data objects; only a ~600-row window of
  the active filter is rendered (the DOM, not the network, is the ceiling).
- **Keep RDAP backoff/pacing** on confirm paths; Verisign 429s under load.
- **`localStorage` writes stay debounced, capped, try/catch-guarded** (Safari
  private mode throws on write).
- **iOS:** input font-size ≥16px (no focus-zoom); fixed 100dvh/svh layout, only
  the results list scrolls.

## Deeper context (load on demand via skills)
- **`naming-heuristics`:** brandability scoring rubric; load for scoring/ranking/
  filtering/auto-selection work.
- **`architecture`:** engine internals, endpoints, status mapping, constants,
  import/export schema, UX rationale, rough edges.
- **`roadmap`:** agent-first/headless direction and future features.

## Commands
`/serve` (local server), `/check-availability <name>` (DNS→RDAP check),
`/score-name <name>` (brandability scoring loop).

## Writing style
- **Never use em-dashes (the `—` character)** anywhere: not in docs, README,
  code comments, UI copy, or commit messages. Restructure the sentence, or use a
  comma, colon, semicolon, or parentheses instead. Plain hyphens are fine only
  where they naturally belong (compound words, ranges like `0-100`, `a-z`).

## Notes
- `DEPLOY.md` is gitignored (local-only). `CLAUDE.md` is tracked in the repo.
