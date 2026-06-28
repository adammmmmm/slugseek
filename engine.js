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

// ===== brandability scoring (§9): pure, no deps, no network =====
const SCORE_HARD_CLUSTERS = ["thr", "spl", "schr", "ngth", "tchst", "rdsr"];
export function sylCount(s) {
  s = (s || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return 0;
  let g = (s.match(/[aeiouy]+/g) || []).length;
  if (/[^aeiouy]e$/.test(s) && !/[aeiouy]le$/.test(s) && g > 1) g--;
  return Math.max(1, g);
}
export function scoreDomain(label, parts) {
  label = (label || "").toLowerCase();
  parts = (parts || []).filter((p) => p && p.length);
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

  // ---- §9.2 hard rules ----
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

  // ---- §9.3 soft signals ----
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

  const vc = (label.match(/[aeiou]/g) || []).length,
    ratio = vc / Math.max(1, len);
  const rpct = Math.round(ratio * 100);
  if (ratio >= 0.3 && ratio <= 0.55) add(10, `vowel ratio ${rpct}% (balanced)`, "good");
  else if (ratio < 0.22 || ratio > 0.65) {
    notes.push("vowel-imbalance");
    add(-8, `vowel ratio ${rpct}% (imbalanced)`, "bad");
  } else breakdown.push({ delta: 0, label: `vowel ratio ${rpct}% (acceptable)`, kind: "info" });

  const runs = label.match(/[^aeiou]+/g) || [];
  const maxRun = runs.reduce((m, r) => Math.max(m, r.length), 0);
  if (maxRun >= 4) {
    notes.push("pileup");
    add(-(maxRun - 3) * 6, `consonant pile-up (${maxRun} in a row)`, "bad");
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
