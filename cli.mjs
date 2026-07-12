#!/usr/bin/env node
// cli.mjs: thin headless wrapper around engine.js so an agent (or a shell) can
// run a full name sweep with one command and parse the result as JSON.
//
// Config in (flags, a JSON file, or stdin), JSON out on stdout. Progress and
// errors go to stderr, so stdout is always clean machine-readable JSON.
//
// Examples:
//   node cli.mjs --groups "swift,bright / lab,forge" --no-confirm
//   node cli.mjs --file seed-wordset.json --open-only --limit 20
//   cat seed-wordset.json | node cli.mjs --stdin --pretty
//
// The --file/--stdin JSON uses the same shape as an in-app export
// (seed-wordset.json): { groups: [[...],[...]], bothOrders: true }.

import { findNames, attachDeepCheck, DEEP_CHECK_MAX } from "./engine.js";

const HELP = `slugseek: headless .com name finder

Usage: node cli.mjs [options]

Word input (pick one; flags win over file/stdin):
  --groups "a,b / c,d"   groups separated by " / ", words by comma
  --file, -f <path>      read { groups, bothOrders } from a JSON file
  --stdin                read that JSON config from stdin

Sweep options:
  --both-orders          force both orders on (default: from input, else true)
  --no-both-orders       force both orders off
  --no-confirm           skip the RDAP confirm pass (DNS-only; works offline)
  --max-combos <n>       cap combinations (default 10000)
  --doh-conc <n>         DNS concurrency (default 12)
  --rdap-conc <n>        RDAP concurrency (default 3)

Output options:
  --open-only            only rows whose state is "open"
  --min-score <n>        only rows scoring >= n
  --limit <n>            keep at most n rows (after filtering)
  --deep-check           attach USPTO/web diligence links (shortlist only;
                         applies after filters; hard-capped at ${DEEP_CHECK_MAX})
  --deep-check-max <n>   cap deep-check rows (default ${DEEP_CHECK_MAX}, max ${DEEP_CHECK_MAX})
  --verbose              include the full score breakdown per row
  --pretty               indent the JSON output
  --progress             print "done/total" progress to stderr
  -h, --help             this message

Output: { ok, count, total, config, results } on stdout.
Each result: { domain, parts, dns, rdap, state, score } (+ scoreDetail if --verbose)
(+ deepCheck links if --deep-check).

Deep-check never runs on the full unfiltered sweep: use --open-only and/or
--limit so diligence stays proportional to a shortlist, not thousands of combos.`;

// ---- tiny flag parser ----------------------------------------------------
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) continue;
    const key = a.replace(/^--?/, "");
    const takesValue = [
      "groups",
      "file",
      "f",
      "max-combos",
      "doh-conc",
      "rdap-conc",
      "min-score",
      "limit",
      "deep-check-max",
    ].includes(key);
    if (takesValue) {
      flags[key] = argv[++i];
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function parseGroupsFlag(s) {
  return s
    .split("/")
    .map((g) =>
      g
        .split(",")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter((g) => g.length);
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

// ---- main ----------------------------------------------------------------
const flags = parseArgs(process.argv.slice(2));

if (flags.help || flags.h) {
  process.stdout.write(HELP + "\n");
  process.exit(0);
}

// Resolve word config: --groups, then --file/-f, then --stdin.
let cfg = {};
const groupsFlag = flags.groups;
const filePath = flags.file || flags.f;

if (filePath || flags.stdin) {
  let raw;
  try {
    if (flags.stdin) {
      raw = await readStdin();
    } else {
      raw = await (await import("node:fs/promises")).readFile(filePath, "utf8");
    }
  } catch (e) {
    fail(`could not read config: ${e.message}`);
  }
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    fail(`config is not valid JSON: ${e.message}`);
  }
}

let groups = groupsFlag ? parseGroupsFlag(groupsFlag) : cfg.groups;
if (!Array.isArray(groups) || !groups.length || !groups.some((g) => g.length)) {
  fail("no words given. Use --groups, --file, or --stdin (see --help).");
}

// bothOrders: explicit flags win, else config value, else true.
let bothOrders = true;
if (typeof cfg.bothOrders === "boolean") bothOrders = cfg.bothOrders;
if (flags["both-orders"]) bothOrders = true;
if (flags["no-both-orders"]) bothOrders = false;

const num = (v, d) => (v == null ? d : Number(v));
const config = {
  groups,
  bothOrders,
  confirm: !flags["no-confirm"],
  maxCombos: num(flags["max-combos"], 10000),
  dohConc: num(flags["doh-conc"], 12),
  rdapConc: num(flags["rdap-conc"], 3),
  onProgress: flags.progress
    ? (done, total) => process.stderr.write(`\rdns ${done}/${total}`)
    : undefined,
};

let rows;
try {
  rows = await findNames(config);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
  process.exit(1);
}
if (flags.progress) process.stderr.write("\n");

const total = rows.length;

// Filter + shape the output.
let out = rows;
if (flags["open-only"]) out = out.filter((r) => r.state === "open");
if (flags["min-score"] != null) {
  const min = num(flags["min-score"], 0);
  out = out.filter((r) => r.score.score >= min);
}
if (flags.limit != null) out = out.slice(0, Math.max(0, num(flags.limit, out.length)));

// Deep-check is shortlist-only: only after filters/limit, hard-capped.
const deepCheck = !!flags["deep-check"];
const deepMax = Math.max(
  0,
  Math.min(DEEP_CHECK_MAX, num(flags["deep-check-max"], DEEP_CHECK_MAX)),
);
if (deepCheck) {
  if (!flags["open-only"] && flags.limit == null && out.length > deepMax) {
    process.stderr.write(
      `note: --deep-check without --open-only/--limit; attaching links to top ${deepMax} of ${out.length} only\n`,
    );
  }
  out = attachDeepCheck(out, deepMax).concat(out.slice(deepMax));
}

const results = out.map((r) => {
  const row = {
    domain: r.domain,
    parts: r.parts,
    dns: r.dns,
    rdap: r.rdap,
    state: r.state,
    score: r.score.score,
  };
  if (flags.verbose) row.scoreDetail = r.score;
  if (r.deepCheck) row.deepCheck = r.deepCheck;
  return row;
});

const payload = {
  ok: true,
  count: results.length,
  total,
  config: {
    bothOrders,
    confirm: config.confirm,
    maxCombos: config.maxCombos,
    deepCheck,
    deepCheckMax: deepCheck ? deepMax : undefined,
  },
  results,
};

process.stdout.write(JSON.stringify(payload, null, flags.pretty ? 2 : 0) + "\n");
