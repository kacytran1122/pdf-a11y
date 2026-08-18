import { PDFDocument } from "pdf-lib";
import { analyse } from "./checks.js";
import { DEFAULT_LIMITS } from "./pdf.js";
import { unreadable } from "./report.js";
import type { CheckId, CheckLimits, CheckOptions, Issue, ProfileName, Report, Severity } from "./types.js";

export type {
  CheckId,
  CheckLimits,
  CheckOptions,
  DocumentFacts,
  Issue,
  ProfileName,
  Report,
  Severity,
} from "./types.js";

export const CHECK_IDS: readonly CheckId[] = Object.freeze([
  "struct-tree",
  "parent-tree",
  "marked-content",
  "document-lang",
  "document-title",
  "figure-alt",
  "untagged-image",
  "table-headers",
  "heading-order",
  "link-alt",
  "form-field-label",
  "extraction-allowed",
  "tab-order",
] as CheckId[]);

export const profiles: Record<ProfileName, Record<CheckId, Severity>> = {
  /** What a team can reasonably fix this sprint. */
  recommended: {
    "struct-tree": "error",
    "parent-tree": "warn",
    "marked-content": "warn",
    "document-lang": "error",
    "document-title": "warn",
    "figure-alt": "error",
    "untagged-image": "warn",
    "table-headers": "error",
    "heading-order": "warn",
    "link-alt": "warn",
    "form-field-label": "error",
    "extraction-allowed": "warn",
    "tab-order": "warn",
  },
  /** Everything PDF/UA treats as a requirement. */
  "pdf-ua": {
    "struct-tree": "error",
    "parent-tree": "error",
    "marked-content": "error",
    "document-lang": "error",
    "document-title": "error",
    "figure-alt": "error",
    "untagged-image": "error",
    "table-headers": "error",
    "heading-order": "error",
    "link-alt": "error",
    "form-field-label": "error",
    "extraction-allowed": "error",
    "tab-order": "error",
  },
};

/** Anything unusable falls back to the default, including values from JavaScript
 * callers that the type system never saw. */
function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function resolveLimits(limits: Partial<CheckLimits> | undefined): CheckLimits {
  if (!limits) return DEFAULT_LIMITS;
  return {
    maxNodes: positive(limits.maxNodes, DEFAULT_LIMITS.maxNodes),
    maxDepth: positive(limits.maxDepth, DEFAULT_LIMITS.maxDepth),
  };
}

/**
 * The PDF parser writes complaints about damaged files straight to the console.
 * A library has no business doing that, so the console is borrowed for the
 * duration of the parse.
 *
 * Only the parser's own messages are intercepted, matched against what it
 * actually emits. Anything else logged while a parse happens to be in flight
 * belongs to the surrounding application and is passed through untouched.
 */
const PARSER_NOISE = /^(Trying to parse invalid object|Invalid object ref|Removing parsed object)/;

let borrowDepth = 0;
let originalWarn: typeof console.warn | null = null;
const sinks = new Set<(message: string) => void>();

function borrowConsole(sink: ((message: string) => void) | undefined): () => void {
  if (sink) sinks.add(sink);
  if (borrowDepth === 0) {
    const previous = console.warn;
    originalWarn = previous;
    console.warn = (...args: unknown[]) => {
      const message = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
      if (!PARSER_NOISE.test(message)) {
        previous(...args);
        return;
      }
      for (const listener of sinks) listener(message);
    };
  }
  borrowDepth++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (sink) sinks.delete(sink);
    borrowDepth--;
    if (borrowDepth === 0 && originalWarn !== null) {
      console.warn = originalWarn;
      originalWarn = null;
    }
  };
}

/**
 * Checks a PDF held in memory.
 *
 * Never throws: a file that cannot be parsed, or that defeats the reader in
 * some other way, comes back as a report with `readError` set.
 */
export async function checkPdf(bytes: Uint8Array | ArrayBuffer, options: CheckOptions = {}): Promise<Report> {
  const file = options.file ?? "input.pdf";
  // An unrecognised profile name falls back rather than silently turning every
  // check off, which is what spreading `undefined` would have done.
  const profile =
    options.profile !== undefined && options.profile in profiles ? options.profile : "recommended";
  const severities: Partial<Record<CheckId, Severity>> = {
    ...profiles[profile],
    ...(options.checks ?? {}),
  };

  // The borrow covers the analysis as well as the parse: pdf-lib resolves some
  // objects lazily, so its complaints do not all arrive during load().
  const restore = borrowConsole(options.onParserWarning);
  let analysis;
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    analysis = analyse(doc, resolveLimits(options.limits));
  } catch (error) {
    // Either the file could not be parsed, or a structurally valid one broke
    // the reader. Callers asked for a report, not an exception.
    return unreadable(file, error instanceof Error ? error.message : String(error));
  } finally {
    restore();
  }

  const issues: Issue[] = [];
  for (const finding of analysis.findings) {
    const severity = severities[finding.check];
    if (severity === "off" || severity === undefined) continue;
    issues.push({
      check: finding.check,
      severity: severity === "warn" ? "warn" : "error",
      message: finding.message,
      clause: finding.clause,
      page: finding.page,
      detail: finding.detail,
    });
  }

  issues.sort(byPageThenCheck);

  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errorCount++;
    else warningCount++;
  }

  return {
    file,
    issues,
    errorCount,
    warningCount,
    facts: analysis.facts,
    limitations: analysis.limitations,
  };
}

/**
 * Document order first, then errors before warnings, then a stable order by
 * check id. Sorting on the check id alone buried `struct-tree`, the finding
 * that matters most, underneath the warnings.
 */
const RANK: Record<Issue["severity"], number> = { error: 0, warn: 1 };

function byPageThenCheck(a: Issue, b: Issue): number {
  return (
    (a.page ?? 0) - (b.page ?? 0) ||
    RANK[a.severity] - RANK[b.severity] ||
    (a.check < b.check ? -1 : a.check > b.check ? 1 : 0)
  );
}
