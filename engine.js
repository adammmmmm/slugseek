// engine.js: SlugSeek name-finding engine, framework-free, no DOM.
// Works in the browser (ES module) and Node 18+ (global fetch).
// The UI layer (index.html) imports these and owns rendering, caching, and
// persistence; this module is pure compute + network, no globals.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== combos =====
// groups: array of word arrays. Combinations are cross-group only:
//   1 group  → every ordered pair (always both orders)
//   2 groups → modifier × root (+ the reverse when bothOrders is on)
//   3 groups → prefix × root × suffix, in that fixed order
// maxCombos (optional): if the result would exceed it, the list is shuffled
//   then sampled so coverage isn't front-biased. Omit/0 → no cap (used when
//   the caller needs the complete set, e.g. pruning stale rows).
export function buildCombos(groups, bothOrders, maxCombos) {
  const out = [],
    seen = new Set();
  const push = (...parts) => {
    const l = parts.join("");
    if (l.length >= 1 && l.length <= 63 && !seen.has(l)) {
      seen.add(l);
      out.push({ l, parts });
    }
  };
  const grouped = groups.length > 1;
  if (!grouped) {
    // single list: every ordered pair (always both orders)
    const ws = groups[0] || [];
    for (let i = 0; i < ws.length; i++)
      for (let j = 0; j < ws.length; j++) if (i !== j) push(ws[i], ws[j]);
  } else if (groups.length === 2) {
    // two groups: modifier × root (+ the reverse when --both-orders is on)
    groups[0].forEach((a) =>
      groups[1].forEach((b) => {
        push(a, b);
        if (bothOrders) push(b, a);
      }),
    );
  } else {
    // three groups: prefix × root × suffix, in that fixed order
    groups[0].forEach((a) => groups[1].forEach((b) => groups[2].forEach((c) => push(a, b, c))));
  }
  if (maxCombos && out.length > maxCombos) {
    // Fisher–Yates shuffle then sample (coverage isn't front-biased)
    for (let i = out.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [out[i], out[k]] = [out[k], out[i]];
    }
    return out.slice(0, maxCombos);
  }
  return out;
}

// ===== brandability scoring: pure, no deps, no network =====
// Phonetics + position-aware naming heuristics (startup domain patterns).
// Order matters: "thehive" / "tryhive" are classic brand+prefix forms;
// "hivethe" / "hivetry" are almost never names. Meaning is still a final
// human/agent acid test; this ranks and flags structural traps.
const SCORE_HARD_CLUSTERS = ["thr", "spl", "schr", "ngth", "tchst", "rdsr"];
// Determiners / CTA verbs that work as PREFIXES in real startup domains
// (thehive, tryfigma, getnotion, gohugo, …) — never as the second half.
const BRAND_ARTICLE_PREFIXES = new Set(["the"]);
const BRAND_ACTION_PREFIXES = new Set([
  "get",
  "try",
  "go",
  "use",
  "join",
  "hey",
  "meet",
  "make",
]);
// Possessives / hype as first half: weaker than The/Try but still used (myX).
// Prefer a light penalty as prefix; as suffix they are dead weight (see below).
const WEAK_POSSESSIVE_PREFIXES = new Set(["my", "our", "your"]);
const HYPE_PREFIXES = new Set(["best", "top", "super", "ultra", "mega", "all", "new"]);
// Second-half dead weight: articles, CTA verbs, possessives, function words.
// "hivethe" / "hivetry" should never rank near a real brand form.
const DEAD_SUFFIXES = new Set([
  "the",
  "a",
  "an",
  "try",
  "get",
  "go",
  "use",
  "make",
  "join",
  "hey",
  "meet",
  "my",
  "our",
  "your",
  "of",
  "for",
  "to",
  "and",
  "or",
  "is",
  "be",
  "do",
  "it",
  "me",
  "we",
  "us",
  "best",
  "top",
  "new",
  "all",
]);
// Thin place/category tokens: two of these with no identity word ≈ empty join.
const THIN_WORDS = new Set([
  "hub",
  "den",
  "nest",
  "spot",
  "zone",
  "box",
  "app",
  "web",
  "net",
  "bit",
  "pro",
  "max",
  "min",
  "lab",
  "labs",
  "shop",
  "co",
  "hq",
  "inc",
]);
// Near-synonym buckets: both halves in one bucket say the same thing twice.
const SYNONYM_GROUPS = [
  ["lab", "labs", "studio", "works", "forge", "shop", "craft", "foundry"],
  ["swift", "fast", "quick", "rapid", "speedy"],
  ["bright", "light", "clear", "shine", "glow"],
  ["hub", "nest", "den", "base", "hq", "center", "centre"],
  ["code", "dev", "build", "script", "byte"],
  ["path", "way", "road", "route", "trail"],
  ["peak", "summit", "crest", "apex"],
  ["wave", "tide", "flow", "stream"],
];
// Bad tokens that only count when they form at a word seam (not wholly inside one half).
const BAD_SEAM_TOKENS = [
  "ass",
  "sex",
  "cum",
  "fag",
  "dick",
  "cock",
  "shit",
  "piss",
  "anal",
  "rape",
  "nazi",
  "fuck",
  "cunt",
  "porn",
  "xxx",
];

function stemKey(w) {
  w = (w || "").toLowerCase();
  if (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  if (w.length > 4 && w.endsWith("er")) w = w.slice(0, -2);
  return w;
}

function sameSynonymGroup(a, b) {
  const la = a.toLowerCase(),
    lb = b.toLowerCase();
  for (const g of SYNONYM_GROUPS) {
    if (g.includes(la) && g.includes(lb) && la !== lb) return g.join("/");
  }
  return null;
}

// Tokens that appear only because two parts were glued (cross the seam).
function seamOnlyBadHits(parts) {
  if (!parts || parts.length < 2) return [];
  const hits = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const left = (parts[i] || "").toLowerCase();
    const right = (parts[i + 1] || "").toLowerCase();
    const joined = left + right;
    for (const tok of BAD_SEAM_TOKENS) {
      if (!joined.includes(tok)) continue;
      if (left.includes(tok) || right.includes(tok)) continue;
      // must actually straddle the join point
      const idx = joined.indexOf(tok);
      const seam = left.length;
      if (idx < seam && idx + tok.length > seam) hits.push(tok);
    }
  }
  return [...new Set(hits)];
}

export function sylCount(s) {
  s = (s || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return 0;
  let g = (s.match(/[aeiouy]+/g) || []).length;
  if (/[^aeiouy]e$/.test(s) && !/[aeiouy]le$/.test(s) && g > 1) g--;
  return Math.max(1, g);
}
export function scoreDomain(label, parts) {
  label = (label || "").toLowerCase();
  parts = (parts || []).filter((p) => p && p.length).map((p) => String(p).toLowerCase());
  const len = label.length,
    syl = sylCount(label);
  const flags = [],
    notes = [],
    breakdown = [];
  let score = 50;
  const add = (d, lab, kind) => {
    score += d;
    breakdown.push({
      delta: d,
      label: lab,
      kind: kind || (d > 0 ? "good" : d < 0 ? "bad" : "info"),
    });
  };
  breakdown.push({ delta: 50, label: "baseline", kind: "base" });

  // ---- hard rules ----
  if (/[^a-z]/.test(label)) {
    flags.push("non-alpha");
    add(-40, "non-alpha character", "bad");
  }
  let seamStr = "";
  if (parts.length >= 2) {
    const seams = [],
      doubled = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const lc = parts[i].slice(-1),
        rc = parts[i + 1][0];
      seams.push(lc + "|" + rc);
      if (lc === rc) doubled.push(lc + rc);
    }
    seamStr = seams.join(" ");
    if (doubled.length)
      add(
        -16 * doubled.length,
        `doubled letter at seam (“${doubled.join("”, “")}”)`,
        "bad",
      );
  }
  let clusterHit = null;
  for (const cl of SCORE_HARD_CLUSTERS) {
    if (label.includes(cl)) {
      clusterHit = cl;
      break;
    }
  }
  if (clusterHit) {
    flags.push("cluster");
    add(-8, `hard consonant cluster (“${clusterHit}”)`, "bad");
  }
  const clunk = (label.match(/[qxz]/g) || []).length;
  if (clunk) {
    notes.push("clunky");
    add(-clunk * 5, `clunky letter${clunk > 1 ? "s" : ""} ×${clunk} (q/x/z)`, "bad");
  }

  // Unfortunate readings formed only at the join (pen-island class).
  const seamBads = seamOnlyBadHits(parts);
  if (seamBads.length) {
    flags.push("bad-seam");
    add(-28 * seamBads.length, `unfortunate seam read (“${seamBads.join("”, “")}”)`, "bad");
  }

  // ---- soft phonetics ----
  if (len >= 5 && len <= 10) add(14, `length ${len} (5–10 sweet spot)`, "good");
  else if (len === 11 || len === 12) add(4, `length ${len} (slightly long)`, "info");
  else if (len > 12) {
    notes.push("long");
    add(-(len - 12) * 3, `length ${len} (over 12)`, "bad");
  } else if (len < 5) {
    notes.push("short");
    add(-6, `length ${len} (under 5)`, "bad");
  }

  if (syl === 2) add(16, "2 syllables (ideal)", "good");
  else if (syl === 3) add(8, "3 syllables (good)", "good");
  else if (syl === 4) add(2, "4 syllables (ok)", "info");
  else if (syl === 1) add(-4, "1 syllable (thin)", "bad");
  else if (syl >= 5) add(-10, `${syl} syllables (too many)`, "bad");

  // Count y as a vowel for ratio + pile-up (matches sylCount; "tryhive" is not a 4-consonant run).
  const vc = (label.match(/[aeiouy]/g) || []).length,
    ratio = vc / Math.max(1, len);
  const rpct = Math.round(ratio * 100);
  if (ratio >= 0.3 && ratio <= 0.55) add(10, `vowel ratio ${rpct}% (balanced)`, "good");
  else if (ratio < 0.22 || ratio > 0.65) {
    notes.push("vowel-imbalance");
    add(-8, `vowel ratio ${rpct}% (imbalanced)`, "bad");
  } else breakdown.push({ delta: 0, label: `vowel ratio ${rpct}% (acceptable)`, kind: "info" });

  const runs = label.match(/[^aeiouy]+/g) || [];
  const maxRun = runs.reduce((m, r) => Math.max(m, r.length), 0);
  if (maxRun >= 4) {
    notes.push("pileup");
    add(-(maxRun - 3) * 6, `consonant pile-up (${maxRun} in a row)`, "bad");
  }

  // ---- position-aware naming heuristics (still pure client-side) ----
  // Startup domains routinely use TheX / TryX / GetX as the *domain* form of a
  // product called X. The reverse (Xthe, Xtry) is almost never a brand.
  if (parts.length >= 2) {
    const a = parts[0],
      b = parts[1];
    const rootOk = b.length >= 3 && !DEAD_SUFFIXES.has(b) && !BRAND_ARTICLE_PREFIXES.has(b);

    // 1) Dead second half first (hard structural fail).
    if (DEAD_SUFFIXES.has(b)) {
      flags.push("dead-suffix");
      notes.push("bad-order");
      add(
        -34,
        `dead second half (“-${b}”: articles/CTA verbs belong as prefixes, not suffixes)`,
        "bad",
      );
    } else if (BRAND_ARTICLE_PREFIXES.has(a) && rootOk) {
      // 2) TheHive pattern: determiner + identity noun. Real brand form.
      flags.push("brand-prefix");
      notes.push("the-brand");
      add(18, `brand article prefix (“the-” + “${b}”)`, "good");
    } else if (BRAND_ACTION_PREFIXES.has(a) && rootOk) {
      // 3) TryHive / GetNotion / GoHugo: CTA verb + product name.
      flags.push("brand-prefix");
      notes.push("action-prefix");
      add(12, `brand action prefix (“${a}-” + “${b}”)`, "good");
    } else if (WEAK_POSSESSIVE_PREFIXES.has(a) && rootOk) {
      // 4) myX is used but weaker than The/Try; light penalty only.
      notes.push("possessive-prefix");
      add(-6, `possessive prefix (“${a}-”)`, "bad");
    } else if (HYPE_PREFIXES.has(a) && rootOk) {
      notes.push("hype-prefix");
      add(-10, `hype prefix (“${a}-”)`, "bad");
    }

    // Same stem twice: lab/labs, work/works
    if (stemKey(a) && stemKey(a) === stemKey(b)) {
      flags.push("tautology");
      notes.push("same-stem");
      add(-22, `same stem twice (“${a}” / “${b}”)`, "bad");
    } else {
      const syn = sameSynonymGroup(a, b);
      if (syn) {
        flags.push("synonym");
        notes.push("synonym-overlap");
        add(-16, `near-synonym halves (${syn})`, "bad");
      }
    }

    // Empty join: two thin place/category words, no identity payload
    if (THIN_WORDS.has(a) && THIN_WORDS.has(b)) {
      flags.push("empty");
      notes.push("empty-join");
      add(-20, `empty join (“${a}” + “${b}” are both thin)`, "bad");
    }

    // 3+ distinct parts: hard to own
    if (parts.length >= 3) {
      notes.push("multi-concept");
      add(-12, `${parts.length} parts (prefer two)`, "bad");
    }
  }

  const raw = score;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    raw,
    syl,
    len,
    vowelRatio: rpct,
    maxRun,
    seam: seamStr,
    flags,
    notes,
    breakdown,
  };
}

// ===== deep-check (shortlist only; link-out, no bulk fetch) =====
// Cap diligence to a handful of names. Never run on a full multi-thousand sweep.
export const DEEP_CHECK_MAX = 20;

// Build USPTO + web collision links for one domain or SLD. No network.
export function deepCheckLinks(domainOrLabel) {
  const raw = String(domainOrLabel || "").trim().toLowerCase();
  const label = raw.replace(/\.com$/i, "").replace(/[^a-z0-9-]/g, "");
  const domain = label ? label + ".com" : "";
  const q = encodeURIComponent(label);
  const qBrand = encodeURIComponent(`"${label}" brand OR company OR app OR software`);
  const qExact = encodeURIComponent(`"${label}.com"`);
  const qTm = encodeURIComponent(`"${label}" trademark`);
  return {
    label,
    domain,
    // DuckDuckGo: no login, fine as a collision starting point
    web: `https://duckduckgo.com/?q=${qBrand}`,
    webExact: `https://duckduckgo.com/?q=${qExact}`,
    // USPTO has no stable CORS API for bulk use; open their search + a trademark web query
    uspto: `https://tmsearch.uspto.gov/`,
    usptoHint: label,
    trademarkWeb: `https://duckduckgo.com/?q=${qTm}`,
  };
}

// Attach deepCheck links to at most `max` rows (already filtered/sorted by caller).
export function attachDeepCheck(rows, max = DEEP_CHECK_MAX) {
  const n = Math.max(0, Math.min(Number(max) || DEEP_CHECK_MAX, DEEP_CHECK_MAX));
  return (rows || []).slice(0, n).map((r) => ({
    ...r,
    deepCheck: deepCheckLinks(r.domain || r),
  }));
}

// Human-readable diligence block for clipboard (UI / agents).
export function formatDeepCheckText(rows, max = DEEP_CHECK_MAX) {
  const list = attachDeepCheck(rows, max);
  if (!list.length) return "";
  const lines = [
    `# slugseek deep-check (shortlist, max ${Math.min(list.length, max)})`,
    `# open ≠ clear trademark. Check each name before you register.`,
    "",
  ];
  for (const r of list) {
    const dc = r.deepCheck;
    const score =
      r.score && typeof r.score === "object"
        ? r.score.score
        : typeof r.score === "number"
          ? r.score
          : "";
    lines.push(`## ${dc.domain}${score !== "" ? `  (score ${score})` : ""}`);
    lines.push(`web:        ${dc.web}`);
    lines.push(`exact:      ${dc.webExact}`);
    lines.push(`trademark:  ${dc.trademarkWeb}`);
    lines.push(`uspto:      ${dc.uspto}  (search for: ${dc.usptoHint})`);
    lines.push("");
  }
  return lines.join("\n");
}

// ===== adaptive pacing =====
// Verisign RDAP (and DoH) 429 under load. A pacer holds a shared backoff delay
// the network calls honor. onHit/onOk are optional UI hooks (e.g. a notice).
export function makePacer(opts = {}) {
  const onHit = opts.onHit || (() => {});
  const onOk = opts.onOk || (() => {});
  return {
    delay: 0,
    hit() {
      this.delay = Math.min(3000, this.delay + 250);
      onHit();
    },
    ok() {
      if (this.delay > 0) {
        this.delay = Math.max(0, this.delay - 15);
        if (this.delay === 0) onOk();
      }
    },
  };
}

// ===== network: two-tier availability =====
const RDAP_URL = (d) => `https://rdap.verisign.com/com/v1/domain/${d}`;

// Tier 1: DNS-over-HTTPS NS lookup (bulk/fast). Google primary, Cloudflare
// fallback. opts: { pacer, onNet }. onNet(failed:boolean) fires once per call.
export async function dohNS(domain, opts = {}) {
  const { pacer, onNet } = opts;
  if (pacer && pacer.delay) await sleep(pacer.delay);
  try {
    const r = await fetch(`https://dns.google/resolve?name=${domain}&type=NS`);
    if (onNet) onNet(false);
    if (!r.ok) {
      if (r.status === 429 && pacer) pacer.hit();
      return "unknown";
    }
    const j = await r.json();
    if (pacer) pacer.ok();
    if (j.Status === 3) return "clear";
    if (j.Status === 0) return "taken";
    return "unknown";
  } catch (e) {
    try {
      const r2 = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=NS`, {
        headers: { accept: "application/dns-json" },
      });
      if (onNet) onNet(false);
      if (!r2.ok) return "unknown";
      const j2 = await r2.json();
      if (j2.Status === 3) return "clear";
      if (j2.Status === 0) return "taken";
      return "unknown";
    } catch (e2) {
      if (onNet) onNet(true);
      return "unknown";
    }
  }
}

function parseRdap(j) {
  const info = { registrar: "-", created: "-", expires: "-", status: "-" };
  try {
    const reg = (j.entities || []).find((e) => (e.roles || []).includes("registrar"));
    const fn =
      reg && Array.isArray(reg.vcardArray) ? reg.vcardArray[1]?.find((x) => x[0] === "fn") : null;
    if (fn) info.registrar = fn[3];
    (j.events || []).forEach((ev) => {
      const d = (ev.eventDate || "").slice(0, 10);
      if (ev.eventAction === "registration") info.created = d;
      if (ev.eventAction === "expiration") info.expires = d;
    });
    if (Array.isArray(j.status) && j.status.length) info.status = j.status.join(", ");
  } catch (e) {}
  return info;
}

// Tier 2: RDAP authoritative confirm. opts: { pacer }. 404 ⇒ open,
// 200 ⇒ registered (+ parsed info), 429 ⇒ backoff + retry then "rate".
export async function rdapCheck(domain, opts = {}, tries = 0) {
  const { pacer } = opts;
  if (pacer && pacer.delay) await sleep(pacer.delay);
  try {
    const r = await fetch(RDAP_URL(domain));
    if (r.status === 404) {
      if (pacer) pacer.ok();
      return { state: "open" };
    }
    if (r.status === 200) {
      if (pacer) pacer.ok();
      return { state: "registered", info: parseRdap(await r.json()) };
    }
    if (r.status === 429) {
      if (pacer) pacer.hit();
      if (tries < 3) {
        await sleep(500 + (pacer ? pacer.delay : 0));
        return rdapCheck(domain, opts, tries + 1);
      }
      return { state: "rate" };
    }
    return { state: "error" };
  } catch (e) {
    return { state: "neterror" };
  }
}

// Bounded-concurrency worker pool. shouldStop (optional) is polled between
// items so callers can cancel mid-run.
export async function pool(items, limit, worker, shouldStop) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        if (shouldStop && shouldStop()) return;
        const idx = i++;
        await worker(items[idx], idx);
      }
    }),
  );
}

// Collapse dns + rdap into the headless availability state.
function stateOf(d) {
  if (d.rdap) {
    if (d.rdap.state === "open") return "open";
    if (d.rdap.state === "registered") return "registered";
    // rate/error/neterror → fall back to the DNS signal
  }
  if (d.dns === "clear") return "open";
  if (d.dns === "taken") return "registered";
  return "unknown";
}

// ===== headless orchestration =====
// The DOM-free equivalent of the UI's sweep(): buildCombos → DNS pass →
// RDAP-confirm the open candidates → attach scores → sort best-first.
//
// config: {
//   groups: [["swift","bright"], ["lab","forge"]],  // cross-group combined
//   bothOrders: true,
//   confirm: true,        // run RDAP confirm on open candidates (default true)
//   maxCombos: 10000,
//   dohConc: 12, rdapConc: 3,
//   onProgress: (done, total) => {},  // optional, fired during the DNS pass
//   shouldStop: () => false,          // optional cancel hook
// }
// returns: [{ domain, a, b, parts, dns, rdap, state, score }] sorted best-first.
export async function findNames(config = {}) {
  const {
    groups = [],
    bothOrders = true,
    confirm = true,
    maxCombos = 10000,
    dohConc = 12,
    rdapConc = 3,
    onProgress,
    shouldStop = () => false,
  } = config;

  const combos = buildCombos(groups, bothOrders, maxCombos);
  const rows = combos.map((c) => ({
    domain: c.l + ".com",
    a: c.parts[0],
    b: c.parts[1],
    parts: c.parts,
    dns: null,
    rdap: null,
    state: "unknown",
  }));

  const pacer = makePacer();
  const total = rows.length;
  let done = 0;

  // Tier 1: DNS over all combos.
  await pool(
    rows,
    dohConc,
    async (d) => {
      d.dns = await dohNS(d.domain, { pacer });
      done++;
      if (onProgress) onProgress(done, total);
    },
    shouldStop,
  );

  // Tier 2: RDAP confirm the open candidates.
  if (confirm && !shouldStop()) {
    const candidates = rows.filter((d) => d.dns === "clear");
    await pool(
      candidates,
      rdapConc,
      async (d) => {
        const res = await rdapCheck(d.domain, { pacer });
        if (res.state === "open" || res.state === "registered") d.rdap = res;
      },
      shouldStop,
    );
  }

  // Attach scores + final state, then sort best-first.
  rows.forEach((d) => {
    const label = d.domain.replace(/\.com$/, "");
    d.score = scoreDomain(label, d.parts);
    d.state = stateOf(d);
  });
  rows.sort(
    (x, y) =>
      y.score.score - x.score.score || x.domain.length - y.domain.length || (x.domain < y.domain ? -1 : 1),
  );
  return rows;
}
