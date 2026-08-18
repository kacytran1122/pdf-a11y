import { readFile } from "node:fs/promises";
import { checkPdf } from "./core.js";
import type { CheckOptions, Report } from "./types.js";

export * from "./core.js";

const emptyReport = (file: string, readError: string): Report => ({
  file,
  issues: [],
  errorCount: 0,
  warningCount: 0,
  facts: {
    pages: 0,
    marked: false,
    tagged: false,
    lang: null,
    title: null,
    images: 0,
    figures: 0,
    tags: {},
    encrypted: false,
  },
  readError,
});

/** Checks a PDF on disk. Node only. In a browser import "pdf-a11y/browser". */
export async function checkFile(path: string, options: CheckOptions = {}): Promise<Report> {
  try {
    const bytes = await readFile(path);
    return await checkPdf(bytes, { ...options, file: options.file ?? path });
  } catch (error) {
    return emptyReport(options.file ?? path, error instanceof Error ? error.message : String(error));
  }
}
