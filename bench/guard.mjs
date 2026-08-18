// Benchmark sanity check for CI.
//
// Shared runners are far too noisy to gate on latency, so this asserts the
// things that are stable: every corpus document, including the adversarial
// ones, is checked without throwing, without hanging, and within a budget
// generous enough that only a real complexity regression trips it.
import { checkPdf } from "../dist/index.js";
import { buildCorpus } from "./corpus.mjs";

/** Milliseconds. Roughly 20x the measured time on a developer machine. */
const BUDGET = {
  "untagged-1p": 200,
  "tagged-1p": 200,
  "tagged-50p": 2_000,
  "tagged-500p": 20_000,
  "image-heavy-100p": 2_000,
  "annot-heavy-100p": 3_000,
  "deep-nest-20k": 20_000,
  "nested-tables-200": 3_000,
  "wide-table-10k": 15_000,
  cyclic: 200,
  "not-a-pdf": 200,
  truncated: 500,
};

const corpus = await buildCorpus();
let failed = 0;

for (const [name, bytes] of corpus) {
  const budget = BUDGET[name] ?? 20_000;
  const started = process.hrtime.bigint();
  let report;
  try {
    report = await checkPdf(bytes, { file: name });
  } catch (error) {
    console.error(`FAIL ${name}: threw ${String(error)}`);
    failed++;
    continue;
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  if (!Array.isArray(report.issues)) {
    console.error(`FAIL ${name}: report has no issues array`);
    failed++;
    continue;
  }
  if (ms > budget) {
    console.error(`FAIL ${name}: ${ms.toFixed(1)} ms is over the ${budget} ms budget`);
    failed++;
    continue;
  }
  console.log(`ok   ${name.padEnd(20)} ${ms.toFixed(1).padStart(8)} ms  (budget ${budget})`);
}

// The documents that are meant to produce findings must still produce them, so
// a regression that silently reports nothing cannot pass as "fast".
const untagged = await checkPdf(corpus.get("untagged-1p"));
if (!untagged.issues.some((i) => i.check === "struct-tree")) {
  console.error("FAIL untagged-1p: expected a struct-tree finding");
  failed++;
}
const deep = await checkPdf(corpus.get("deep-nest-20k"));
if (deep.readError !== undefined) {
  console.error(`FAIL deep-nest-20k: ${deep.readError}`);
  failed++;
}

process.exitCode = failed > 0 ? 1 : 0;
