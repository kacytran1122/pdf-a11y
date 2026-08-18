import { PDFDocument } from "pdf-lib";
import { buildCorpus } from "./corpus.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const target = process.argv[2];
if (!target) {
  console.error("usage: node bench/analyse.mjs <bundle exporting analyse> [out.json]");
  process.exit(2);
}
const mod = await import(pathToFileURL(resolve(target)).href).catch((error) => {
  console.error(
    `Could not load ${target}: ${error.message}\n` +
      "Build it first, see bench/README.md:\n" +
      "  mkdir -p .bench-current && echo 'export { analyse } from \"../src/checks.js\";' > .bench-current/entry.ts\n" +
      "  npx esbuild .bench-current/entry.ts --bundle --platform=node --format=esm --external:pdf-lib --outfile=.bench-current/analyse.mjs",
  );
  process.exit(2);
});
const analyse = mod.analyse;
const corpus = await buildCorpus();
const q = (s, p) => {
  const i = (s.length - 1) * p,
    l = Math.floor(i),
    h = Math.ceil(i);
  return s[l] + (s[h] - s[l]) * (i - l);
};
const out = {};
for (const [name, bytes] of corpus) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    console.log(name.padEnd(20), "unparseable");
    continue;
  }
  const S = [];
  try {
    for (let i = 0; i < 5; i++) analyse(doc);
    for (let i = 0; i < 40; i++) {
      const t = process.hrtime.bigint();
      analyse(doc);
      S.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  } catch (e) {
    console.log(name.padEnd(20), "FAILED", e.constructor.name + ": " + e.message);
    out[name] = { failed: String(e.message) };
    continue;
  }
  S.sort((a, b) => a - b);
  const mean = S.reduce((a, b) => a + b, 0) / S.length;
  out[name] = { mean, median: q(S, 0.5), p95: q(S, 0.95), p99: q(S, 0.99) };
  console.log(
    name.padEnd(20),
    "mean",
    mean.toFixed(4).padStart(9),
    "ms  p95",
    q(S, 0.95).toFixed(4).padStart(9),
    "  p99",
    q(S, 0.99).toFixed(4).padStart(9),
  );
}
if (process.argv[3]) (await import("node:fs")).writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
