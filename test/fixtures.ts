import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, type PDFContext, type PDFRef } from "pdf-lib";

/** A one pixel PNG, enough to make a real image XObject. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const elem = (ctx: PDFContext, S: string, extra: Record<string, unknown> = {}): PDFRef =>
  ctx.register(ctx.obj({ Type: "StructElem", S, ...extra } as never));

export interface FixtureOptions {
  tagged?: boolean;
  lang?: string | null;
  title?: string | null;
  displayDocTitle?: boolean;
  /** Alt text for the figure. null means the Figure element carries no alt. */
  figureAlt?: string | null;
  /** Uses /ActualText instead of /Alt for the figure. */
  figureActualText?: string;
  withImage?: boolean;
  withTable?: boolean;
  tableHeaders?: boolean;
  /** Heading tags in document order, for example ["H1", "H3"]. */
  headings?: string[];
  withLink?: boolean;
  linkContents?: string | null;
  withWidget?: boolean;
  widgetTooltip?: string | null;
  widgetName?: string;
  /** Sets the annotation /F flag, for example 2 for Hidden. */
  annotFlags?: number;
  /** Puts /TU and /T on a parent field instead of on the widget itself. */
  widgetOnParentField?: boolean;
  tabsOrder?: boolean;
  /** Structure tree root carries a /ParentTree. Tagged PDFs need one. */
  parentTree?: boolean;
  /** MarkInfo/Suspects, the producer flagging its own tagging as unreliable. */
  suspects?: boolean;
  /** Renames tags through /RoleMap, for example { Chapter: "H1" }. */
  roleMap?: Record<string, string>;
  /** Extra structure elements appended after everything else. */
  extraTags?: string[];
  /** XMP metadata stream contents, used when the info dictionary has no title. */
  xmp?: string;
}

/** Builds a PDF in memory with exactly the accessibility features requested. */
export async function makePdf(options: FixtureOptions = {}): Promise<Uint8Array> {
  const {
    tagged = false,
    lang = null,
    title = null,
    displayDocTitle = false,
    figureAlt,
    figureActualText,
    withImage = false,
    withTable = false,
    tableHeaders = true,
    headings = [],
    withLink = false,
    linkContents = null,
    withWidget = false,
    widgetTooltip = null,
    widgetName = "customer_name",
    annotFlags,
    widgetOnParentField = false,
    tabsOrder = false,
    parentTree = true,
    suspects = false,
    roleMap,
    extraTags = [],
    xmp,
  } = options;

  const doc = await PDFDocument.create();
  const context = doc.context;
  const page = doc.addPage([300, 300]);

  if (withImage) {
    const image = await doc.embedPng(`data:image/png;base64,${PNG_1PX}`);
    page.drawImage(image, { x: 10, y: 10, width: 50, height: 50 });
  }

  if (title !== null) doc.setTitle(title);
  if (lang !== null) doc.catalog.set(PDFName.of("Lang"), PDFString.of(lang));
  if (displayDocTitle) {
    doc.catalog.set(PDFName.of("ViewerPreferences"), context.obj({ DisplayDocTitle: true }));
  }
  if (xmp !== undefined) {
    doc.catalog.set(
      PDFName.of("Metadata"),
      context.register(context.stream(xmp, { Type: "Metadata", Subtype: "XML" })),
    );
  }

  // ---- annotations ----
  const annots: PDFRef[] = [];
  if (withLink) {
    const link: Record<string, unknown> = {
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 200, 100, 220],
      Border: [0, 0, 0],
    };
    if (linkContents !== null) link.Contents = PDFString.of(linkContents);
    if (annotFlags !== undefined) link.F = annotFlags;
    annots.push(context.register(context.obj(link as never)));
  }
  if (withWidget) {
    const widget: Record<string, unknown> = {
      Type: "Annot",
      Subtype: "Widget",
      FT: "Tx",
      Rect: [10, 100, 200, 130],
    };
    if (annotFlags !== undefined) widget.F = annotFlags;
    if (widgetOnParentField) {
      const field: Record<string, unknown> = { FT: "Tx", T: PDFString.of(widgetName) };
      if (widgetTooltip !== null) field.TU = PDFString.of(widgetTooltip);
      widget.Parent = context.register(context.obj(field as never));
    } else {
      widget.T = PDFString.of(widgetName);
      if (widgetTooltip !== null) widget.TU = PDFString.of(widgetTooltip);
    }
    annots.push(context.register(context.obj(widget as never)));
  }
  if (annots.length > 0) {
    page.node.set(PDFName.of("Annots"), context.obj(annots));
    if (tabsOrder) page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
  }

  // ---- structure tree ----
  if (tagged) {
    const kids: PDFRef[] = [];

    for (const heading of headings) {
      kids.push(elem(context, heading, { Pg: page.ref, K: PDFNumber.of(0) }));
    }

    if (figureAlt !== undefined || figureActualText !== undefined) {
      const figure: Record<string, unknown> = { Pg: page.ref, K: PDFNumber.of(0) };
      if (figureAlt) figure.Alt = PDFString.of(figureAlt);
      if (figureActualText !== undefined) figure.ActualText = PDFString.of(figureActualText);
      kids.push(elem(context, "Figure", figure));
    }

    if (withTable) {
      const cells: PDFRef[] = [];
      if (tableHeaders) cells.push(elem(context, "TH", { Pg: page.ref, K: PDFNumber.of(0) }));
      cells.push(elem(context, "TD", { Pg: page.ref, K: PDFNumber.of(0) }));
      const row = elem(context, "TR", { Pg: page.ref, K: cells });
      kids.push(elem(context, "Table", { Pg: page.ref, K: [row] }));
    }

    for (const tag of extraTags) kids.push(elem(context, tag, { Pg: page.ref, K: PDFNumber.of(0) }));

    if (kids.length === 0) kids.push(elem(context, "P", { Pg: page.ref, K: PDFNumber.of(0) }));

    const root: Record<string, unknown> = { Type: "StructTreeRoot", K: kids };
    if (parentTree) root.ParentTree = context.obj({ Nums: [] });
    if (roleMap) root.RoleMap = context.obj(roleMap);
    doc.catalog.set(PDFName.of("StructTreeRoot"), context.register(context.obj(root as never)));
    doc.catalog.set(
      PDFName.of("MarkInfo"),
      context.obj(suspects ? { Marked: true, Suspects: true } : { Marked: true }),
    );
  }

  return doc.save();
}

/** A PDF that passes every check, used as the control. */
export function makeGoodPdf(extra: FixtureOptions = {}): Promise<Uint8Array> {
  return makePdf({
    tagged: true,
    lang: "en-GB",
    title: "Invoice 2026-0142",
    displayDocTitle: true,
    withImage: true,
    figureAlt: "Bar chart showing monthly spend rising from March to June",
    headings: ["H1", "H2"],
    ...extra,
  });
}

/** A tagged document whose structure elements are nested `depth` levels deep. */
export async function makeDeepPdf(depth: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  let child = elem(ctx, "P", { Pg: page.ref, K: PDFNumber.of(0) });
  for (let i = 0; i < depth; i++) child = elem(ctx, "Div", { Pg: page.ref, K: [child] });
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(ctx.obj({ Type: "StructTreeRoot", ParentTree: ctx.obj({ Nums: [] }), K: [child] })),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** A structure tree with a cycle, which damaged files really do contain. */
export async function makeCyclicPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  const a = ctx.nextRef();
  const b = ctx.nextRef();
  ctx.assign(a, ctx.obj({ Type: "StructElem", S: "Div", Pg: page.ref, K: [b] }));
  ctx.assign(b, ctx.obj({ Type: "StructElem", S: "Div", Pg: page.ref, K: [a] }));
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(ctx.obj({ Type: "StructTreeRoot", ParentTree: ctx.obj({ Nums: [] }), K: [a] })),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** An outer table with no header cells wrapping an inner table that has them. */
export async function makeNestedTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  const Pg = page.ref;
  const inner = elem(ctx, "Table", {
    Pg,
    K: [
      elem(ctx, "TR", {
        Pg,
        K: [elem(ctx, "TH", { Pg, K: PDFNumber.of(0) }), elem(ctx, "TD", { Pg, K: PDFNumber.of(0) })],
      }),
    ],
  });
  const outer = elem(ctx, "Table", {
    Pg,
    K: [elem(ctx, "TR", { Pg, K: [elem(ctx, "TD", { Pg, K: PDFNumber.of(0) }), inner] })],
  });
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(ctx.obj({ Type: "StructTreeRoot", ParentTree: ctx.obj({ Nums: [] }), K: [outer] })),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/**
 * Several byte identical blank pages, with a Figure that has no alt text on the
 * first one. Identifying pages by their contents rather than their reference
 * collapses them all onto the last page, so the figure is reported in the
 * wrong place.
 */
export async function makeIdenticalPagesPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const pages = Array.from({ length: count }, () => doc.addPage([100, 100]));
  const first = pages[0]!;
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(
      ctx.obj({
        Type: "StructTreeRoot",
        ParentTree: ctx.obj({ Nums: [] }),
        K: [elem(ctx, "Figure", { Pg: first.ref, K: PDFNumber.of(0) })],
      }),
    ),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/**
 * A document that declares encryption with the given permission flags.
 * The bytes are not actually encrypted; only the trailer's /Encrypt entry and
 * its `/P` bit field matter to the permission check.
 */
export async function makeEncryptedPdf(P: number | null, R = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const ctx = doc.context;
  const encrypt: Record<string, unknown> = {
    Filter: "Standard",
    V: 2,
    R,
    Length: 128,
    O: PDFString.of("x".repeat(32)),
    U: PDFString.of("y".repeat(32)),
  };
  if (P !== null) encrypt.P = P;
  ctx.trailerInfo.Encrypt = ctx.register(ctx.obj(encrypt as never));
  return doc.save();
}

/** Image XObjects reachable only through the page tree's inherited /Resources. */
export async function makeInheritedResourcesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([100, 100]);
  const image = await doc.embedPng(`data:image/png;base64,${PNG_1PX}`);
  page.drawImage(image, { x: 0, y: 0, width: 10, height: 10 });

  // Move the page's resources up to the /Pages node, which is legal and which
  // a reader that does not honour inheritance will fail to find.
  const resources = page.node.get(PDFName.of("Resources"));
  page.node.delete(PDFName.of("Resources"));
  const parent = ctx.lookup(page.node.get(PDFName.of("Parent")));
  if (!(parent instanceof PDFDict) || resources === undefined) throw new Error("unexpected page tree");
  parent.set(PDFName.of("Resources"), resources);
  return doc.save();
}
