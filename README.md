<div align="center">

# 🐌 SlugSeek

**Find available `.com` domains by combining words: live availability checks, brandability scoring, zero backend.**

### [**slugseek.com**](https://slugseek.com)

[![CI](https://github.com/adammmmmm/slugseek/actions/workflows/ci.yml/badge.svg)](https://github.com/adammmmmm/slugseek/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](#how-it-works)
[![100% client-side](https://img.shields.io/badge/backend-none-orange.svg)](#how-it-works)

*SlugSeek named itself. The tool was run on its own word set, and "slugseek" was the pick.*

</div>

---

Give it words (optionally split into groups). It generates word combinations, checks which `.com`s are unregistered, scores every candidate for brandability, and surfaces the best open names. Built for naming a product, company, or tool.

No backend. No build step. No API keys. No dependencies beyond Google Fonts and three free, CORS-enabled public APIs. It's two static files you can host anywhere:

| File | Role |
|---|---|
| [`index.html`](./index.html) | The UI: rendering, caching, persistence |
| [`engine.js`](./engine.js) | The name-finding engine: DOM-free ES module, runs in browser and Node |

## Quickstart

**Use it:** open [slugseek.com](https://slugseek.com).

**Run it locally:** serve the two files over HTTP(S) with any static server, then open the URL:

```sh
npx serve
```

Opening `index.html` straight from disk won't work: the live availability checks use `fetch()` against DNS/RDAP/Datamuse and the UI loads `engine.js` as an ES module, both of which are blocked in `file://` and sandboxed contexts.

**Script it:** run a full sweep from the shell, JSON out:

```sh
node cli.mjs --groups "swift,bright / lab,forge" --open-only --limit 20
```

## Features

- **Two-tier availability check:** a fast DNS-over-HTTPS pass (Google, Cloudflare fallback) finds likely-open names; authoritative RDAP confirmation (Verisign) gives the definitive available/registered answer.
- **Brandability scoring:** every open candidate gets a 0-100 score from a naming rubric: length, syllables, pronounceability, seam double-letters, consonant pile-ups, vowel balance, plus position-aware startup heuristics (`the`/`try`/`get` score high as brand **prefixes** and are dead weight as **suffixes**), synonym halves, empty joins, and unfortunate seam reads. Hover any score for the full breakdown.
- **Grouping:** words live in groups; combinations are cross-group only (modifier × root). Drag a group's handle to flip prefix/suffix order, or drag words between groups.
- **Sorting:** `score` (best-first, default), `grouped` (by sweep), `default` (search order), `a-z`.
- **Incremental batches:** each sweep appends below the last; add words and re-run to check only the new combinations.
- **Favorites:** star results, filter to your shortlist; favorites persist and travel in export.
- **Chunked confirm:** "confirm all open" runs in visible batches with live progress; click again to stop.
- **Export open:** copy open domains as CSV (domain, score, state) from the results bar.
- **Deep-check:** copy USPTO/web diligence links for up to 20 open names (favorites first, else top by score). Shortlist-only by design; never runs on a full multi-thousand sweep.
- **Import / export:** save, share, or resume a sweep as JSON (groups, both-orders flag, favorites, cached results).
- **Persistence:** results cache to `localStorage`, so re-sweeps reuse prior lookups.
- **Scriptable engine:** all logic lives in `engine.js`, decoupled from the DOM. Drive it from the browser, Node, or a shell/agent via [`cli.mjs`](./cli.mjs).

## Programmatic use

`engine.js` exports the whole pipeline as plain ES modules: no DOM, no globals, no build step. It runs in the browser and in Node 18+ (which has a global `fetch`):

```js
import { findNames } from './engine.js'

const results = await findNames({
  groups: [
    ['swift', 'bright'],
    ['lab', 'forge'],
  ],
  bothOrders: true, // also try root × modifier
  confirm: true, // RDAP-confirm DNS-clear candidates (default true; same as 'clear')
  maxCombos: 10000,
  onProgress: (done, total) => {}, // optional; third arg meta.phase is 'dns'|'rdap'
})
// → [{ domain, a, b, dns, state, score: { score, syl, len, flags, breakdown } }, …]
//   sorted best-first by brandability score
```

<details>
<summary><b>Advanced knobs</b> (the same hooks the UI uses)</summary>

- `confirm: 'unknown'` with `autoConfirmUnknownMax`: auto-RDAP only uncertain rows when the batch is small.
- `rows` / `domains` / `skipDomains`: incremental batches.
- `seedCache` or `getCached(domain)`: reuse prior `{dns, rdap}` results.
- `onResult`, shared `pacer` / `onNet`: streaming and network coordination.
- `sort: false`: when the caller owns ordering.

The in-app `sweep()` calls this same `findNames` path for DoH/RDAP.

</details>

Also exported: `scoreDomain(label, parts)` (pure brandability scoring; result includes `roles` per part), `wordRole(word, position)` / `classifyParts(parts)` / `WORD_ROLES` (position-aware word-role tags), and `buildCombos(groups, bothOrders, maxCombos)` (combination generation).

A smoke test lives in [`test-engine.mjs`](./test-engine.mjs); CI runs it offline on every push/PR to `main`:

```sh
node test-engine.mjs
```

> [!NOTE]
> Real availability checks only happen where `fetch` can reach DNS/RDAP: a browser served over HTTPS, or Node with network access. Offline, the engine still generates and scores combinations.

### Command line

[`cli.mjs`](./cli.mjs) is a thin, dependency-free wrapper over `findNames` for running a full sweep from a shell or an agent: config in, JSON results out on stdout (progress and errors on stderr, so the output stays machine-readable).

```sh
# words inline: groups split by " / ", words by comma
node cli.mjs --groups "swift,bright / lab,forge" --open-only --limit 20

# or from a JSON config (same shape as an in-app export)
node cli.mjs --file seed-wordset.json --pretty
cat seed-wordset.json | node cli.mjs --stdin
```

Output is `{ ok, count, total, config, results }`, where each result is `{ domain, parts, dns, rdap, state, score }` (add `--verbose` for the full score breakdown):

```json
{
  "ok": true,
  "count": 1,
  "total": 8,
  "config": { "bothOrders": true, "confirm": true, "maxCombos": 10000 },
  "results": [
    {
      "domain": "swiftforge.com",
      "parts": ["swift", "forge"],
      "dns": "clear",
      "rdap": { "state": "open" },
      "state": "open",
      "score": 90
    }
  ]
}
```

| Flag | Effect |
|---|---|
| `--no-confirm` | Skip the RDAP pass (DNS-only, works offline) |
| `--open-only` | Only output open domains |
| `--min-score <n>` | Drop candidates below a score |
| `--limit <n>` | Cap the result count |
| `--deep-check` | Attach diligence links after filters (hard cap: 20) |
| `--max-combos <n>` | Cap combination generation |
| `--doh-conc` / `--rdap-conc` | Tune network concurrency |
| `--progress`, `--pretty` | Progress on stderr, pretty-printed JSON |

Run `node cli.mjs --help` for the full list. Deep-check is intentionally shortlist-only; pair it with `--open-only` and `--limit` so you never attach trademark/web links to thousands of candidates:

```sh
node cli.mjs --file seed-wordset.json --open-only --limit 15 --deep-check --pretty
```

## How it works

WHOIS was sunset in January 2025. **RDAP** is now the ICANN-mandated, CORS-enabled, JSON authoritative source for domain registration data, and that CORS support is what lets a browser do authoritative availability checks with no server. SlugSeek leans on this: DNS-over-HTTPS for a fast first pass, RDAP for the confirmed answer.

All endpoints are free, no-key, and CORS-enabled:

| Service | Endpoint | Used for |
|---|---|---|
| DNS-over-HTTPS | `dns.google` (Cloudflare fallback) | Fast likely-open screening |
| RDAP | `rdap.verisign.com` | Authoritative registration status |
| Datamuse | `api.datamuse.com` | Related-word suggestions |

## Deploying

Two static files, `index.html` and `engine.js`, served from the same directory. Any static host works.

## Limitations

- **`.com` only**, by design: exact-match `.com` carries the most trust.
- Free, no-SLA public APIs: they can throttle or change behavior without notice.
- NXDOMAIN/RDAP-404 means *unregistered*, not necessarily *buyable*: premium/reserved names can be unregistered yet not freely purchasable. No pricing or premium flag is surfaced. (Open `.com` via RDAP is almost always standard-priced registration; registry "premium available" tiers are mainly a new-gTLD concern.)
- The brandability score is mechanical plus a few lightweight semantic heuristics; it can't fully judge meaning or trademark risk. It surfaces, ranks, and flags traps, but the final call is yours.
- Deep-check is link-out diligence for a shortlist (max 20), not a bulk USPTO or web crawl. It does not prove a name is clear to use.

## License

MIT. See [LICENSE](./LICENSE).
