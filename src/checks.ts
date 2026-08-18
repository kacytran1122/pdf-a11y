import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  StructNode,
  asArray,
  asBool,
  asName,
  asText,
  countImages,
  deref,
  flatten,
  get,
  objectKey,
  readStructTree,
} from "./pdf.js";
import type { DocumentFacts, Finding } from "./types.js";

/** Alt text that exists but says nothing useful. */
const PLACEHOLDER_ALT = /^(image|img|picture|photo|graphic|figure|logo|icon|untitled|placeholder|alt|tbd|todo|\d+)$/i;
const FILENAME_ALT = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?)$/i;

/** Loose BCP 47 shape check. Full validation needs a registry and is out of scope. */
const LANG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const HEADING_PATTERN = /^H([1-6])$/;

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

function describeAlt(node: StructNode): string | null {
  return node.alt ?? node.actualText;
}

export interface Analysis {
  facts: DocumentFacts;
  findings: Finding[];
}

export function analyse(doc: PDFDocument): Analysis {
  const findings: Finding[] = [];
  const pages = doc.getPages();

  // Map each page dictionary back to its 1 based number.
  const pageIndex = new Map<string, number>();
  pages.forEach((page, i) => {
    const key = objectKey(page.node);
    if (key !== null) pageIndex.set(key, i + 1);
  });

  const { root } = readStructTree(doc, pageIndex);
  const all = flatten(root);

  const tags: Record<string, number> = {};
  for (const node of all) tags[node.tag] = (tags[node.tag] ?? 0) + 1;

  const markInfo = get(doc, doc.catalog, "MarkInfo");
  const marked = asBool(get(doc, markInfo, "Marked")) === true;
  const lang = asText(get(doc, doc.catalog, "Lang"));

  const info = deref(doc, doc.context.trailerInfo?.Info);
  const title = asText(get(doc, info, "Title"));

  let images = 0;
  for (const page of pages) images += countImages(doc, page.node);
  const figures = all.filter((n) => n.tag === "Figure").length;

  const facts: DocumentFacts = {
    pages: pages.length,
    marked,
    tagged: all.length > 0,
    lang,
    title,
    images,
    figures,
    tags,
    encrypted: doc.isEncrypted,
  };

  // --- extraction-allowed ------------------------------------------------
  if (doc.isEncrypted) {
    findings.push({
      check: "extraction-allowed",
      message:
        "The file is encrypted. If the permission flags block content extraction, assistive technology cannot read it at all.",
      clause: "PDF/UA 7.1",
    });
  }

  // --- struct-tree --------------------------------------------------------
  if (!facts.tagged) {
    findings.push({
      check: "struct-tree",
      message:
        "No structure tree. A screen reader reads this document as one undifferentiated blob with no headings, lists or tables.",
      clause: "PDF/UA 7.1, WCAG 1.3.1",
    });
  }

  // --- marked-content ------------------------------------------------------
  if (!marked) {
    findings.push({
      check: "marked-content",
      message: "MarkInfo/Marked is not set to true, so the document does not declare itself as tagged.",
      clause: "PDF/UA 7.1",
    });
  }

  // --- document-lang --------------------------------------------------------
  if (isBlank(lang)) {
    findings.push({
      check: "document-lang",
      message:
        "No document language is set. A screen reader will fall back to its own language and mispronounce the text.",
      clause: "WCAG 3.1.1",
    });
  } else if (!LANG_PATTERN.test(lang!.trim())) {
    findings.push({
      check: "document-lang",
      message: `Document language "${lang}" is not a well formed language tag. Use a value such as "en-GB" or "vi".`,
      clause: "WCAG 3.1.1",
      detail: lang ?? undefined,
    });
  }

  // --- document-title --------------------------------------------------------
  const viewerPrefs = get(doc, doc.catalog, "ViewerPreferences");
  const displayDocTitle = asBool(get(doc, viewerPrefs, "DisplayDocTitle"));
  if (isBlank(title)) {
    findings.push({
      check: "document-title",
      message:
        "No document title. Assistive technology announces the file name instead, which is usually a generated string.",
      clause: "WCAG 2.4.2",
    });
  } else if (displayDocTitle !== true) {
    findings.push({
      check: "document-title",
      message:
        "A title is set but ViewerPreferences/DisplayDocTitle is not true, so readers still announce the file name.",
      clause: "PDF/UA 7.1, WCAG 2.4.2",
    });
  }

  // --- figure-alt ---------------------------------------------------------------
  for (const node of all) {
    if (node.tag !== "Figure") continue;
    const alt = describeAlt(node);
    if (isBlank(alt)) {
      findings.push({
        check: "figure-alt",
        message: "A Figure has no alt text. Add /Alt, or mark it as decorative with an Artifact.",
        clause: "PDF/UA 7.3, WCAG 1.1.1",
        page: node.page ?? undefined,
      });
      continue;
    }
    const trimmed = alt!.trim();
    if (PLACEHOLDER_ALT.test(trimmed) || FILENAME_ALT.test(trimmed)) {
      findings.push({
        check: "figure-alt",
        message: `Figure alt text "${trimmed}" describes nothing. Say what the image shows, not what it is.`,
        clause: "WCAG 1.1.1",
        page: node.page ?? undefined,
        detail: trimmed,
      });
    }
  }

  // --- untagged-image -------------------------------------------------------------
  if (images > figures) {
    findings.push({
      check: "untagged-image",
      message: `${images} image${images === 1 ? "" : "s"} on the pages but only ${figures} tagged Figure${figures === 1 ? "" : "s"}. Untagged images are invisible to a screen reader.`,
      clause: "PDF/UA 7.3, WCAG 1.1.1",
    });
  }

  // --- table-headers ---------------------------------------------------------------
  for (const node of all) {
    if (node.tag !== "Table") continue;
    const inside = flatten(node.children);
    const headers = inside.filter((n) => n.tag === "TH").length;
    const cells = inside.filter((n) => n.tag === "TD").length;
    if (headers === 0 && cells > 0) {
      findings.push({
        check: "table-headers",
        message: `A table with ${cells} cells has no TH header cells, so a screen reader cannot tell the user which column a value belongs to.`,
        clause: "PDF/UA 7.5, WCAG 1.3.1",
        page: node.page ?? undefined,
      });
    }
  }

  // --- heading-order -----------------------------------------------------------------
  let previousLevel = 0;
  for (const node of all) {
    const match = HEADING_PATTERN.exec(node.tag);
    if (!match) continue;
    const level = Number(match[1]);
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

  // --- annotations: link-alt, form-field-label, tab-order --------------------------------
  pages.forEach((page, i) => {
    const pageNumber = i + 1;
    const annots = asArray(get(doc, page.node, "Annots"));
    let interactive = 0;

    for (const entry of annots) {
      const annot = deref(doc, entry);
      if (!annot || !(annot instanceof PDFDict)) continue;
      const subtype = asName(get(doc, annot, "Subtype"));
      if (subtype === "Popup") continue;
      interactive++;

      if (subtype === "Link") {
        const contents = asText(get(doc, annot, "Contents"));
        if (isBlank(contents)) {
          findings.push({
            check: "link-alt",
            message: "A link annotation has no /Contents description, so it is announced with no purpose.",
            clause: "PDF/UA 7.18.5, WCAG 2.4.4",
            page: pageNumber,
          });
        }
      }

      if (subtype === "Widget") {
        const tooltip = asText(get(doc, annot, "TU"));
        if (isBlank(tooltip)) {
          const name = asText(get(doc, annot, "T"));
          findings.push({
            check: "form-field-label",
            message: `A form field${name ? ` (${name})` : ""} has no /TU tooltip, which is its accessible name.`,
            clause: "PDF/UA 7.18.4, WCAG 1.3.1",
            page: pageNumber,
            detail: name ?? undefined,
          });
        }
      }
    }

    if (interactive > 0) {
      const tabs = asName(get(doc, page.node, "Tabs"));
      if (tabs !== "S") {
        findings.push({
          check: "tab-order",
          message:
            "The page has annotations but no /Tabs /S, so keyboard tab order follows the raw annotation array rather than the reading order.",
          clause: "PDF/UA 7.18.3, WCAG 2.4.3",
          page: pageNumber,
        });
      }
    }
  });

  void PDFName;
  return { facts, findings };
}
