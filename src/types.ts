export type Severity = "off" | "warn" | "error";

export type CheckId =
  | "marked-content"
  | "struct-tree"
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
  /** Catalog /Lang, when set. */
  lang: string | null;
  /** Document title from the info dictionary, when set. */
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
  /** Set when the file could not be parsed at all. */
  readError?: string;
}

export type ProfileName = "recommended" | "pdf-ua";

export interface CheckOptions {
  file?: string;
  profile?: ProfileName;
  checks?: Partial<Record<CheckId, Severity>>;
}

/** Internal: a raw finding before severity is applied. */
export interface Finding {
  check: CheckId;
  message: string;
  clause?: string;
  page?: number;
  detail?: string;
}
