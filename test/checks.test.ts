import { describe, expect, it } from "vitest";
import { checkPdf } from "../src/index.js";
import type { CheckId } from "../src/types.js";
import { makeGoodPdf, makeNestedTablePdf, makePdf } from "./fixtures.js";

const checks = async (
  bytes: Uint8Array,
  profile: "recommended" | "pdf-ua" = "recommended",
): Promise<CheckId[]> => {
  const report = await checkPdf(bytes, { profile });
  return report.issues.map((i) => i.check);
};

describe("control document", () => {
  it("passes every check", async () => {
    const report = await checkPdf(await makeGoodPdf(), { profile: "pdf-ua" });
    expect(report.issues).toEqual([]);
    expect(report.errorCount).toBe(0);
    expect(report.limitations).toEqual([]);
  });

  it("reports the facts it read", async () => {
    const report = await checkPdf(await makeGoodPdf());
    expect(report.facts.tagged).toBe(true);
    expect(report.facts.marked).toBe(true);
    expect(report.facts.lang).toBe("en-GB");
    expect(report.facts.title).toBe("Invoice 2026-0142");
    expect(report.facts.images).toBe(1);
    expect(report.facts.figures).toBe(1);
    expect(report.facts.tags.H1).toBe(1);
  });
});

describe("struct-tree and marked-content", () => {
  it("flags a plain untagged PDF, which is what pdfkit and puppeteer produce", async () => {
    const found = await checks(await makePdf({ tagged: false }));
    expect(found).toContain("struct-tree");
    expect(found).toContain("marked-content");
  });

  it("treats an untagged document as the most serious problem", async () => {
    const report = await checkPdf(await makePdf({ tagged: false }));
    expect(report.issues.find((i) => i.check === "struct-tree")?.severity).toBe("error");
  });

  it("flags a producer that marked its own tagging as suspect", async () => {
    const report = await checkPdf(await makeGoodPdf({ suspects: true }));
    const issue = report.issues.find((i) => i.check === "marked-content");
    expect(issue?.message).toContain("Suspects");
  });

  it("does not report parent-tree on an untagged document", async () => {
    const found = await checks(await makePdf({ tagged: false }));
    expect(found).not.toContain("parent-tree");
  });

  it("flags a tagged document with no /ParentTree", async () => {
    const found = await checks(await makeGoodPdf({ parentTree: false }));
    expect(found).toContain("parent-tree");
  });
});

describe("document-lang", () => {
  it("flags a missing language", async () => {
    expect(await checks(await makeGoodPdf({ lang: null }))).toContain("document-lang");
  });

  it("flags a language that is not a real tag", async () => {
    const report = await checkPdf(await makeGoodPdf({ lang: "English" }));
    expect(report.issues.find((i) => i.check === "document-lang")?.message).toContain("well formed");
  });

  it("accepts a plain two letter tag", async () => {
    expect(await checks(await makeGoodPdf({ lang: "vi" }))).not.toContain("document-lang");
  });

  it("accepts a script and region subtag", async () => {
    expect(await checks(await makeGoodPdf({ lang: "zh-Hant-TW" }))).not.toContain("document-lang");
  });

  it("treats whitespace as no language at all", async () => {
    const report = await checkPdf(await makeGoodPdf({ lang: "   " }));
    expect(report.issues.find((i) => i.check === "document-lang")?.message).toContain("No document language");
  });
});

describe("document-title", () => {
  it("flags a missing title", async () => {
    expect(await checks(await makeGoodPdf({ title: null }))).toContain("document-title");
  });

  it("flags a title that will not be displayed", async () => {
    const report = await checkPdf(await makeGoodPdf({ displayDocTitle: false }));
    expect(report.issues.find((i) => i.check === "document-title")?.message).toContain("DisplayDocTitle");
  });

  it("falls back to the XMP title, which is where PDF 2.0 puts it", async () => {
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
      <x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Statement &amp; Summary</rdf:li></rdf:Alt></dc:title>
      </rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const report = await checkPdf(await makeGoodPdf({ title: null, xmp }));
    expect(report.facts.title).toBe("Statement & Summary");
    expect(report.issues.map((i) => i.check)).not.toContain("document-title");
  });

  it("ignores XMP that carries no title", async () => {
    const report = await checkPdf(await makeGoodPdf({ title: null, xmp: "<x:xmpmeta/>" }));
    expect(report.facts.title).toBeNull();
    expect(report.issues.map((i) => i.check)).toContain("document-title");
  });
});

describe("figure-alt", () => {
  it("flags a figure with no alt text", async () => {
    expect(await checks(await makeGoodPdf({ figureAlt: null }))).toContain("figure-alt");
  });

  it("flags alt text that says nothing", async () => {
    const report = await checkPdf(await makeGoodPdf({ figureAlt: "image" }));
    expect(report.issues.find((i) => i.check === "figure-alt")?.message).toContain("describes nothing");
  });

  it("flags a file name used as alt text", async () => {
    expect(await checks(await makeGoodPdf({ figureAlt: "chart-final-v2.png" }))).toContain("figure-alt");
  });

  it("accepts a real description", async () => {
    const found = await checks(await makeGoodPdf({ figureAlt: "Line chart of revenue by quarter" }));
    expect(found).not.toContain("figure-alt");
  });

  it("accepts /ActualText when there is no /Alt", async () => {
    const found = await checks(
      await makeGoodPdf({ figureAlt: null, figureActualText: "Total due: 412.90 EUR" }),
    );
    expect(found).not.toContain("figure-alt");
  });

  it("treats whitespace only alt text as missing", async () => {
    const report = await checkPdf(await makeGoodPdf({ figureAlt: "   " }));
    expect(report.issues.find((i) => i.check === "figure-alt")?.message).toContain("no alt text");
  });

  it("records the page the figure sits on", async () => {
    const report = await checkPdf(await makeGoodPdf({ figureAlt: null }));
    expect(report.issues.find((i) => i.check === "figure-alt")?.page).toBe(1);
  });
});

describe("untagged-image", () => {
  it("flags an image with no matching Figure element", async () => {
    const report = await checkPdf(await makePdf({ tagged: true, withImage: true, headings: ["H1"] }));
    const issue = report.issues.find((i) => i.check === "untagged-image");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("1 image");
  });
});

describe("table-headers", () => {
  it("flags a table with no header cells", async () => {
    expect(await checks(await makeGoodPdf({ withTable: true, tableHeaders: false }))).toContain(
      "table-headers",
    );
  });

  it("accepts a table with header cells", async () => {
    expect(await checks(await makeGoodPdf({ withTable: true, tableHeaders: true }))).not.toContain(
      "table-headers",
    );
  });

  it("does not let a nested table's headers excuse the table around it", async () => {
    const report = await checkPdf(await makeNestedTablePdf());
    const issues = report.issues.filter((i) => i.check === "table-headers");
    expect(issues).toHaveLength(1);
    // Only the outer table's own cell counts, not the inner table's.
    expect(issues[0]?.message).toContain("1 cells");
  });
});

describe("heading-order", () => {
  it("flags a skipped level", async () => {
    const report = await checkPdf(await makeGoodPdf({ headings: ["H1", "H3"] }));
    expect(report.issues.find((i) => i.check === "heading-order")?.message).toContain("H1 to H3");
  });

  it("flags a document that does not start at H1", async () => {
    const report = await checkPdf(await makeGoodPdf({ headings: ["H2", "H3"] }));
    expect(report.issues.find((i) => i.check === "heading-order")?.message).toContain("first heading");
  });

  it("accepts a clean outline", async () => {
    expect(await checks(await makeGoodPdf({ headings: ["H1", "H2", "H3", "H2"] }))).not.toContain(
      "heading-order",
    );
  });

  it("ignores the unnumbered H tag, which carries no level", async () => {
    expect(await checks(await makeGoodPdf({ headings: ["H1", "H", "H2"] }))).not.toContain("heading-order");
  });
});

describe("role map", () => {
  it("reads a renamed tag as the standard one it maps to", async () => {
    const report = await checkPdf(
      await makePdf({
        tagged: true,
        lang: "en",
        title: "t",
        displayDocTitle: true,
        headings: ["Chapter"],
        roleMap: { Chapter: "H1" },
      }),
    );
    expect(report.facts.tags.H1).toBe(1);
    expect(report.issues.map((i) => i.check)).not.toContain("heading-order");
  });
});

describe("annotations", () => {
  it("flags a link with no description", async () => {
    expect(await checks(await makeGoodPdf({ withLink: true, tabsOrder: true }))).toContain("link-alt");
  });

  it("accepts a described link", async () => {
    const found = await checks(
      await makeGoodPdf({ withLink: true, linkContents: "Read the refund policy", tabsOrder: true }),
    );
    expect(found).not.toContain("link-alt");
  });

  it("flags a form field with no tooltip", async () => {
    const report = await checkPdf(await makeGoodPdf({ withWidget: true, tabsOrder: true }));
    expect(report.issues.find((i) => i.check === "form-field-label")?.message).toContain("customer_name");
  });

  it("flags a page with annotations but no tab order", async () => {
    const found = await checks(
      await makeGoodPdf({ withWidget: true, widgetTooltip: "Customer name", tabsOrder: false }),
    );
    expect(found).toContain("tab-order");
  });

  it("finds the tooltip on the parent field, not just on the widget", async () => {
    const found = await checks(
      await makeGoodPdf({
        withWidget: true,
        widgetOnParentField: true,
        widgetTooltip: "Customer name",
        tabsOrder: true,
      }),
    );
    expect(found).not.toContain("form-field-label");
  });

  it("still flags a grouped field with no tooltip anywhere", async () => {
    const report = await checkPdf(
      await makeGoodPdf({ withWidget: true, widgetOnParentField: true, tabsOrder: true }),
    );
    expect(report.issues.find((i) => i.check === "form-field-label")?.message).toContain("customer_name");
  });

  it("ignores a hidden annotation, which no reader announces", async () => {
    const found = await checks(
      await makeGoodPdf({ withWidget: true, withLink: true, annotFlags: 2, tabsOrder: false }),
    );
    expect(found).not.toContain("form-field-label");
    expect(found).not.toContain("link-alt");
    expect(found).not.toContain("tab-order");
  });

  it("accepts a page with tab order set", async () => {
    const found = await checks(
      await makeGoodPdf({ withWidget: true, widgetTooltip: "Customer name", tabsOrder: true }),
    );
    expect(found).not.toContain("tab-order");
  });
});

describe("engine", () => {
  it("respects a check override", async () => {
    const report = await checkPdf(await makePdf({ tagged: false }), { checks: { "struct-tree": "off" } });
    expect(report.issues.map((i) => i.check)).not.toContain("struct-tree");
  });

  it("raises severity under the pdf-ua profile", async () => {
    const bytes = await makeGoodPdf({ title: null });
    const recommended = await checkPdf(bytes, { profile: "recommended" });
    const strict = await checkPdf(bytes, { profile: "pdf-ua" });
    expect(recommended.issues.find((i) => i.check === "document-title")?.severity).toBe("warn");
    expect(strict.issues.find((i) => i.check === "document-title")?.severity).toBe("error");
  });

  it("counts errors and warnings to match the issues it returned", async () => {
    const report = await checkPdf(await makePdf({ tagged: false }));
    expect(report.errorCount).toBe(report.issues.filter((i) => i.severity === "error").length);
    expect(report.warningCount).toBe(report.issues.filter((i) => i.severity === "warn").length);
  });

  it("orders issues by page so the output reads top to bottom", async () => {
    const report = await checkPdf(await makeGoodPdf({ withWidget: true, withLink: true }));
    const pages = report.issues.map((i) => i.page ?? 0);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it("returns a read error instead of throwing on a file that is not a PDF", async () => {
    const report = await checkPdf(new TextEncoder().encode("this is not a pdf"));
    expect(report.readError ?? "").not.toBe("");
    expect(report.issues).toEqual([]);
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", async () => {
    const bytes = await makeGoodPdf();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const report = await checkPdf(buffer as ArrayBuffer, { profile: "pdf-ua" });
    expect(report.issues).toEqual([]);
  });
});
