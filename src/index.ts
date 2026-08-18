import { open } from "node:fs/promises";
import { checkPdf } from "./core.js";
import { unreadable } from "./report.js";
import type { CheckOptions, Report } from "./types.js";

export * from "./core.js";

/**
 * Largest file read into memory by default. A PDF above this is almost
 * certainly not something a service generated, and reading it would cost more
 * memory than the process is likely to have.
 */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

export interface CheckFileOptions extends CheckOptions {
  /** Overrides {@link MAX_FILE_BYTES}. Set to `Infinity` to remove the cap. */
  maxBytes?: number;
}

/**
 * Checks a PDF on disk. Node only. In a browser import `pdf-a11y/browser`.
 *
 * Never throws: a missing, unreadable or oversized file comes back as a report
 * with `readError` set.
 */
export async function checkFile(path: string, options: CheckFileOptions = {}): Promise<Report> {
  const name = options.file ?? path;
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;

  // One handle for the size check and the read: it is one syscall fewer than
  // stat-then-read, and it cannot be swapped for something else in between.
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    return unreadable(name, error instanceof Error ? error.message : String(error));
  }

  try {
    const info = await handle.stat();
    if (!info.isFile()) return unreadable(name, "Not a regular file.");
    if (Number.isFinite(maxBytes) && info.size > maxBytes) {
      return unreadable(name, `File is ${info.size} bytes, above the ${maxBytes} byte limit.`);
    }
    const bytes = await handle.readFile();
    return await checkPdf(bytes, { ...options, file: name });
  } catch (error) {
    return unreadable(name, error instanceof Error ? error.message : String(error));
  } finally {
    await handle.close().catch(() => {});
  }
}
