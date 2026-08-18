import type { DocumentFacts, Report } from "./types.js";

/** A fresh facts object. Never shared, so no caller can mutate the defaults. */
export function emptyFacts(): DocumentFacts {
  return {
    pages: 0,
    marked: false,
    tagged: false,
    lang: null,
    title: null,
    images: 0,
    figures: 0,
    tags: {},
    encrypted: false,
  };
}

/** The report for a file that could not be read or parsed at all. */
export function unreadable(file: string, readError: string): Report {
  return {
    file,
    issues: [],
    errorCount: 0,
    warningCount: 0,
    facts: emptyFacts(),
    limitations: [],
    readError,
  };
}
