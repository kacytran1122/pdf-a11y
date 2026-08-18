import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
} from "pdf-lib";

export type Any = any;

/** Resolves a reference to the object it points at. */
export function deref(doc: PDFDocument, value: Any): Any {
  if (value === undefined || value === null) return null;
  try {
    return doc.context.lookup(value) ?? null;
  } catch {
    return null;
  }
}

/** Reads a key off a dictionary and resolves any reference. */
export function get(doc: PDFDocument, dict: Any, key: string): Any {
  if (!dict || typeof dict.get !== "function") return null;
  return deref(doc, dict.get(PDFName.of(key)));
}

export function asName(value: Any): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

export function asText(value: Any): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try {
      return value.decodeText();
    } catch {
      return null;
    }
  }
  return null;
}

export function asBool(value: Any): boolean | null {
  return value instanceof PDFBool ? value.asBoolean() : null;
}

export function asNumber(value: Any): number | null {
  return value instanceof PDFNumber ? value.asNumber() : null;
}

/** Normalises `/K` style entries into an array. */
export function asArray(value: Any): Any[] {
  if (!value) return [];
  if (value instanceof PDFArray) return value.asArray();
  return [value];
}

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
  children: StructNode[];
  /** 1 based page number, when the element points at one. */
  page: number | null;
}

/** Reads the role map, which lets a file rename standard tags. */
function readRoleMap(doc: PDFDocument, root: Any): Map<string, string> {
  const map = new Map<string, string>();
  const roleMap = get(doc, root, "RoleMap");
  if (!roleMap || !(roleMap instanceof PDFDict)) return map;
  for (const [key, value] of roleMap.entries()) {
    const from = key.decodeText();
    const to = asName(deref(doc, value));
    if (to) map.set(from, to);
  }
  return map;
}

/**
 * Walks the structure tree into a plain tree.
 * Cycles are possible in damaged files, so visited refs are tracked.
 */
export function readStructTree(
  doc: PDFDocument,
  pageIndex: Map<string, number>,
): { root: StructNode[]; roleMap: Map<string, string> } {
  const structRoot = get(doc, doc.catalog, "StructTreeRoot");
  if (!structRoot) return { root: [], roleMap: new Map() };

  const roleMap = readRoleMap(doc, structRoot);
  const seen = new Set<Any>();

  const readNode = (entry: Any): StructNode | null => {
    const dict = deref(doc, entry);
    if (!dict || !(dict instanceof PDFDict)) return null;
    if (seen.has(dict)) return null;
    seen.add(dict);

    const rawTag = asName(get(doc, dict, "S"));
    if (!rawTag) return null;
    const tag = roleMap.get(rawTag) ?? rawTag;

    const pageRefDict = get(doc, dict, "Pg");
    let page: number | null = null;
    if (pageRefDict) {
      const key = objectKey(pageRefDict);
      page = key !== null ? (pageIndex.get(key) ?? null) : null;
    }

    const node: StructNode = {
      tag,
      rawTag,
      alt: asText(get(doc, dict, "Alt")),
      actualText: asText(get(doc, dict, "ActualText")),
      lang: asText(get(doc, dict, "Lang")),
      contentRefs: 0,
      children: [],
      page,
    };

    for (const kid of asArray(get(doc, dict, "K"))) {
      const resolved = deref(doc, kid);
      if (resolved instanceof PDFNumber) {
        node.contentRefs++;
        continue;
      }
      if (resolved instanceof PDFDict) {
        const type = asName(get(doc, resolved, "Type"));
        // A marked content reference or object reference is content, not an element.
        if (type === "MCR" || type === "OBJR") {
          node.contentRefs++;
          continue;
        }
        const child = readNode(resolved);
        if (child) {
          node.children.push(child);
          continue;
        }
        node.contentRefs++;
      }
    }
    return node;
  };

  const root: StructNode[] = [];
  for (const kid of asArray(get(doc, structRoot, "K"))) {
    const node = readNode(kid);
    if (node) root.push(node);
  }
  return { root, roleMap };
}

/** Stable identity for a resolved object, used to map page dicts to numbers. */
export function objectKey(object: Any): string | null {
  if (!object) return null;
  try {
    return String(object.toString());
  } catch {
    return null;
  }
}

export function flatten(nodes: StructNode[]): StructNode[] {
  const out: StructNode[] = [];
  const walk = (list: StructNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Counts image XObjects on a page, following one level of form XObjects. */
export function countImages(doc: PDFDocument, pageNode: Any, depth = 0): number {
  if (depth > 2) return 0;
  const resources = get(doc, pageNode, "Resources");
  const xobjects = get(doc, resources, "XObject");
  if (!xobjects || !(xobjects instanceof PDFDict)) return 0;

  let count = 0;
  for (const [, value] of xobjects.entries()) {
    const stream = deref(doc, value);
    if (!stream) continue;
    const dict = stream instanceof PDFRawStream ? stream.dict : stream;
    const subtype = asName(get(doc, dict, "Subtype"));
    if (subtype === "Image") count++;
    else if (subtype === "Form") count += countImages(doc, dict, depth + 1);
  }
  return count;
}
