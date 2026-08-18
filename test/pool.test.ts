import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORKER_THRESHOLD, checkFiles, type FileJob } from "../src/pool.js";
import { makeGoodPdf, makePdf } from "./fixtures.js";

const WORKER = new URL("../dist/worker.js", import.meta.url);

let dir: string;
let jobs: FileJob[];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pdf-a11y-pool-"));
  const clean = await makeGoodPdf();
  const broken = await makePdf({ tagged: false });
  jobs = [];
  for (let i = 0; i < 8; i++) {
    const path = join(dir, `f${i}.pdf`);
    await writeFile(path, i % 2 === 0 ? clean : broken);
    jobs.push({ path, file: `f${i}.pdf` });
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("worker pool", () => {
  it("returns results in the order the files were given", async () => {
    const reports = await checkFiles(jobs, { concurrency: 4, base: {}, workerUrl: WORKER });
    expect(reports.map((r) => r.file)).toEqual(jobs.map((j) => j.file));
  });

  it("agrees with the single threaded path", async () => {
    const parallel = await checkFiles(jobs, { concurrency: 4, base: {}, workerUrl: WORKER });
    const serial = await checkFiles(jobs, { concurrency: 1, base: {} });
    expect(parallel.map((r) => r.errorCount)).toEqual(serial.map((r) => r.errorCount));
    expect(parallel.map((r) => r.issues.map((i) => i.check))).toEqual(
      serial.map((r) => r.issues.map((i) => i.check)),
    );
  });

  it("passes the profile through to the workers", async () => {
    const reports = await checkFiles(jobs, {
      concurrency: 4,
      base: { profile: "pdf-ua" },
      workerUrl: WORKER,
    });
    expect(reports[1]?.issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("falls back to this thread when the worker cannot start", async () => {
    const reports = await checkFiles(jobs, {
      concurrency: 4,
      base: {},
      workerUrl: new URL("./nowhere-at-all.js", WORKER),
    });
    expect(reports).toHaveLength(jobs.length);
    expect(reports.map((r) => r.file)).toEqual(jobs.map((j) => j.file));
    expect(reports[0]?.issues).toEqual([]);
  });

  it("stays on this thread for a handful of files", async () => {
    const few = jobs.slice(0, WORKER_THRESHOLD - 1);
    const reports = await checkFiles(few, { concurrency: 8, base: {}, workerUrl: WORKER });
    expect(reports).toHaveLength(few.length);
  });

  it("handles an empty list", async () => {
    expect(await checkFiles([], { concurrency: 4, base: {} })).toEqual([]);
  });

  it("reports an unreadable file rather than failing the run", async () => {
    const bad = join(dir, "bad.pdf");
    await writeFile(bad, "not a pdf at all");
    const reports = await checkFiles([...jobs, { path: bad, file: "bad.pdf" }], {
      concurrency: 4,
      base: {},
      workerUrl: WORKER,
    });
    expect(reports[reports.length - 1]?.readError).toBeDefined();
  });
});
