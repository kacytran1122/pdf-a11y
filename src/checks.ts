import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  DEFAULT_LIMITS,
  Names as N,
  type StructNode,
  type StructTree,
  asArray,
  asBool,
  asName,
  asNumber,
  asText,
  countPageImages,
  deref,
  get,
  readPermissions,
  readStructTree,
  readXmpTitle,
} from "./pdf.js";
import { quote } from "./text.js";
import type { CheckLimits, DocumentFacts, Finding } from "./types.js";

/** Alt text that exists but says nothing useful. */
const PLACEHOLDER_ALT =
  /^(image|img|picture|photo|graphic|figure|chart|diagram|untitled|placeholder|alt|tbd|todo|none|n\/a|\d+)$/i;
const FILENAME_ALT = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?)$/i;

/** Loose BCP 47 shape check. Full validation needs a registry and is out of scope. */
const LANG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
/** Longest `/Lang` value worth testing. Anything longer is not a language tag. */
const MAX_LANG_LENGTH = 64;

/** `H1` through `H9`. PDF/UA also allows a plain `H`, which carries no level. */
const HEADING_PATTERN = /^H([1-9])$/;

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

function describeAlt(node: StructNode): string | null {
  return node.alt ?? node.actualText;
}

export interface Analysis {
  facts: DocumentFacts;
  findings: Finding[];
  /** Things this run could not determine, in plain words. */
  limitations: string[];
}

export function analyse(doc: PDFDocument, limits: CheckLimits = DEFAULT_LIMITS): Analysis {
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const pages = doc.getPages();

  // Pages are identified by their reference, never by their contents: two
  // pages can serialise identically, and a content based key would then report
  // every issue against the wrong page.
  const pageIndex = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    pageIndex.set(pages[i]!.ref.tag, i + 1);
  }

  const tree = readStructTree(doc, pageIndex, limits);
  if (tree.truncated) {
    limitations.push(
      `The structure tree was larger than the configured limit (${limits.maxNodes} elements, depth ${limits.maxDepth}) and was only read in part.`,
    );
  }

  const encrypted = doc.isEncrypted;
  // pdf-lib reads encrypted files without decrypting them, so every string in
  // an encrypted document is ciphertext. Presence of a value is still known;
  // its contents are not, so checks that judge a value are skipped.
  const textIsReadable = !encrypted;
  if (encrypted) {
    limitations.push(
      "The file is encrypted, so text values such as the title, language and alt text could not be decoded. Only their presence was checked.",
    );
  }

  const structure = readStructure(tree, textIsReadable, findings);

  const info = deref(doc, doc.context.trailerInfo.Info);
  const infoTitle = asText(get(doc, info, N.Title));

  const imageMemo = new Map<PDFDict, number>();
  let images = 0;
  for (const page of pages) {
    images += countPageImages(doc, page.node.Resources(), imageMemo);
  }

  const facts: DocumentFacts = {
    pages: pages.length,
    marked: asBool(get(doc, get(doc, doc.catalog, N.MarkInfo), N.Marked)) === true,
    tagged: tree.nodes.length > 0,
    lang: asText(get(doc, doc.catalog, N.Lang)),
    title: isBlank(infoTitle) ? readXmpTitle(doc) : infoTitle,
    images,
    figures: structure.figures,
    tags: Object.fromEntries(structure.tagCounts),
    encrypted,
  };

  documentFindings(doc, facts, tree, textIsReadable, findings);
  annotations(doc, pages, findings);

  return { facts, findings, limitations };
}

interface StructureSummary {
  tagCounts: Map<string, number>;
  figures: number;
}

/**
 * One pass over the flattened tree, in document order. Every per element check
 * runs here so the tree is walked once rather than once per check.
 */
function readStructure(tree: StructTree, textIsReadable: boolean, findings: Finding[]): StructureSummary {
  const { nodes, ends } = tree;
  const tagCounts = new Map<string, number>();
  let figures = 0;
  let previousLevel = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    tagCounts.set(node.tag, (tagCounts.get(node.tag) ?? 0) + 1);

    if (node.tag === "Figure") {
      figures++;
      figureAlt(node, textIsReadable, findings);
    } else if (node.tag === "Table") {
      tableHeaders(nodes, ends, i, findings);
    }

    const heading = HEADING_PATTERN.exec(node.tag);
    if (heading === null) continue;
    const level = Number(heading[1]);
    if (previousLevel === 0 && level !== 1) {
      findings.push({
        check: "heading-order",
        message: `The first heading is ${node.tag}. Documents should start at H1.`,
        clause: "WCAG 1.3.1",
        page: node.page ?? undefined,
      });
    } else if (level > previousLevel + 1) {
      findings.push({
        check: "heading-order",
        message: `Heading level jumps from H${previousLevel} to ${node.tag}. Do not skip levels.`,
        clause: "WCAG 1.3.1",
        page: node.page ?? undefined,
      });
    }
    previousLevel = level;
  }

  return { tagCounts, figures };
}

/** Checks that look at the document as a whole rather than at one element. */
function documentFindings(
  doc: PDFDocument,
  facts: DocumentFacts,
  tree: StructTree,
  textIsReadable: boolean,
  findings: Finding[],
): void {
  if (facts.encrypted) extractionAllowed(doc, findings);

  if (!facts.tagged) {
    findings.push({
      check: "struct-tree",
      message:
        "No structure tree. A screen reader reads this document as one undifferentiated blob with no headings, lists or tables.",
      clause: "PDF/UA 7.1, WCAG 1.3.1",
    });
  }

  if (!facts.marked) {
    findings.push({
      check: "marked-content",
      message: "MarkInfo/Marked is not set to true, so the document does not declare itself as tagged.",
      clause: "PDF/UA 7.1",
    });
  }
  if (asBool(get(doc, get(doc, doc.catalog, N.MarkInfo), N.Suspects)) === true) {
    findings.push({
      check: "marked-content",
      message:
        "MarkInfo/Suspects is true, which is the producer saying its own tagging may not match the visible content.",
      clause: "PDF/UA 7.1",
    });
  }

  if (facts.tagged && !tree.hasParentTree) {
    findings.push({
      check: "parent-tree",
      message:
        "The structure tree has no /ParentTree, so a reader cannot map page content back to the tags that describe it.",
      clause: "PDF/UA 7.1",
    });
  }

  documentLang(facts.lang, textIsReadable, findings);
  documentTitle(doc, facts.title, findings);

  if (facts.images > facts.figures) {
    const { images, figures } = facts;
    findings.push({
      check: "untagged-image",
      message: `${images} image${images === 1 ? "" : "s"} on the pages but only ${figures} tagged Figure${figures === 1 ? "" : "s"}. Untagged images are invisible to a screen reader unless they are marked as artifacts.`,
      clause: "PDF/UA 7.3, WCAG 1.1.1",
    });
  }
}

function extractionAllowed(doc: PDFDocument, findings: Finding[]): void {
  const permissions = readPermissions(doc);
  if (permissions === null || permissions.extractionAllowed === null) {
    findings.push({
      check: "extraction-allowed",
      message:
        "The file is encrypted and its permission flags could not be read. If they block content extraction, assistive technology cannot read it at all.",
      clause: "PDF/UA 7.1",
    });
  } else if (!permissions.extractionAllowed) {
    findings.push({
      check: "extraction-allowed",
      message:
        "The encryption permission flags block content extraction, so assistive technology cannot read this document.",
      clause: "PDF/UA 7.1, WCAG 4.1.2",
      detail: `P=${permissions.raw}`,
    });
  }
}

function documentLang(lang: string | null, textIsReadable: boolean, findings: Finding[]): void {
  if (isBlank(lang)) {
    findings.push({
      check: "document-lang",
      message:
        "No document language is set. A screen reader will fall back to its own language and mispronounce the text.",
      clause: "WCAG 3.1.1",
    });
    return;
  }
  if (!textIsReadable) return;

  const trimmed = lang!.trim();
  if (trimmed.length > MAX_LANG_LENGTH || !LANG_PATTERN.test(trimmed)) {
    const shown = quote(trimmed, 32);
    findings.push({
      check: "document-lang",
      message: `Document language "${shown}" is not a well formed language tag. Use a value such as "en-GB" or "vi".`,
      clause: "WCAG 3.1.1",
      detail: shown,
    });
  }
}

function documentTitle(doc: PDFDocument, title: string | null, findings: Finding[]): void {
  if (isBlank(title)) {
    findings.push({
      check: "document-title",
      message:
        "No document title. Assistive technology announces the file name instead, which is usually a generated string.",
      clause: "WCAG 2.4.2",
    });
    return;
  }
  const viewerPrefs = get(doc, doc.catalog, N.ViewerPreferences);
  if (asBool(get(doc, viewerPrefs, N.DisplayDocTitle)) !== true) {
    findings.push({
      check: "document-title",
      message:
        "A title is set but ViewerPreferences/DisplayDocTitle is not true, so readers still announce the file name.",
      clause: "PDF/UA 7.1, WCAG 2.4.2",
    });
  }
}

function figureAlt(node: StructNode, textIsReadable: boolean, findings: Finding[]): void {
  const alt = describeAlt(node);
  if (isBlank(alt)) {
    findings.push({
      check: "figure-alt",
      message: "A Figure has no alt text. Add /Alt, or mark it as decorative with an Artifact.",
      clause: "PDF/UA 7.3, WCAG 1.1.1",
      page: node.page ?? undefined,
    });
    return;
  }
  if (!textIsReadable) return;

  const trimmed = alt!.trim();
  if (PLACEHOLDER_ALT.test(trimmed) || FILENAME_ALT.test(trimmed)) {
    const shown = quote(trimmed);
    findings.push({
      check: "figure-alt",
      message: `Figure alt text "${shown}" describes nothing. Say what the image shows, not what it is.`,
      clause: "WCAG 1.1.1",
      page: node.page ?? undefined,
      detail: shown,
    });
  }
}

/**
 * Header cells for one table, ignoring any table nested inside it.
 *
 * Walking the whole subtree would let an inner table's headers excuse the outer
 * table, and would cost O(depth * elements) across a nested document. `ends`
 * makes each nested table a single skip, so the total stays linear.
 */
function tableHeaders(nodes: StructNode[], ends: Int32Array, index: number, findings: Finding[]): void {
  const stop = ends[index] ?? nodes.length;
  let headers = 0;
  let cells = 0;

  for (let j = index + 1; j < stop;) {
    const child = nodes[j]!;
    if (child.tag === "Table") {
      j = Math.max(ends[j] ?? j + 1, j + 1);
      continue;
    }
    if (child.tag === "TH") headers++;
    else if (child.tag === "TD") cells++;
    j++;
  }

  if (headers === 0 && cells > 0) {
    const node = nodes[index]!;
    findings.push({
      check: "table-headers",
      message: `A table with ${cells} cells has no TH header cells, so a screen reader cannot tell the user which column a value belongs to.`,
      clause: "PDF/UA 7.5, WCAG 1.3.1",
      page: node.page ?? undefined,
    });
  }
}

// Annotation flags, ISO 32000-1 table 165. A hidden annotation is not on the
// page as far as a reader is concerned, so it needs neither an accessible name
// nor a tab stop, and reporting one is a false positive.
const FLAG_HIDDEN = 1 << 1;
const FLAG_NO_VIEW = 1 << 5;

function isVisible(doc: PDFDocument, annot: PDFDict): boolean {
  const flags = asNumber(deref(doc, annot.get(N.F)));
  if (flags === null) return true;
  return ((flags | 0) & (FLAG_HIDDEN | FLAG_NO_VIEW)) === 0;
}

/**
 * Reads a form field entry, following `/Parent` up the field hierarchy.
 *
 * A widget is often only the visual half of a field: the tooltip and the name
 * live on the field it belongs to. Reading the widget alone reports every
 * grouped field as unlabelled.
 */
function fieldEntry(doc: PDFDocument, annot: PDFDict, key: PDFName): string | null {
  let node: PDFDict = annot;
  // Bounded rather than cycle tracked: field hierarchies are two or three deep,
  // and a damaged file must not be able to loop here.
  for (let hop = 0; hop < 32; hop++) {
    const value = asText(deref(doc, node.get(key)));
    if (value !== null) return value;
    const parent = deref(doc, node.get(N.Parent));
    if (!(parent instanceof PDFDict) || parent === node) return null;
    node = parent;
  }
  return null;
}

function annotations(
  doc: PDFDocument,
  pages: ReturnType<PDFDocument["getPages"]>,
  findings: Finding[],
): void {
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const annots = asArray(get(doc, pages[i]!.node, N.Annots));
    let interactive = 0;

    for (const entry of annots) {
      const annot = deref(doc, entry);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = asName(deref(doc, annot.get(N.Subtype)));
      // Popups belong to another annotation and are never tabbed to.
      if (subtype === "Popup") continue;
      if (!isVisible(doc, annot)) continue;
      interactive++;

      if (subtype === "Link" && isBlank(asText(deref(doc, annot.get(N.Contents))))) {
        findings.push({
          check: "link-alt",
          message: "A link annotation has no /Contents description, so it is announced with no purpose.",
          clause: "PDF/UA 7.18.5, WCAG 2.4.4",
          page: pageNumber,
        });
      }

      if (subtype === "Widget" && isBlank(fieldEntry(doc, annot, N.TU))) {
        const name = fieldEntry(doc, annot, N.T);
        const shown = name === null ? null : quote(name, 40);
        findings.push({
          check: "form-field-label",
          message: `A form field${shown ? ` (${shown})` : ""} has no /TU tooltip, which is its accessible name.`,
          clause: "PDF/UA 7.18.4, WCAG 1.3.1",
          page: pageNumber,
          detail: shown ?? undefined,
        });
      }
    }

    if (interactive > 0 && asName(get(doc, pages[i]!.node, N.Tabs)) !== "S") {
      findings.push({
        check: "tab-order",
        message:
          "The page has annotations but no /Tabs /S, so keyboard tab order follows the raw annotation array rather than the reading order.",
        clause: "PDF/UA 7.18.3, WCAG 2.4.3",
        page: pageNumber,
      });
    }
  }
}
