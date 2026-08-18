import { PDFDocument, PDFName, PDFString } from "pdf-lib";

/** A one pixel PNG, enough to make a real image XObject. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export interface FixtureOptions {
  tagged?: boolean;
  lang?: string | null;
  title?: string | null;
  displayDocTitle?: boolean;
  /** Alt text for the figure. null means the Figure element carries no alt. */
  figureAlt?: string | null;
  withImage?: boolean;
  withTable?: boolean;
  tableHeaders?: boolean;
  /** Heading tags in document order, for example ["H1", "H3"]. */
  headings?: string[];
  withLink?: boolean;
  linkContents?: string | null;
  withWidget?: boolean;
  widgetTooltip?: string | null;
  tabsOrder?: boolean;
}

/** Builds a PDF in memory with exactly the accessibility features requested. */
export async function makePdf(options: FixtureOptions = {}): Promise<Uint8Array> {
  const {
    tagged = false,
    lang = null,
    title = null,
    displayDocTitle = false,
    figureAlt,
    withImage = false,
    withTable = false,
    tableHeaders = true,
    headings = [],
    withLink = false,
    linkContents = null,
    withWidget = false,
    widgetTooltip = null,
    tabsOrder = false,
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

  // ---- annotations ----
  const annots: any[] = [];
  if (withLink) {
    const link: Record<string, any> = {
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 200, 100, 220],
      Border: [0, 0, 0],
    };
    if (linkContents !== null) link.Contents = PDFString.of(linkContents);
    annots.push(context.register(context.obj(link)));
  }
  if (withWidget) {
    const widget: Record<string, any> = {
      Type: "Annot",
      Subtype: "Widget",
      FT: "Tx",
      Rect: [10, 100, 200, 130],
      T: PDFString.of("customer_name"),
    };
    if (widgetTooltip !== null) widget.TU = PDFString.of(widgetTooltip);
    annots.push(context.register(context.obj(widget)));
  }
  if (annots.length > 0) {
    page.node.set(PDFName.of("Annots"), context.obj(annots));
    if (tabsOrder) page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
  }

  // ---- structure tree ----
  if (tagged) {
    const kids: any[] = [];

    for (const heading of headings) {
      kids.push(
        context.register(
          context.obj({ Type: "StructElem", S: heading, Pg: page.ref, K: 0 }),
        ),
      );
    }

    if (figureAlt !== undefined) {
      const figure: Record<string, any> = {
        Type: "StructElem",
        S: "Figure",
        Pg: page.ref,
        K: 0,
      };
      if (figureAlt) figure.Alt = PDFString.of(figureAlt);
      kids.push(context.register(context.obj(figure)));
    }

    if (withTable) {
      const cells: any[] = [];
      if (tableHeaders) {
        cells.push(context.register(context.obj({ Type: "StructElem", S: "TH", Pg: page.ref, K: 0 })));
      }
      cells.push(context.register(context.obj({ Type: "StructElem", S: "TD", Pg: page.ref, K: 0 })));
      const row = context.register(
        context.obj({ Type: "StructElem", S: "TR", Pg: page.ref, K: cells }),
      );
      kids.push(
        context.register(context.obj({ Type: "StructElem", S: "Table", Pg: page.ref, K: [row] })),
      );
    }

    if (kids.length === 0) {
      kids.push(context.register(context.obj({ Type: "StructElem", S: "P", Pg: page.ref, K: 0 })));
    }

    const structRoot = context.register(context.obj({ Type: "StructTreeRoot", K: kids }));
    doc.catalog.set(PDFName.of("StructTreeRoot"), structRoot);
    doc.catalog.set(PDFName.of("MarkInfo"), context.obj({ Marked: true }));
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
