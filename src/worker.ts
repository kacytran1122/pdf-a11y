import { parentPort } from "node:worker_threads";
import { checkFile } from "./index.js";
import type { CheckOptions } from "./types.js";

export interface WorkerJob {
  path: string;
  file: string;
  options: CheckOptions;
}

const port = parentPort;
if (port === null) {
  throw new Error("pdf-a11y/worker must be started as a worker thread.");
}

port.on("message", (job: WorkerJob) => {
  checkFile(job.path, { ...job.options, file: job.file })
    .then((report) => {
      port.postMessage({ report });
    })
    .catch((error: unknown) => {
      port.postMessage({ error: error instanceof Error ? error.message : String(error) });
    });
});
