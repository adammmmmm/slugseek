// Smoke test for engine.js: confirms the name-finding engine runs headless,
// with no browser/DOM. Run: `node test-engine.mjs`
//
// Defaults to confirm:false and a tiny 2×2 group set so it's fast and works
// offline (the DNS pass just yields "unknown" with no network; scores still
// compute). Pass --confirm and run with network access for a live check.

import {
  findNames,
  buildCombos,
  scoreDomain,
  deepCheckLinks,
  attachDeepCheck,
  formatDeepCheckText,
  DEEP_CHECK_MAX,
} from "./engine.js";

const confirm = process.argv.includes("--confirm");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// pure-compute sanity checks (no network) ---------------------------------
const combos = buildCombos(
  [
    ["swift", "bright"],
    ["lab", "forge"],
  ],
  true,
);
assert(combos.length === 8, `expected 8 combos, got ${combos.length}`);

const sc = scoreDomain("swiftforge", ["swift", "forge"]);
assert(typeof sc.score === "number", "scoreDomain should return a numeric score");
console.log(`scoreDomain("swiftforge") = ${sc.score}  (syl ${sc.syl}, len ${sc.len})`);

// semantic / seam scoring --------------------------------------------------
const filler = scoreDomain("myforge", ["my", "forge"]);
assert(filler.flags.includes("filler"), "filler prefix should flag myforge");
assert(filler.score < sc.score, "filler should score below a clean compound");

const syn = scoreDomain("labforge", ["lab", "forge"]);
assert(syn.flags.includes("synonym"), "lab+forge should flag synonym overlap");

const empty = scoreDomain("hubden", ["hub", "den"]);
assert(empty.flags.includes("empty"), "hub+den should flag empty join");

const taut = scoreDomain("lablabs", ["lab", "labs"]);
assert(taut.flags.includes("tautology"), "lab+labs should flag same stem");

// seam-only bad read: token forms only across the join, not inside either half
const badSeam = scoreDomain("cumquat", ["cu", "mquat"]);
assert(badSeam.flags.includes("bad-seam"), "cu+mquat should flag unfortunate seam");

// deep-check helpers (no network) ------------------------------------------
const links = deepCheckLinks("swiftforge.com");
assert(links.label === "swiftforge", "deepCheck label");
assert(links.web.includes("duckduckgo"), "web link");
assert(links.uspto.includes("uspto"), "uspto link");
assert(DEEP_CHECK_MAX === 20, "default deep-check cap is 20");

const attached = attachDeepCheck(
  [{ domain: "a.com", score: { score: 90 } }, { domain: "b.com", score: { score: 80 } }],
  1,
);
assert(attached.length === 1 && attached[0].deepCheck, "attachDeepCheck respects max");
const text = formatDeepCheckText([{ domain: "swiftforge.com", score: 90 }], 5);
assert(text.includes("swiftforge.com") && text.includes("web:"), "formatDeepCheckText");

// full headless pipeline ---------------------------------------------------
console.log(`\nfindNames (confirm:${confirm}) …`);
const results = await findNames({
  groups: [
    ["swift", "bright"],
    ["lab", "forge"],
  ],
  bothOrders: true,
  confirm,
  onProgress: (done, total) => {
    if (done === total) console.log(`  dns pass: ${done}/${total}`);
  },
});

console.log(`\n${results.length} results (best-first):`);
for (const r of results) {
  console.log(
    `  ${String(r.score.score).padStart(3)}  ${r.domain.padEnd(18)} ` +
      `dns=${r.dns ?? "-"} state=${r.state}`,
  );
}

assert(results.length === 8, `expected 8 results, got ${results.length}`);
assert(
  results.every((r) => typeof r.score.score === "number"),
  "every result should carry a score",
);
// best-first: scores are non-increasing
for (let i = 1; i < results.length; i++) {
  assert(
    results[i - 1].score.score >= results[i].score.score,
    "results should be sorted best-first by score",
  );
}
console.log("\nOK: engine runs headless.");
