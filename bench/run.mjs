// Benchmark harness. Usage:
//   node bench/run.mjs [--module <path>] [--json <out>] [--iterations <n>] [--only <name>]
//
// Reports mean / median / p95 / p99 latency, throughput and heap growth per
// corpus document. Every measurement is a real end-to-end checkPdf() call.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildCorpus } from "./corpus.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const modulePath = resolve(flag("module", "dist/index.js"));
const iterations = Number(flag("iterations", 30));
const warmup = Number(flag("warmup", 5));
const only = flag("only", null);
const jsonOut = flag("json", null);

const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, samples.length - 1);
  return {
    n: samples.length,
    min: sorted[0],
    mean,
    stdev: Math.sqrt(variance),
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    opsPerSec: 1000 / mean,
  };
};

const { checkPdf } = await import(pathToFileURL(modulePath).href);
const corpus = await buildCorpus();

const results = {};
for (const [name, bytes] of corpus) {
  if (only && name !== only) continue;

  let failed = null;
  const samples = [];
  try {
    for (let i = 0; i < warmup; i++) await checkPdf(bytes, { file: name });
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    let peak = heapBefore;
    for (let i = 0; i < iterations; i++) {
      const t0 = process.hrtime.bigint();
      await checkPdf(bytes, { file: name });
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    global.gc?.();
    results[name] = {
      bytes: bytes.length,
      ...stats(samples),
      throughputMBps: bytes.length / 1024 / 1024 / (stats(samples).mean / 1000),
      heapPeakDeltaMB: (peak - heapBefore) / 1024 / 1024,
      heapRetainedMB: (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024,
    };
  } catch (error) {
    failed = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    results[name] = { bytes: bytes.length, failed };
  }

  const r = results[name];
  const cell = (v) => (typeof v === "number" ? v.toFixed(3).padStart(9) : String(v).padStart(9));
  console.log(
    failed
      ? `${name.padEnd(20)} FAILED  ${failed}`
      : `${name.padEnd(20)} mean ${cell(r.mean)} ms  p95 ${cell(r.p95)}  p99 ${cell(r.p99)}  ops/s ${cell(r.opsPerSec)}  heapΔ ${cell(r.heapPeakDeltaMB)} MB`,
  );
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ module: modulePath, node: process.version, iterations, results }, null, 2),
  );
}
