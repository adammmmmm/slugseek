---
description: Score one or more candidate domain names against the brandability rubric, then optionally check availability; the full SlugSeek pick loop.
argument-hint: "<name> [more...] [--check]"
allowed-tools: WebFetch, Read, Skill
---
Evaluate each candidate name in `$ARGUMENTS` as a brand.

1. Load the `naming-heuristics` skill and apply its full rubric to each name:
   - Run the **hard rules** first (hyphens/numbers, seam double-letters, accidental
     words at the seam, hard consonant clusters, clunky letters); flag any hit.
   - Score the **soft signals** (length, syllables, radio test, C/V flow,
     industry-agnostic, ownability, meaning resonance).
   - Apply the **keep/reject calibration overrides**, especially the
     empty-join / semantic-overlap / filler-prefix penalties and the acid test
     ("would a founder build their company on this?").
2. Give each name a 0-100 score with a short breakdown of the signals that moved
   it, and a clear keep / borderline / reject verdict.
3. Rank the candidates best-first and recommend a top pick with one-line rationale.
4. If `--check` is present, run the availability check (DNS-over-HTTPS then RDAP, as
   in the `/check-availability` command) for the surviving candidates and note
   which are actually open.
