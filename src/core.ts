import { PDFDocument } from "pdf-lib";
import { analyse } from "./checks.js";
import type {
  CheckId,
  CheckOptions,
  DocumentFacts,
  Issue,
  ProfileName,
  Report,
  Severity,
} from "./types.js";

export type {
  CheckId,
  CheckOptions,
  DocumentFacts,
  Issue,
  ProfileName,
  Report,
  Severity,
} from "./types.js";

export const CHECK_IDS: CheckId[] = [
  "struct-tree",
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
];

export const profiles: Record<ProfileName, Record<CheckId, Severity>> = {
  /** What a team can reasonably fix this sprint. */
  recommended: {
    "struct-tree": "error",
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

const emptyFacts: DocumentFacts = {
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

/** Checks a PDF held in memory. */
export async function checkPdf(
  bytes: Uint8Array | ArrayBuffer,
  options: CheckOptions = {},
): Promise<Report> {
  const file = options.file ?? "input.pdf";
  const severities: Record<CheckId, Severity> = {
    ...profiles[options.profile ?? "recommended"],
    ...(options.checks ?? {}),
  };

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (error) {
    return {
      file,
      issues: [],
      errorCount: 0,
      warningCount: 0,
      facts: emptyFacts,
      readError: error instanceof Error ? error.message : String(error),
    };
  }

  const { facts, findings } = analyse(doc);

  const issues: Issue[] = [];
  for (const finding of findings) {
    const severity = severities[finding.check];
    if (severity === "off") continue;
    issues.push({
      check: finding.check,
      severity: severity === "warn" ? "warn" : "error",
      message: finding.message,
      clause: finding.clause,
      page: finding.page,
      detail: finding.detail,
    });
  }

  issues.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.check.localeCompare(b.check));

  return {
    file,
    issues,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warn").length,
    facts,
  };
}
