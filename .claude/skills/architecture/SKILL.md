---
name: architecture
description: Engine internals of index.html + engine.js, covering the two-tier availability pipeline, API endpoints, status mapping, tunable constants, import/export JSON schema, persistence, plus UX rationale and known rough edges. Load when modifying the combo/DNS/RDAP/cache engine, the data model, or the results UI.
---

# SlugSeek architecture & internals

Two files, native ES modules, no bundler/build:
- **`engine.js`:** the DOM-free name-finding engine. Pure compute + network,
  no globals. Exports `findNames` (headless orchestration), `scoreDomain`,
  `buildCombos`, `deepCheckLinks` / `attachDeepCheck` / `formatDeepCheckText`
  (shortlist diligence links, max 20), plus `dohNS`/`rdapCheck`/`pool`/
  `makePacer`/`sylCount`. Runs in the browser and in Node 18+ (global `fetch`).
- **`index.html`** (inline `<style>` + `<script type="module">`): the UI.
  Imports the engine and owns all DOM/render/batch/favorites/cache/persistence
  logic. `sweep()` is incremental (append new combos + cache reuse) and still
  orchestrates DoH/RDAP itself rather than calling `findNames` end-to-end;
  scoring and deep-check share the engine module.

The engine is intentionally stateless: the global `aborted` flag became a
passed-in `shouldStop()`, and RDAP/DoH pacing lives in a `pacer` object the UI
creates and wires to its notice + counters. See `roadmap` for the headless
direction this unlocks. Smoke test: `node test-engine.mjs`.

## Two-tier availability check
- **Tier 1, DNS-over-HTTPS (bulk/fast).** NS lookup via Google DoH
  (`https://dns.google/resolve?name=DOMAIN&type=NS`), Cloudflare
  (`https://cloudflare-dns.com/dns-query`) as fallback. NS chosen over A as a
  stronger "registered" signal. `Status 3` (NXDOMAIN) ⇒ likely open ("clear");
  `Status 0` ⇒ taken.
- **Tier 2, RDAP (authoritative confirm).** Verisign
  (`https://rdap.verisign.com/com/v1/domain/DOMAIN`). `404` ⇒ available ("go");
  `200` ⇒ registered (parses registrar/created/expires/status); `429` ⇒
  rate-limited.
- **Word suggestions:** Datamuse
  (`https://api.datamuse.com/words?{rel_syn|ml|rel_trg}=WORD&max=14&md=pf`).
- All endpoints are free, no-key, CORS-enabled. **No paid fallback:** they can
  throttle or change behavior without notice.

## Grouping & combos
- Words live in groups. Combinations are **cross-group only** (Group A × Group B),
  which enables the modifier × root pattern. A single group falls back to all ordered
  pairs. `bothOrders` flag controls verb-first vs noun-first.
- `MAX_COMBOS = 10000` hard cap. Over the cap, the candidate list is **shuffled
  then sampled** (coverage isn't front-biased), and the user is told how many were
  skipped. Sampling is non-deterministic; the cache accumulates coverage across
  runs but a single capped run isn't exhaustive.

## Persistence
- In-memory result cache (`domain → {dns, rdap}`) mirrored to `localStorage`:
  debounced writes, capped (`CACHE_STORE_MAX` ≈ 30k, oldest evicted), all
  try/catch-guarded (Safari private mode throws on write → falls back to
  in-memory + a notice). `localStorage` is ~5-10 MB and synchronous.

## Tunable constants (top of `<script>`, ~line 1493+)
| Constant | Value | Purpose |
|---|---|---|
| `REGISTRAR` | `"squarespace"` | register-link target (`squarespace`/`godaddy`/`namecheap`/`porkbun`) |
| `MAX_COMBOS` | 10000 | hard combo cap (protects DOM, not network) |
| `DOH_CONC` | 12 | DoH concurrency |
| `RDAP_CONC` | 3 | RDAP concurrency |
| `AUTO_T2_MAX` | 100 | auto-resolve uncertain via Tier 2 only if ≤ this |
| `DISPLAY_CAP` / `SHOW_MORE_CHUNK` | 600 | DOM rows rendered per window |
| `CACHE_STORE_MAX` | 30000 | localStorage cache cap (oldest evicted) |

Key functions: `scoreDomain()` in `engine.js` (~64); `scoreOf()` ~2277, `sweep()` ~2674 in `index.html`. `findNames()` (headless orchestration) `engine.js` ~318.

## Import/export JSON schema
```json
{
  "slugseek": 1,
  "bothOrders": true,
  "groups": [["...wordsA..."], ["...wordsB..."]],
  "words": ["...flat fallback..."],
  "results": { "domain.com": { "dns": "clear|taken|unknown", "rdap": { "state": "open|registered", "info": {} } } }
}
```
Import prefers `groups`, falls back to `words`. `results` rehydrates the cache so
re-sweeps reuse prior lookups. Export also carries favorites.

## Performance ceilings (why the design is the way it is)
- **DOM is the real ceiling**, not the network. ~10k rows ≈ 50k nodes would freeze
  mobile → results are plain data objects, only a ~600-row window of the active
  filter is rendered ("show more"). Keep rendering windowed.
- **DNS is not the bottleneck** (DoH throttles a single IP only above ~1000 QPS; a
  browser sweep peaks ~50-70 QPS). The cost is wall-clock (~2-3 min / 10k sweep).
- **RDAP is the rate-limit risk:** Verisign 429s under load (esp. "confirm all
  open"). Handled with exponential backoff + retry + an adaptive pacer with a
  visible "pacing requests" notice. Keep this on confirm paths.

## Must run hosted over HTTPS
Live `fetch()` to DNS/RDAP/Datamuse is blocked by `file://`, the in-chat artifact
sandbox, and iOS Files "Quick Look" (CORS/CSP). The app detects this and shows a
"network blocked" banner. Use a static HTTPS host (see `DEPLOY.md`).

## UX decisions & learnings (rationale that isn't in the code)
- **Terminal/TUI aesthetic** (monospace, bordered panels, bracketed `[ OPEN ]` /
  `[ TAKEN ]` tags, single cyan accent). Chosen after rejecting two generic
  "dark dashboard" looks.
- **Words are draggable pills** (primary interaction); whole pill is the drag
  handle; tapping opens a menu with remove + related-word suggestions.
- **Grouping via a visible `group` toggle** (an earlier swipe gesture was
  undiscoverable and cut). Pills look identical single vs grouped (per-group
  colors were dropped as noise).
- **Undo** (button + ⌘Z) covers ~20 word/group changes.
- **Open-first default filter** (`--open`); `--all`/`--taken`/`--uncertain`
  toggles. Uncertain auto-resolves via Tier 2 unless > ~100.
- **Results panel has a drag handle:** pull up to collapse controls; scrolling
  the list just scrolls.
- **iOS specifics:** input font-size ≥16px (no focus-zoom); fixed 100dvh/svh
  layout, only the results list scrolls.

## Known rough edges
- **Drag-vs-scroll on the word list:** pills capture touch, so a long list scrolls
  via gaps between pills. Consider long-press-to-drag.
- **Scroll reset mid-sweep:** throttled re-render during a sweep can reset the
  results list scroll position.
- **"Confirm all open" at scale** is slow due to RDAP 429 pacing; click the button
  again to cancel (same `aborted` flag as the main sweep).
- **Deep-check** is shortlist-only (favorites-open, else top open by score, max
  `DEEP_CHECK_MAX` = 20): copies link-out USPTO/web diligence text. Never bulk-fetch.
- **Accessibility:** interactions are pointer-based; keyboard/AT alternatives for
  drag and the word menu are limited.
- **Browser floor:** relies on `color-mix`, `dvh`, pointer events, and degrades on
  old browsers.

## Open concerns to verify
- **Registrar prefill is unverified.** Squarespace `?query=` may strip the param;
  **GoDaddy's `domainToCheck` prefills most reliably.** Test before changing the
  `REGISTRAR` default.
- **NXDOMAIN ≠ buyable** is rare for open `.com` (premium registry tiers are mostly
  other gTLDs). No pricing API by design; honesty copy remains in the privacy modal.
- **`.com` only.** Other TLDs need IANA RDAP bootstrap routing (see `roadmap`).
- **Full UI → `findNames` unify** is still open: UI needs incremental batches +
  result cache; headless `findNames` is the agent/CLI path.
