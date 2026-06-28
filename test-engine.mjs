// Smoke test for engine.js: confirms the name-finding engine runs headless,
// with no browser/DOM. Run: `node test-engine.mjs`
//
// Defaults to confirm:false and a tiny 2×2 group set so it's fast and works
// offline (the DNS pass just yields "unknown" with no network; scores still
// compute). Pass --confirm and run with network access for a live check.

import { findNames, buildCombos, scoreDomain } from "./engine.js";

const confirm = process.argv.includes("--confirm");

// pure-compute sanity checks (no network) ---------------------------------
const combos = buildCombos([["swift", "bright"], ["lab", "forge"]], true);
console.assert(combos.length === 8, `expected 8 combos, got ${combos.length}`);

const sc = scoreDomain("swiftforge", ["swift", "forge"]);
console.assert(typeof sc.score === "number", "scoreDomain should return a numeric score");
console.log(`scoreDomain("swiftforge") = ${sc.score}  (syl ${sc.syl}, len ${sc.len})`);

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

console.assert(results.length === 8, `expected 8 results, got ${results.length}`);
console.assert(
  results.every((r) => typeof r.score.score === "number"),
  "every result should carry a score",
);
// best-first: scores are non-increasing
for (let i = 1; i < results.length; i++) {
  console.assert(
    results[i - 1].score.score >= results[i].score.score,
    "results should be sorted best-first by score",
  );
}
console.log("\nOK: engine runs headless.");
