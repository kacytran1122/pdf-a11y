// Deterministic PDF corpus for benchmarking and stress testing.
// Plain ESM so it runs against any build of the library without a compile step.
import { PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const elem = (ctx, S, extra = {}) => ctx.register(ctx.obj({ Type: "StructElem", S, ...extra }));

/** Untagged single page: what pdfkit and puppeteer emit by default. */
async function untagged1p() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

/** Fully tagged single page that passes every check. */
async function tagged1p() {
  return taggedReport(1, 6);
}

/**
 * A realistic tagged report: `pages` pages, each with a heading, paragraphs,
 * a figure with alt text and a 3x4 table with header cells.
 */
async function taggedReport(pages, perPage = 12) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  doc.setTitle(`Report ${pages}p`);
  doc.catalog.set(PDFName.of("Lang"), PDFString.of("en-GB"));
  doc.catalog.set(PDFName.of("ViewerPreferences"), ctx.obj({ DisplayDocTitle: true }));

  const image = await doc.embedPng(`data:image/png;base64,${PNG_1PX}`);
  const kids = [];

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    page.drawImage(image, { x: 10, y: 10, width: 40, height: 40 });
    const Pg = page.ref;

    kids.push(elem(ctx, p === 0 ? "H1" : "H2", { Pg, K: PDFNumber.of(0) }));
    for (let i = 0; i < perPage; i++) kids.push(elem(ctx, "P", { Pg, K: PDFNumber.of(i + 1) }));
    kids.push(
      elem(ctx, "Figure", { Pg, K: PDFNumber.of(0), Alt: PDFString.of(`Chart of spend for month ${p + 1}`) }),
    );

    const rows = [];
    for (let r = 0; r < 4; r++) {
      const cells = [];
      for (let c = 0; c < 3; c++) {
        cells.push(elem(ctx, r === 0 ? "TH" : "TD", { Pg, K: PDFNumber.of(0) }));
      }
      rows.push(elem(ctx, "TR", { Pg, K: cells }));
    }
    kids.push(elem(ctx, "Table", { Pg, K: rows }));
  }

  doc.catalog.set(PDFName.of("StructTreeRoot"), ctx.register(ctx.obj({ Type: "StructTreeRoot", K: kids })));
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** Many pages, many image XObjects per page, some behind form XObjects. */
async function imageHeavy(pages, perPage) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const image = await doc.embedPng(`data:image/png;base64,${PNG_1PX}`);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    for (let i = 0; i < perPage; i++) page.drawImage(image, { x: i, y: i, width: 10, height: 10 });
    // A form XObject wrapping another image, to exercise the nested walk.
    const inner = ctx.obj({});
    inner.set(PDFName.of("XObject"), ctx.obj({ Im9: image.ref }));
    const form = ctx.register(
      ctx.flateStream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1], Resources: inner }),
    );
    const res = page.node.Resources();
    const xo = res.lookup(PDFName.of("XObject"));
    xo.set(PDFName.of("Fm0"), form);
  }
  return doc.save();
}

/** Adversarial: a structure tree nested `depth` levels deep. */
async function deepNesting(depth) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  let child = elem(ctx, "P", { Pg: page.ref, K: PDFNumber.of(0) });
  for (let i = 0; i < depth; i++) child = elem(ctx, "Div", { Pg: page.ref, K: [child] });
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(ctx.obj({ Type: "StructTreeRoot", K: [child] })),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** Adversarial: tables nested inside tables, `depth` levels, each with cells. */
async function nestedTables(depth) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  const Pg = page.ref;
  let table = elem(ctx, "Table", {
    Pg,
    K: [
      elem(ctx, "TR", {
        Pg,
        K: [elem(ctx, "TH", { Pg, K: PDFNumber.of(0) }), elem(ctx, "TD", { Pg, K: PDFNumber.of(0) })],
      }),
    ],
  });
  for (let i = 0; i < depth; i++) {
    const cells = [];
    for (let c = 0; c < 8; c++) cells.push(elem(ctx, "TD", { Pg, K: PDFNumber.of(0) }));
    cells.push(table);
    table = elem(ctx, "Table", { Pg, K: [elem(ctx, "TR", { Pg, K: cells })] });
  }
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(ctx.obj({ Type: "StructTreeRoot", K: [table] })),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** One table with `cells` data cells and no header cells. */
async function wideTable(cells) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  const Pg = page.ref;
  const rows = [];
  for (let r = 0; r < cells / 10; r++) {
    const tds = [];
    for (let c = 0; c < 10; c++) tds.push(elem(ctx, "TD", { Pg, K: PDFNumber.of(0) }));
    rows.push(elem(ctx, "TR", { Pg, K: tds }));
  }
  doc.catalog.set(
    PDFName.of("StructTreeRoot"),
    ctx.register(ctx.obj({ Type: "StructTreeRoot", K: [elem(ctx, "Table", { Pg, K: rows })] })),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** Adversarial: a structure tree that points back at itself. */
async function cyclic() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([10, 10]);
  const a = ctx.nextRef();
  const b = ctx.nextRef();
  ctx.assign(a, ctx.obj({ Type: "StructElem", S: "Div", Pg: page.ref, K: [b] }));
  ctx.assign(b, ctx.obj({ Type: "StructElem", S: "Div", Pg: page.ref, K: [a] }));
  doc.catalog.set(PDFName.of("StructTreeRoot"), ctx.register(ctx.obj({ Type: "StructTreeRoot", K: [a] })));
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  return doc.save();
}

/** Many pages each carrying link and widget annotations. */
async function annotationHeavy(pages, perPage) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    const annots = [];
    for (let i = 0; i < perPage; i++) {
      annots.push(ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 1, 1] })));
      annots.push(
        ctx.register(
          ctx.obj({
            Type: "Annot",
            Subtype: "Widget",
            FT: "Tx",
            Rect: [0, 0, 1, 1],
            T: PDFString.of(`f${i}`),
          }),
        ),
      );
    }
    page.node.set(PDFName.of("Annots"), ctx.obj(annots));
  }
  return doc.save();
}

function notAPdf() {
  return new TextEncoder().encode("this is definitely not a pdf ".repeat(400));
}

async function truncated() {
  const full = await taggedReport(10);
  return full.slice(0, Math.floor(full.length / 2));
}

/** name -> bytes. Built once, reused by every consumer. */
export async function buildCorpus() {
  const entries = await Promise.all(
    Object.entries({
      "untagged-1p": untagged1p(),
      "tagged-1p": tagged1p(),
      "tagged-50p": taggedReport(50),
      "tagged-500p": taggedReport(500),
      "image-heavy-100p": imageHeavy(100, 20),
      "annot-heavy-100p": annotationHeavy(100, 10),
      "deep-nest-20k": deepNesting(20_000),
      "nested-tables-200": nestedTables(200),
      "wide-table-10k": wideTable(10_000),
      cyclic: cyclic(),
      "not-a-pdf": notAPdf(),
      truncated: truncated(),
    }).map(async ([name, promise]) => [name, await promise]),
  );
  return new Map(entries);
}
