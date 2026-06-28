---
description: Run SlugSeek's two-tier availability check (DNS-over-HTTPS, then RDAP) against one or more domains and report open/taken, mirroring the in-app engine.
argument-hint: "<name | name.com> [more...]"
allowed-tools: WebFetch
---
Check `.com` availability for each name in `$ARGUMENTS`, replicating the app's
pipeline. For each name (append `.com` if no TLD given):

1. **Tier 1, DNS-over-HTTPS (fast):** fetch
   `https://dns.google/resolve?name=<DOMAIN>&type=NS`.
   - `Status 3` (NXDOMAIN) → likely OPEN ("clear").
   - `Status 0` → TAKEN.
   - On error/ambiguity, note it and proceed to Tier 2 anyway.
2. **Tier 2, RDAP (authoritative):** fetch
   `https://rdap.verisign.com/com/v1/domain/<DOMAIN>`.
   - HTTP `404` → AVAILABLE (definitive).
   - HTTP `200` → REGISTERED; parse and report registrar, created, expires,
     and status from the RDAP JSON.
   - HTTP `429` → rate-limited; back off briefly and retry once, then report.

Report a compact table: domain · DNS verdict · RDAP verdict · (registrar/dates if
taken). Call out any name where DNS and RDAP disagree. Note that NXDOMAIN/404 means
*unregistered*, not necessarily *buyable* (premium/reserved names).
