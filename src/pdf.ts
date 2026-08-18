import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import type { CheckLimits } from "./types.js";

/**
 * Anything that can sit in a PDF object graph, including the absence of a
 * value. Callers narrow with the `as*` helpers below rather than casting.
 */
export type PdfValue = PDFObject | null | undefined;

/** Names are looked up constantly, so the objects are created once. */
const N = {
  Alt: PDFName.of("Alt"),
  ActualText: PDFName.of("ActualText"),
  Annots: PDFName.of("Annots"),
  Contents: PDFName.of("Contents"),
  DisplayDocTitle: PDFName.of("DisplayDocTitle"),
  Encrypt: PDFName.of("Encrypt"),
  F: PDFName.of("F"),
  K: PDFName.of("K"),
  Lang: PDFName.of("Lang"),
  MarkInfo: PDFName.of("MarkInfo"),
  Marked: PDFName.of("Marked"),
  Metadata: PDFName.of("Metadata"),
  P: PDFName.of("P"),
  Parent: PDFName.of("Parent"),
  Pg: PDFName.of("Pg"),
  ParentTree: PDFName.of("ParentTree"),
  R: PDFName.of("R"),
  Resources: PDFName.of("Resources"),
  RoleMap: PDFName.of("RoleMap"),
  S: PDFName.of("S"),
  StructTreeRoot: PDFName.of("StructTreeRoot"),
  Subtype: PDFName.of("Subtype"),
  Suspects: PDFName.of("Suspects"),
  T: PDFName.of("T"),
  TU: PDFName.of("TU"),
  Tabs: PDFName.of("Tabs"),
  Title: PDFName.of("Title"),
  Type: PDFName.of("Type"),
  ViewerPreferences: PDFName.of("ViewerPreferences"),
  XObject: PDFName.of("XObject"),
} as const;

export { N as Names };

/** Resolves a reference to the object it points at. Never throws. */
export function deref(doc: PDFDocument, value: PdfValue | PDFRef): PDFObject | null {
  if (value === undefined || value === null) return null;
  try {
    return doc.context.lookup(value) ?? null;
  } catch {
    return null;
  }
}

/** Reads a key off a dictionary and resolves any reference. Never throws. */
export function get(doc: PDFDocument, dict: PdfValue, key: PDFName): PDFObject | null {
  if (!(dict instanceof PDFDict)) return null;
  return deref(doc, dict.get(key));
}

export function asName(value: PdfValue): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

export function asText(value: PdfValue): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try {
      return value.decodeText();
    } catch {
      return null;
    }
  }
  return null;
}

export function asBool(value: PdfValue): boolean | null {
  return value instanceof PDFBool ? value.asBoolean() : null;
}

export function asNumber(value: PdfValue): number | null {
  return value instanceof PDFNumber ? value.asNumber() : null;
}

/** Normalises a `/K` style entry into an array. Copies, so use sparingly. */
export function asArray(value: PdfValue): PDFObject[] {
  if (!value) return [];
  if (value instanceof PDFArray) return value.asArray();
  return [value];
}

/** One element of the structure tree, flattened into document order. */
export interface StructNode {
  /** Standard structure tag, after the role map is applied. */
  tag: string;
  /** Tag exactly as written in the file, before the role map. */
  rawTag: string;
  alt: string | null;
  actualText: string | null;
  lang: string | null;
  /** Number of marked content references directly under this element. */
  contentRefs: number;
  /** 1 based page number, when the element points at one. */
  page: number | null;
  /** Nesting depth, 0 for a child of the structure tree root. */
  depth: number;
}

export interface StructTree {
  /**
   * Every element in document order (pre-order), which is the order a screen
   * reader announces them in.
   */
  nodes: StructNode[];
  /**
   * `ends[i]` is the index just past the last descendant of `nodes[i]`, so a
   * subtree is `nodes.slice(i + 1, ends[i])`. Precomputing this is what keeps
   * the per-element checks linear instead of quadratic on nested structures.
   */
  ends: Int32Array;
  /** True when a limit stopped the walk before the tree was fully read. */
  truncated: boolean;
  /** `/ParentTree` is present, which tagged PDFs need to map content back. */
  hasParentTree: boolean;
}

export const DEFAULT_LIMITS: CheckLimits = { maxNodes: 500_000, maxDepth: 100_000 };

const EMPTY_TREE: StructTree = {
  nodes: [],
  ends: new Int32Array(0),
  truncated: false,
  hasParentTree: false,
};

/** Reads the role map, which lets a file rename standard tags. */
function readRoleMap(doc: PDFDocument, root: PdfValue): Map<string, string> | null {
  const roleMap = get(doc, root, N.RoleMap);
  if (!(roleMap instanceof PDFDict)) return null;
  const map = new Map<string, string>();
  for (const [key, value] of roleMap.entries()) {
    const to = asName(deref(doc, value));
    if (to !== null) map.set(key.decodeText(), to);
  }
  return map.size > 0 ? map : null;
}

/** A position in one element's `/K` list, without copying the list. */
interface Frame {
  array: PDFArray | null;
  single: PDFObject | null;
  length: number;
  index: number;
  depth: number;
  /** Index into `nodes` of the element these kids belong to, -1 for the root. */
  owner: number;
}

function frameFor(kids: PDFObject | null, depth: number, owner: number): Frame | null {
  if (kids === null) return null;
  if (kids instanceof PDFArray) {
    const length = kids.size();
    return length === 0 ? null : { array: kids, single: null, length, index: 0, depth, owner };
  }
  return { array: null, single: kids, length: 1, index: 0, depth, owner };
}

/**
 * Walks the structure tree into a flat, document ordered array.
 *
 * The walk is iterative: a damaged or hostile file can nest elements tens of
 * thousands deep, and a recursive reader dies on that with a stack overflow.
 * Shared and cyclic references are visited once, and `limits` bounds the total
 * work so a crafted file cannot hang the process.
 */
export function readStructTree(
  doc: PDFDocument,
  pageIndex: Map<string, number>,
  limits: CheckLimits = DEFAULT_LIMITS,
): StructTree {
  const structRoot = get(doc, doc.catalog, N.StructTreeRoot);
  if (!(structRoot instanceof PDFDict)) return EMPTY_TREE;

  const hasParentTree = structRoot.get(N.ParentTree) !== undefined;
  const roleMap = readRoleMap(doc, structRoot);

  const rootFrame = frameFor(get(doc, structRoot, N.K), 0, -1);
  if (rootFrame === null) {
    return { nodes: [], ends: new Int32Array(0), truncated: false, hasParentTree };
  }

  const nodes: StructNode[] = [];
  const seen = new Set<PDFObject>();
  const stack: Frame[] = [rootFrame];
  let truncated = false;

  walk: while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.index >= frame.length) {
      stack.pop();
      continue;
    }
    const entry = frame.array === null ? frame.single : frame.array.get(frame.index);
    frame.index++;

    const resolved = deref(doc, entry);
    // A number, a marked content reference or an object reference is page
    // content rather than a child element.
    if (!(resolved instanceof PDFDict)) {
      if (frame.owner >= 0) nodes[frame.owner]!.contentRefs++;
      continue;
    }
    const type = asName(deref(doc, resolved.get(N.Type)));
    if (type === "MCR" || type === "OBJR") {
      if (frame.owner >= 0) nodes[frame.owner]!.contentRefs++;
      continue;
    }
    const rawTag = asName(deref(doc, resolved.get(N.S)));
    if (rawTag === null) {
      if (frame.owner >= 0) nodes[frame.owner]!.contentRefs++;
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    if (nodes.length >= limits.maxNodes) {
      truncated = true;
      break walk;
    }

    // `/Pg` is read without resolving it: the reference itself is the page's
    // identity, and resolving it only to serialise the page dictionary back
    // into a key is both slow and wrong when two pages have identical content.
    let page: number | null = null;
    const pg = resolved.get(N.Pg);
    if (pg instanceof PDFRef) page = pageIndex.get(pg.tag) ?? null;

    const owner = nodes.length;
    nodes.push({
      tag: roleMap?.get(rawTag) ?? rawTag,
      rawTag,
      alt: asText(deref(doc, resolved.get(N.Alt))),
      actualText: asText(deref(doc, resolved.get(N.ActualText))),
      lang: asText(deref(doc, resolved.get(N.Lang))),
      contentRefs: 0,
      page,
      depth: frame.depth,
    });

    if (frame.depth + 1 > limits.maxDepth) {
      truncated = true;
      continue;
    }
    const child = frameFor(deref(doc, resolved.get(N.K)), frame.depth + 1, owner);
    if (child !== null) stack.push(child);
  }

  return { nodes, ends: computeEnds(nodes), truncated, hasParentTree };
}

/** Subtree end offsets, in one pass over the flattened tree. */
function computeEnds(nodes: StructNode[]): Int32Array {
  const ends = new Int32Array(nodes.length);
  const open: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const depth = nodes[i]!.depth;
    while (open.length > 0 && nodes[open[open.length - 1]!]!.depth >= depth) {
      ends[open.pop()!] = i;
    }
    open.push(i);
  }
  while (open.length > 0) ends[open.pop()!] = nodes.length;
  return ends;
}

/**
 * Counts image XObjects reachable from a page, following form XObjects.
 *
 * `memo` is shared across pages so a form XObject used on every page is walked
 * once, and `visiting` keeps a self referential form from looping forever.
 */
export function countPageImages(
  doc: PDFDocument,
  resources: PdfValue,
  memo: Map<PDFObject, number>,
  depth = 0,
  visiting: Set<PDFObject> = new Set(),
): number {
  if (depth > 8) return 0;
  const xobjects = get(doc, resources, N.XObject);
  if (!(xobjects instanceof PDFDict)) return 0;

  let count = 0;
  for (const [, value] of xobjects.entries()) {
    const stream = deref(doc, value);
    if (stream === null) continue;
    const dict = stream instanceof PDFStream ? stream.dict : stream;
    if (!(dict instanceof PDFDict)) continue;

    const subtype = asName(deref(doc, dict.get(N.Subtype)));
    if (subtype === "Image") {
      count++;
      continue;
    }
    if (subtype !== "Form") continue;

    const cached = memo.get(dict);
    if (cached !== undefined) {
      count += cached;
      continue;
    }
    if (visiting.has(dict)) continue;
    visiting.add(dict);
    const inner = countPageImages(doc, get(doc, dict, PDFName.of("Resources")), memo, depth + 1, visiting);
    visiting.delete(dict);
    memo.set(dict, inner);
    count += inner;
  }
  return count;
}

export interface Permissions {
  /** The raw `/P` bit field, when the encryption dictionary exposes one. */
  raw: number | null;
  /** Revision of the standard security handler, when present. */
  revision: number | null;
  /**
   * Whether the flags let assistive technology read the content out.
   * `null` means the file is encrypted but the flags could not be read.
   */
  extractionAllowed: boolean | null;
}

// ISO 32000-1 table 22. Bit 5 is copy/extract, bit 10 is extract for
// accessibility, which only exists from revision 3 onwards.
const BIT_EXTRACT = 1 << 4;
const BIT_EXTRACT_FOR_ACCESSIBILITY = 1 << 9;

/** Reads the standard security handler's permission flags. */
export function readPermissions(doc: PDFDocument): Permissions | null {
  const encrypt = deref(doc, doc.context.trailerInfo.Encrypt);
  if (!(encrypt instanceof PDFDict)) return null;

  const raw = asNumber(deref(doc, encrypt.get(N.P)));
  const revision = asNumber(deref(doc, encrypt.get(N.R)));
  if (raw === null || !Number.isFinite(raw)) {
    return { raw: null, revision, extractionAllowed: null };
  }
  // `/P` is a signed 32 bit integer written as a PDF number.
  const flags = raw | 0;
  const copy = (flags & BIT_EXTRACT) !== 0;
  const accessibility = (flags & BIT_EXTRACT_FOR_ACCESSIBILITY) !== 0;
  const allowed = revision !== null && revision >= 3 ? copy || accessibility : copy;
  return { raw: flags, revision, extractionAllowed: allowed };
}

/**
 * Bytes of decompressed XMP read before giving up. Metadata this large is not a
 * title, and reading no further is what keeps a small but highly compressible
 * metadata stream from inflating into hundreds of megabytes.
 */
const MAX_XMP_BYTES = 1024 * 1024;

const DC_TITLE = /<dc:title>([\s\S]{0,4096}?)<\/dc:title>/i;
const RDF_LI = /<rdf:li[^>]*>([\s\S]{0,1024}?)<\/rdf:li>/i;

/**
 * Reads `dc:title` out of the XMP metadata stream.
 *
 * PDF 2.0 and PDF/UA-2 put the document title in XMP rather than in the info
 * dictionary, so a file with only XMP is correctly titled even though
 * `/Info /Title` is missing. Only called when the info dictionary has no title.
 */
export function readXmpTitle(doc: PDFDocument): string | null {
  try {
    const metadata = get(doc, doc.catalog, N.Metadata);
    if (!(metadata instanceof PDFRawStream)) return null;

    // getBytes, not decode: decode() inflates the whole stream before anything
    // can look at its size, which a crafted metadata stream turns into a
    // memory exhaustion. This reads a bounded prefix instead.
    const bytes = decodePDFRawStream(metadata).getBytes(MAX_XMP_BYTES);
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    const block = DC_TITLE.exec(xml);
    if (block === null) return null;
    const inner = block[1] ?? "";
    const item = RDF_LI.exec(inner);
    const text = (item?.[1] ?? inner).replace(/<[^>]*>/g, "").trim();
    return text.length > 0 ? decodeXmlEntities(text) : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]{1,6}|[a-z]{2,4});/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}
