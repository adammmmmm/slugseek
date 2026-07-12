---
name: naming-heuristics
description: The brandability scoring rubric for what makes a generated two-word domain a *good name*, not just an available one. Load when working on scoring, ranking, filtering, brandability badges, default word groups, or the agent's auto-selection/acid-test logic.
---

# Naming & domain heuristics (the scoring model)

This is the spec for "what makes a candidate good." SlugSeek's job is to surface
unregistered strings that are **good names**. Availability is table stakes;
brandability is the product. Treat these as a scoring rubric, not vibes.
`scoreDomain()` (~line 64 of `engine.js`, the DOM-free engine module) is the current implementation.

## Hard rules (disqualify or heavily penalize)
- **Prefer exact-match `.com`.** `.io`/`.ai`/`.co`/`.dev` are supplements, not
  replacements. The tool is `.com`-only by design.
- **No hyphens. No numbers.** Ambiguous when spoken; read as spammy/low-trust.
- **No double letters at the seam** (`labellab`, `dataapp`): typo-trap, less trust.
- **Read the seam for accidental words/unfortunate readings** (the "pen-island"
  problem). Mandatory before recommending.
- **Avoid hard consonant clusters at the join** (`thr`, `spl`, `tchs`, `ngst`).
- **Avoid clunky letters** (Q, X, Z) unless they form a real, recognizable sound.

## Soft scoring signals (rank by these)
- **Length 5-10 chars** is the sweet spot; penalize beyond ~12.
- **2 syllables ideal** ("punchy"); 2-4 acceptable.
- **The radio test (#1 filter):** could a listener hear it once and type it
  correctly? Approximate via pronounceable C/V flow, no silent letters, no
  ambiguous spellings, no homophones.
- **Consonant-vowel flow:** favor CVC/CVCV; balanced vowel:consonant ratio.
- **Industry-agnostic = more valuable** (room to pivot).
- **Ownable / trademark-friendly:** coined compounds beat pure generics.
- **Meaning resonance:** a pun/clear concept beats a random join.
- **Acid test (agent's final pick):** "Would a founder actually build their
  company on this?" If no, drop it regardless of availability.

## Word roles (position-aware tags)

Roles are **data**, not only score side effects. `wordRole(word, position)` and
`classifyParts(parts)` tag each half; `scoreDomain` applies bonuses/penalties
from those roles and still emits legacy flags (`brand-prefix`, `dead-suffix`)
for badges. Result also includes `roles: string[]` (one per part).

| Role | When | Score effect |
|------|------|--------------|
| `brand-article-prefix` | `the` at position 0 | strong bonus (TheHive) |
| `brand-action-prefix` | `try`/`get`/`go`/`use`/… at 0 | solid bonus (TryHive) |
| `weak-possessive-prefix` | `my`/`our`/`your` at 0 | mild penalty |
| `hype-prefix` | `best`/`top`/`super`/… at 0 | penalty |
| `dead-suffix` | articles, CTA verbs, possessives, function words as second+ half | heavy penalty |
| `content` | everything else (the identity/root payload) | neutral; preferred as second half |

Order is load-bearing: `the`+`hive` → brand article + content; `hive`+`the` →
content + dead suffix. Never treat prefix `the` as a blanket bad filler.

## Construction styles that work (generation strategies)
- **Two-word compound:** core (SoundCloud, Mailchimp).
- **Portmanteau / shared-syllable blend:** Pinterest, Instagram. *Future* mode
  (overlap the seam rather than concatenate).
- **Evocative real word:** Stripe, Notion, Linear, Arc.
- **Coined / invented (CVCV):** Google, Canva. Most available, easiest to TM.
  CVCV/VCVC/CVCCV are the premium invented shapes (`kota`, `vita`, `boto`).
- **Affix patterns (modifier × root, what grouping does):**
  - Prefix verbs: `get-`, `try-`, `use-`, `go-`, `make-`.
  - Suffixes: `-ly`, `-ify`, `-io`, `-hq`, `-hub`, `-kit`, `-lab(s)`, `-works`,
    `-forge`, `-smith`, `-bar`, `-base`, `-flow`.
  - Category roots: `-word`, `-name`, `-domain`, `-tag`, `-mark`, `-bot`, `-data`.

## 2026 market tailwinds
- **AI/agent naming is hot:** everyday words + `ai`/`bot`/`agent`/`gpt`; names
  that sound like a helpful tool. Lean into terminal/automation words (`fork`,
  `shell`, `pipe`, `hook`, `cron`, `run`, `runner`, `relay`): common, sayable.
- **Clean short `.com`s are exhausted:** the whole reason a *combination* finder
  has value: it manufactures novel-but-pronounceable two-word `.com`s.

## Calibration pattern of strong picks
- Two real, common words; no invented/cryptic; no hyphens/numbers.
- Each half ~3-6 letters; total 7-10 chars; almost always two syllables.
- A **language/identity unit** (noun, verb, term, slug, handle, url, name,
  logo/banner) paired with an **action or place** mirroring the product:
  *combine* (mix, mash, fuse, blend, knit, weave), *find* (seek, scout, solve),
  *mark/claim* (seal, stamp), *workshop/venue* (bar, booth, club, shop).
- **Both word orders** are in play; sweep with `bothOrders` on.

## How to apply (tool / agent loop)
1. Generate candidate two-word `.com`s (group cross-product, both orders).
2. Filter for availability (DNS → RDAP, existing pipeline).
3. **Score the available ones** against the hard + soft signals above (the
   missing brandability layer, top future improvement).
4. Sort by score; surface top brandable picks, not first-alphabetical opens.
5. For the agent: apply the acid test, dedupe against trademarks, auto-select.

## Keep/reject calibration (rules that OVERRIDE the mechanical score)
- **Meaning resonance OVERRIDES phonetic score.** The highest mechanical scores
  are often rejected for being **semantically empty**: two clean-sounding words
  that form no concept. A meaningful name beats a meaningless higher-scoring one
  every time. **Gate on "does the compound denote a plausible product?" and
  heavily penalize empty joins even with perfect CVC flow.** Single most
  important correction: distrust high scores on vacant compounds.
- **No semantic overlap between halves:** near-synonyms say one thing twice
  (tautological). Each half must add a distinct concept. Penalize synonym pairs.
- **Prefix vs suffix order is load-bearing (startup domains).** Real patterns:
  `the`/`try`/`get`/`go`/`use` **before** the product noun (`thehive`, `tryhive`,
  `getnotion`) are valuable brandable domains for a product named Hive/Notion.
  The **reverse** (`hivethe`, `hivetry`) is almost never a name: articles and CTA
  verbs as the second half should be hard-penalized. `my-` is weaker as a prefix
  than `the-`/`try-` but still better than as a suffix. Score **position**, not
  the token alone.
- **Generic hype prefixes** (`best-`, `top-`, `super-`, `ultra-`) are usually dead
  weight. Possessives (`my-`, `our-`) are mild penalties as prefixes only.
- **TLD is a HARD GATE, not a soft penalty.** A non-`.com` TLD is OK ONLY when it
  completes/reinforces meaning (reads as a unit with the SLD). Generic TLD on an
  unrelated word = dealbreaker. For the `.com`-only tool: stay `.com`.
- **Invented/coined names are in-bounds when smooth** (portmanteaus, CVCV, a real
  word with a vanity letter), gated on pronounceability + radio test. Vanity
  spellings are a mild radio-test risk; tolerate sparingly.
- **Length + concept-count ceiling:** hard-penalize 3+ distinct concepts and
  anything over ~12 chars. Strong picks are tight two-unit names ≤10 chars.
- **Awkward/ambiguous openings** fail the radio test at character one; penalize.

**Net scorer change implied:** add a *meaning/semantics* dimension that can veto a
high phonetic score (empty-join, synonym-overlap, filler-prefix penalties), make
TLD a gate, and add an invented-word generation mode. Strong picks cluster as:
**tight (≤10ch), two distinct concepts OR a smooth coinage, ending on an open/soft
sound, `.com` (or a meaning-completing TLD), denoting a plausible product.**
