# SlugSeek

**Find available `.com` domains by combining words, with live availability checks and brandability scoring.**

### ▸ Live at **[slugseek.com](https://slugseek.com)**

SlugSeek is a fully client-side web tool. You give it words (optionally split into groups), it generates three-word combinations, checks which `.com`s are unregistered, scores each candidate for brandability, and surfaces the best open ones, useful for naming a product, company, or tool.

No backend. No build step. No API keys. No dependencies beyond Google Fonts and three free, CORS-enabled public APIs. It's two static files, `index.html` (the UI) and `engine.js` (the name-finding engine, native ES modules, no bundler), that you can host anywhere static.

> SlugSeek named itself. The tool was run on its own word set, and "slugseek" was the pick.

---

## Features

- **Two-tier availability check:** a fast DNS-over-HTTPS pass (Google, Cloudflare fallback) to find likely-open names, then authoritative RDAP confirmation (Verisign) for a definitive available/registered answer.
- **Brandability scoring:** every open candidate is scored 0-100 against a naming rubric (length, syllables, pronounceability, seam double-letters, consonant pile-ups, vowel balance). Hover any score for a full breakdown of every signal and its point contribution.
- **Grouping:** words live in groups; combinations are cross-group only (modifier × root). Drag a group's handle to reorder it (flip prefix/suffix). Drag words between groups.
- **Sorting:** `score` (best-first, the default), `grouped` (by sweep), `default` (search order), `a-z`.
- **Batches:** each sweep appends below the last; add words and re-run to check only the new combinations.
- **Favorites:** star any result; filter to just your shortlist; favorites persist and travel in export.
- **Chunked confirm:** "confirm all open" runs in visible batches with live progress.
- **Import / export:** save, share, or resume a sweep as JSON (groups + both-orders flag + favorites + cached results).
- **Persistence:** results cache to `localStorage` so re-sweeps reuse prior lookups.
- **Scriptable engine:** the name-finding logic lives in `engine.js`, decoupled from the DOM. Import it and run a full sweep programmatically, in the browser or Node, no UI required (see [Programmatic use](#programmatic-use)).

---

## Running it

The easiest way is the hosted version: **[slugseek.com](https://slugseek.com)**.

To run it yourself, SlugSeek **must be served over HTTPS in a real browser.** The live availability checks use `fetch()` against DNS/RDAP/Datamuse, and the UI loads `engine.js` as an ES module; both are blocked by sandboxed/`file://` contexts (CORS/CSP). Opening `index.html` directly from disk will fail to load the module and show a "network blocked" banner.

To run locally, use any static server (e.g. `npx serve`, then open the served URL), or just deploy it (see below).

---

## Programmatic use

`engine.js` exports the whole pipeline as plain ES modules: no DOM, no globals, no build step. It runs in the browser and in Node 18+ (which has a global `fetch`):

```js
import { findNames } from "./engine.js";

const results = await findNames({
  groups: [
    ["swift", "bright"],
    ["lab", "forge"],
  ],
  bothOrders: true,   // also try root × modifier
  confirm: true,      // RDAP-confirm the open candidates (default true)
  maxCombos: 10000,
  onProgress: (done, total) => {}, // optional
});
// → [{ domain, a, b, dns, state, score: { score, syl, len, flags, breakdown } }, …]
//   sorted best-first by brandability score
```

Also exported: `scoreDomain(label, parts)` (pure brandability scoring) and `buildCombos(groups, bothOrders, maxCombos)` (combination generation). A tiny smoke test lives in [`test-engine.mjs`](./test-engine.mjs):

```sh
node test-engine.mjs
```

> Real availability checks only happen where `fetch` can reach DNS/RDAP: a browser served over HTTPS, or Node with network access. Offline, the engine still generates and scores combinations.

---

## Deploying

It's two static files, `index.html` and `engine.js`, that must be served from the same directory. Any static host works. Recommended options in [DEPLOY.md](./DEPLOY.md).

---

## How it works

WHOIS was sunset in January 2025. **RDAP** is now the ICANN-mandated, CORS-enabled, JSON authoritative source for domain registration data, and that CORS support is what lets a browser do authoritative availability checks with no server. SlugSeek leans on this: DNS-over-HTTPS for a fast first pass, RDAP for the confirmed answer.

**Endpoints used (all free, no-key, CORS-enabled):**
- DNS-over-HTTPS: `dns.google` (Cloudflare fallback)
- RDAP: `rdap.verisign.com`
- Related-word suggestions: `api.datamuse.com`

---

## Limitations

- **`.com` only** (by design: exact-match `.com` carries the most trust).
- Free, no-SLA public APIs: they can throttle or change behavior without notice.
- NXDOMAIN/RDAP-404 means *unregistered*, not necessarily *buyable*: premium/reserved names can be unregistered yet not freely purchasable. No pricing or premium flag is surfaced.
- The brandability score is mechanical; it can't judge meaning or trademark risk. It surfaces and ranks candidates and flags traps, but the final call is yours.

---

## License

MIT. See [LICENSE](./LICENSE).
</content>
</invoke>
