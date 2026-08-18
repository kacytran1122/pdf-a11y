export type Severity = "off" | "warn" | "error";

export type CheckId =
  | "marked-content"
  | "struct-tree"
  | "parent-tree"
  | "document-lang"
  | "document-title"
  | "figure-alt"
  | "untagged-image"
  | "table-headers"
  | "heading-order"
  | "link-alt"
  | "form-field-label"
  | "extraction-allowed"
  | "tab-order";

export interface Issue {
  check: CheckId;
  severity: "warn" | "error";
  message: string;
  /** Matching clause in PDF/UA (ISO 14289-1) or WCAG, when there is one. */
  clause?: string;
  /** 1 based page number, when the issue belongs to a page. */
  page?: number;
  /** Extra context, for example the structure tag that failed. */
  detail?: string;
}

export interface DocumentFacts {
  pages: number;
  /** /MarkInfo /Marked is true. */
  marked: boolean;
  /** A non empty structure tree is present. */
  tagged: boolean;
  /**
   * Catalog /Lang, when set. Taken from the file verbatim, so treat it as
   * untrusted input if you render it.
   */
  lang: string | null;
  /**
   * Document title, from the info dictionary or from XMP `dc:title`.
   * Verbatim from the file, so treat it as untrusted input if you render it.
   */
  title: string | null;
  /** Number of image XObjects found across all pages. */
  images: number;
  /** Number of Figure elements in the structure tree. */
  figures: number;
  /** Structure tags found, with counts. */
  tags: Record<string, number>;
  encrypted: boolean;
}

export interface Report {
  file: string;
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  facts: DocumentFacts;
  /**
   * What this run could not determine, for example because the file is
   * encrypted. Always present; empty when the whole document was readable.
   */
  limitations?: string[];
  /** Set when the file could not be parsed at all. */
  readError?: string;
}

export type ProfileName = "recommended" | "pdf-ua";

/**
 * Bounds on how much of a structure tree is read. They exist so that a
 * malformed or deliberately hostile file cannot exhaust memory or time.
 */
export interface CheckLimits {
  /** Elements read before the walk gives up. */
  maxNodes: number;
  /** Nesting depth read before the walk stops descending. */
  maxDepth: number;
}

export interface CheckOptions {
  file?: string;
  profile?: ProfileName;
  checks?: Partial<Record<CheckId, Severity>>;
  /** Overrides for the traversal bounds. Anything omitted keeps its default. */
  limits?: Partial<CheckLimits>;
  /**
   * Called with warnings the PDF parser produced about a damaged file.
   * Without this they are discarded rather than written to the console.
   * Warnings are captured process wide, so concurrent checks in one process
   * may see each other's; use it for diagnostics, not for attribution.
   */
  onParserWarning?: (message: string) => void;
}

/** Internal: a raw finding before severity is applied. */
export interface Finding {
  check: CheckId;
  message: string;
  clause?: string;
  page?: number;
  detail?: string;
}
