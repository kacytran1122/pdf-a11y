import { Worker } from "node:worker_threads";
import { checkFile } from "./index.js";
import type { CheckOptions, Report } from "./types.js";

export interface FileJob {
  /** Path to open. */
  path: string;
  /** Name to show in the report. */
  file: string;
}

export interface RunOptions {
  /** Workers to run at once. 1 keeps everything on the main thread. */
  concurrency: number;
  /** Profile, overrides and limits, passed to every file. */
  base: CheckOptions;
  /** Overridable so the pool can be tested against a built worker. */
  workerUrl?: URL;
}

/**
 * Parsing a PDF is synchronous CPU work, so running files "concurrently" on one
 * thread buys nothing. Below this many files the cost of starting threads is
 * larger than the parse they would overlap.
 */
export const WORKER_THRESHOLD = 4;

export async function checkFiles(jobs: readonly FileJob[], options: RunOptions): Promise<Report[]> {
  const results = new Array<Report>(jobs.length);
  let next = 0;
  const take = (): { job: FileJob; index: number } | null => {
    if (next >= jobs.length) return null;
    const index = next++;
    return { job: jobs[index]!, index };
  };

  const here = async (job: FileJob, index: number): Promise<void> => {
    results[index] = await checkFile(job.path, { ...options.base, file: job.file });
  };

  const threads = Math.min(Math.max(1, options.concurrency), jobs.length);
  if (threads <= 1 || jobs.length < WORKER_THRESHOLD) {
    for (let item = take(); item !== null; item = take()) await here(item.job, item.index);
    return results;
  }

  const url = options.workerUrl ?? new URL("./worker.js", import.meta.url);
  const started: Worker[] = [];

  // Each driver owns one worker and pulls the next file whenever it is free, so
  // a slow file does not leave the other threads idle. A worker that dies takes
  // its driver back to the main thread rather than losing the file.
  const drive = async (): Promise<void> => {
    let worker: Worker | null;
    try {
      worker = new Worker(url);
      started.push(worker);
    } catch {
      worker = null;
    }

    for (let item = take(); item !== null; item = take()) {
      if (worker === null) {
        await here(item.job, item.index);
        continue;
      }
      try {
        results[item.index] = await runOn(worker, item.job, options.base);
      } catch {
        void worker.terminate().catch(() => {});
        worker = null;
        await here(item.job, item.index);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: threads }, drive));
  } finally {
    await Promise.all(started.map((worker) => worker.terminate().catch(() => {})));
  }
  return results;
}

function runOn(worker: Worker, job: FileJob, base: CheckOptions): Promise<Report> {
  return new Promise<Report>((resolve, reject) => {
    const done = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    const onMessage = (message: { report?: Report; error?: string }) => {
      done();
      if (message.report !== undefined) resolve(message.report);
      else reject(new Error(message.error ?? "worker returned nothing"));
    };
    const onError = (error: Error) => {
      done();
      reject(error);
    };
    const onExit = (code: number) => {
      done();
      reject(new Error(`worker exited with code ${code}`));
    };

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    // Functions do not survive structured cloning, so callbacks are dropped.
    const cloneable: CheckOptions = { ...base };
    delete cloneable.onParserWarning;
    worker.postMessage({ path: job.path, file: job.file, options: cloneable });
  });
}
