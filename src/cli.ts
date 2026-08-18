#!/usr/bin/env node
import { run } from "./cli-core.js";

// `process.exitCode` rather than `process.exit`: stdout is asynchronous when it
// is a pipe or a file, and exiting outright truncates whatever is still buffered.
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 2;
  },
);
