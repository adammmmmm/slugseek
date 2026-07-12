// Smoke test for engine.js: confirms the name-finding engine runs headless,
// with no browser/DOM. Run: `node test-engine.mjs`
//
// Defaults to confirm:false and a tiny 2×2 group set so it's fast and works
// offline (the DNS pass just yields "unknown" with no network; scores still
// compute). Pass --confirm and run with network access for a live check.
//
// CI runs this offline (no --confirm). Pure asserts cover scoring, combos,
// and deep-check caps so regressions fail without network.

import {
  findNames,
  buildCombos,
  scoreDomain,
  wordRole,
  classifyParts,
  WORD_ROLES,
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
const poss = scoreDomain("myforge", ["my", "forge"]);
assert(poss.notes.includes("possessive-prefix"), "myforge should note possessive prefix");
assert(poss.score < sc.score, "possessive my- should score below a clean compound");

const syn = scoreDomain("labforge", ["lab", "forge"]);
assert(syn.flags.includes("synonym"), "lab+forge should flag synonym overlap");

const empty = scoreDomain("hubden", ["hub", "den"]);
assert(empty.flags.includes("empty"), "hub+den should flag empty join");

const taut = scoreDomain("lablabs", ["lab", "labs"]);
assert(taut.flags.includes("tautology"), "lab+labs should flag same stem");

// seam-only bad read: token forms only across the join, not inside either half
const badSeam = scoreDomain("cumquat", ["cu", "mquat"]);
assert(badSeam.flags.includes("bad-seam"), "cu+mquat should flag unfortunate seam");

// Startup domain order: TheHive / TryHive are brand forms; reverse is dead.
const theHive = scoreDomain("thehive", ["the", "hive"]);
const hiveThe = scoreDomain("hivethe", ["hive", "the"]);
const tryHive = scoreDomain("tryhive", ["try", "hive"]);
const hiveTry = scoreDomain("hivetry", ["hive", "try"]);
assert(theHive.flags.includes("brand-prefix"), "thehive should get brand-prefix");
assert(theHive.score >= 95, `thehive should be near-top (got ${theHive.score})`);
assert(hiveThe.flags.includes("dead-suffix"), "hivethe should flag dead-suffix");
assert(hiveThe.score <= 60, `hivethe should score poorly (got ${hiveThe.score})`);
assert(theHive.score > hiveThe.score + 25, "thehive must crush hivethe");
assert(tryHive.flags.includes("brand-prefix"), "tryhive should get brand-prefix");
assert(tryHive.score >= 85, `tryhive should score high (got ${tryHive.score})`);
assert(hiveTry.flags.includes("dead-suffix"), "hivetry should flag dead-suffix");
assert(tryHive.score > hiveTry.score + 20, "tryhive must crush hivetry");
console.log(
  `  order: thehive=${theHive.score} hivethe=${hiveThe.score} tryhive=${tryHive.score} hivetry=${hiveTry.score}`,
);

// Word-role classifier (position-aware data; scoreDomain consumes these) ----
assert(wordRole("the", 0) === WORD_ROLES.BRAND_ARTICLE_PREFIX, "the@0 is brand-article-prefix");
assert(wordRole("the", 1) === WORD_ROLES.DEAD_SUFFIX, "the@1 is dead-suffix");
assert(wordRole("try", 0) === WORD_ROLES.BRAND_ACTION_PREFIX, "try@0 is brand-action-prefix");
assert(wordRole("try", 1) === WORD_ROLES.DEAD_SUFFIX, "try@1 is dead-suffix");
assert(wordRole("hive", 0) === WORD_ROLES.CONTENT, "hive@0 is content");
assert(wordRole("hive", 1) === WORD_ROLES.CONTENT, "hive@1 is content");
assert(wordRole("my", 0) === WORD_ROLES.WEAK_POSSESSIVE_PREFIX, "my@0 is weak-possessive-prefix");
assert(wordRole("best", 0) === WORD_ROLES.HYPE_PREFIX, "best@0 is hype-prefix");

const theHiveRoles = classifyParts(["the", "hive"]);
assert(
  theHiveRoles.map((r) => r.role).join(",") === "brand-article-prefix,content",
  "classifyParts(the,hive) roles",
);
const hiveTheRoles = classifyParts(["hive", "the"]);
assert(
  hiveTheRoles.map((r) => r.role).join(",") === "content,dead-suffix",
  "classifyParts(hive,the) roles",
);
assert(
  Array.isArray(theHive.roles) &&
    theHive.roles[0] === WORD_ROLES.BRAND_ARTICLE_PREFIX &&
    theHive.roles[1] === WORD_ROLES.CONTENT,
  "scoreDomain attaches roles for thehive",
);
assert(
  Array.isArray(hiveThe.roles) && hiveThe.roles[1] === WORD_ROLES.DEAD_SUFFIX,
  "scoreDomain attaches dead-suffix role for hivethe",
);
console.log(
  `  roles: thehive=${theHive.roles.join("+")} hivethe=${hiveThe.roles.join("+")}`,
);

// keep / reject fixture table ----------------------------------------------
// Named cases: positives should keep (no reject flags, solid score or brand
// signal); rejects assert expected flag presence and/or score inequality.
const FIXTURES = [
  {
    name: "thehive-keep",
    label: "thehive",
    parts: ["the", "hive"],
    expectFlags: ["brand-prefix"],
    forbidFlags: ["dead-suffix", "synonym", "empty", "tautology", "bad-seam"],
    minScore: 95,
  },
  {
    name: "tryhive-keep",
    label: "tryhive",
    parts: ["try", "hive"],
    expectFlags: ["brand-prefix"],
    forbidFlags: ["dead-suffix", "synonym", "empty", "tautology", "bad-seam"],
    minScore: 85,
  },
  {
    name: "slugseek-keep",
    label: "slugseek",
    parts: ["slug", "seek"],
    expectFlags: [],
    forbidFlags: ["dead-suffix", "synonym", "empty", "tautology", "bad-seam"],
    minScore: 80,
  },
  {
    name: "swiftforge-keep",
    label: "swiftforge",
    parts: ["swift", "forge"],
    expectFlags: [],
    forbidFlags: ["dead-suffix", "synonym", "empty", "tautology", "bad-seam"],
    minScore: 80,
  },
  {
    name: "hivethe-reject",
    label: "hivethe",
    parts: ["hive", "the"],
    expectFlags: ["dead-suffix"],
    forbidFlags: ["brand-prefix"],
    maxScore: 60,
    worseThan: { label: "thehive", parts: ["the", "hive"], by: 25 },
  },
  {
    name: "hivetry-reject",
    label: "hivetry",
    parts: ["hive", "try"],
    expectFlags: ["dead-suffix"],
    forbidFlags: ["brand-prefix"],
    worseThan: { label: "tryhive", parts: ["try", "hive"], by: 20 },
  },
  {
    name: "empty-synonym-reject",
    label: "hubden",
    parts: ["hub", "den"],
    expectFlags: ["empty"],
    // hub+den also synonym-overlap in the thin place/category set
  },
  {
    name: "synonym-reject",
    label: "labforge",
    parts: ["lab", "forge"],
    expectFlags: ["synonym"],
  },
  {
    name: "tautology-reject",
    label: "lablabs",
    parts: ["lab", "labs"],
    expectFlags: ["tautology"],
  },
  {
    name: "bad-seam-reject",
    label: "cumquat",
    parts: ["cu", "mquat"],
    expectFlags: ["bad-seam"],
  },
];

for (const fx of FIXTURES) {
  const got = scoreDomain(fx.label, fx.parts);
  for (const f of fx.expectFlags || []) {
    assert(got.flags.includes(f), `${fx.name}: expected flag "${f}" (got ${JSON.stringify(got.flags)})`);
  }
  for (const f of fx.forbidFlags || []) {
    assert(!got.flags.includes(f), `${fx.name}: forbid flag "${f}" (got ${JSON.stringify(got.flags)})`);
  }
  if (fx.minScore != null) {
    assert(got.score >= fx.minScore, `${fx.name}: score ${got.score} < min ${fx.minScore}`);
  }
  if (fx.maxScore != null) {
    assert(got.score <= fx.maxScore, `${fx.name}: score ${got.score} > max ${fx.maxScore}`);
  }
  if (fx.worseThan) {
    const better = scoreDomain(fx.worseThan.label, fx.worseThan.parts);
    const by = fx.worseThan.by ?? 0;
    assert(
      better.score > got.score + by,
      `${fx.name}: ${fx.worseThan.label} (${better.score}) should beat ${fx.label} (${got.score}) by >${by}`,
    );
  }
}
console.log(`  fixtures: ${FIXTURES.length} keep/reject cases ok`);

// buildCombos counts -------------------------------------------------------
// 1 group: every ordered pair (both orders always), n*(n-1)
const oneGroup = buildCombos([["swift", "bright", "lab"]], false);
assert(oneGroup.length === 6, `1-group 3 words: expected 6, got ${oneGroup.length}`);

// 2 groups, bothOrders off: |A| * |B|
const twoOff = buildCombos(
  [
    ["swift", "bright"],
    ["lab", "forge"],
  ],
  false,
);
assert(twoOff.length === 4, `2-group bothOrders off: expected 4, got ${twoOff.length}`);

// 2 groups, bothOrders on: 2 * |A| * |B|
const twoOn = buildCombos(
  [
    ["swift", "bright"],
    ["lab", "forge"],
  ],
  true,
);
assert(twoOn.length === 8, `2-group bothOrders on: expected 8, got ${twoOn.length}`);

// 3 groups: prefix × root × suffix, fixed order (bothOrders ignored)
const three = buildCombos([["a", "b"], ["c"], ["d", "e"]], true);
assert(three.length === 4, `3-group 2×1×2: expected 4, got ${three.length}`);
const threeOne = buildCombos([["pre"], ["root"], ["suf"]], false);
assert(threeOne.length === 1, `3-group 1×1×1: expected 1, got ${threeOne.length}`);
console.log(
  `  combos: 1g=${oneGroup.length} 2g-off=${twoOff.length} 2g-on=${twoOn.length} 3g=${three.length}`,
);

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

// Hard cap: even if caller asks for more than DEEP_CHECK_MAX, stay at 20.
const many = Array.from({ length: 30 }, (_, i) => ({
  domain: `n${i}.com`,
  score: { score: 100 - i },
}));
const cappedDefault = attachDeepCheck(many);
assert(
  cappedDefault.length === DEEP_CHECK_MAX,
  `attachDeepCheck default should hard-cap at ${DEEP_CHECK_MAX}, got ${cappedDefault.length}`,
);
const cappedHigh = attachDeepCheck(many, 50);
assert(
  cappedHigh.length === DEEP_CHECK_MAX,
  `attachDeepCheck(max=50) should hard-cap at ${DEEP_CHECK_MAX}, got ${cappedHigh.length}`,
);
const fmtCapped = formatDeepCheckText(many, 99);
const fmtCount = (fmtCapped.match(/^## /gm) || []).length;
assert(
  fmtCount === DEEP_CHECK_MAX,
  `formatDeepCheckText should hard-cap at ${DEEP_CHECK_MAX} rows, got ${fmtCount}`,
);
console.log(`  deep-check: hard-cap ${DEEP_CHECK_MAX} ok`);

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
