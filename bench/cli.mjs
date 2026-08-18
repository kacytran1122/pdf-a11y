// Wall clock benchmark for the command line tool over a folder of PDFs.
// Usage: node bench/cli.mjs [--files 40] [--runs 5] [--cli dist/cli.js]
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { availableParallelism } from "node:os";
import { buildCorpus } from "./corpus.mjs";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const fileCount = Number(flag("files", 40));
const runs = Number(flag("runs", 5));
const clis = flag("cli", "dist/cli.js").split(",");

const corpus = await buildCorpus();
// A folder that looks like a service's output directory: mostly medium
// reports, a few large ones, a few untagged strays.
const mix = [
  ...Array(Math.round(fileCount * 0.7)).fill("tagged-50p"),
  ...Array(Math.round(fileCount * 0.05)).fill("tagged-500p"),
  ...Array(Math.round(fileCount * 0.25)).fill("untagged-1p"),
];

const dir = await mkdtemp(join(tmpdir(), "pdf-a11y-bench-"));
try {
  await Promise.all(mix.map((name, i) => writeFile(join(dir, `f${i}.pdf`), corpus.get(name))));

  const quantile = (s, q) => {
    const i = (s.length - 1) * q;
    const lo = Math.floor(i);
    return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
  };

  const measure = async (label, args) => {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      await run(process.execPath, args, { maxBuffer: 256 * 1024 * 1024 }).catch((e) => e);
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log(
      `${label.padEnd(34)} mean ${mean.toFixed(1).padStart(8)} ms   median ${quantile(samples, 0.5).toFixed(1).padStart(8)}   p95 ${quantile(samples, 0.95).toFixed(1).padStart(8)}   files/s ${(mix.length / (mean / 1000)).toFixed(1).padStart(6)}`,
    );
    return mean;
  };

  console.log(`${mix.length} files, ${runs} runs, ${availableParallelism()} CPUs\n`);
  for (const cli of clis) {
    const isBaseline = cli.includes("baseline");
    await measure(`${cli} (default)`, [cli, dir, "--format", "json"]);
    if (!isBaseline) {
      await measure(`${cli} --concurrency 1`, [cli, dir, "--format", "json", "--concurrency", "1"]);
      for (const n of [2, 4, 8]) {
        await measure(`${cli} --concurrency ${n}`, [
          cli,
          dir,
          "--format",
          "json",
          "--concurrency",
          String(n),
        ]);
      }
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
