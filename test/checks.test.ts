import { describe, expect, it } from "vitest";
import { checkPdf } from "../src/index.js";
import type { CheckId } from "../src/types.js";
import { makeGoodPdf, makePdf } from "./fixtures.js";

const checks = async (bytes: Uint8Array, profile: "recommended" | "pdf-ua" = "recommended"): Promise<CheckId[]> => {
  const report = await checkPdf(bytes, { profile });
  return report.issues.map((i) => i.check);
};

describe("control document", () => {
  it("passes every check", async () => {
    const report = await checkPdf(await makeGoodPdf(), { profile: "pdf-ua" });
    expect(report.issues).toEqual([]);
    expect(report.errorCount).toBe(0);
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
    const issue = report.issues.find((i) => i.check === "struct-tree");
    expect(issue?.severity).toBe("error");
  });
});

describe("document-lang", () => {
  it("flags a missing language", async () => {
    const found = await checks(await makeGoodPdf({ lang: null }));
    expect(found).toContain("document-lang");
  });

  it("flags a language that is not a real tag", async () => {
    const report = await checkPdf(await makeGoodPdf({ lang: "English" }));
    const issue = report.issues.find((i) => i.check === "document-lang");
    expect(issue?.message).toContain("well formed");
  });

  it("accepts a plain two letter tag", async () => {
    const found = await checks(await makeGoodPdf({ lang: "vi" }));
    expect(found).not.toContain("document-lang");
  });
});

describe("document-title", () => {
  it("flags a missing title", async () => {
    const found = await checks(await makeGoodPdf({ title: null }));
    expect(found).toContain("document-title");
  });

  it("flags a title that will not be displayed", async () => {
    const report = await checkPdf(await makeGoodPdf({ displayDocTitle: false }));
    const issue = report.issues.find((i) => i.check === "document-title");
    expect(issue?.message).toContain("DisplayDocTitle");
  });
});

describe("figure-alt", () => {
  it("flags a figure with no alt text", async () => {
    const found = await checks(await makeGoodPdf({ figureAlt: null }));
    expect(found).toContain("figure-alt");
  });

  it("flags alt text that says nothing", async () => {
    const report = await checkPdf(await makeGoodPdf({ figureAlt: "image" }));
    const issue = report.issues.find((i) => i.check === "figure-alt");
    expect(issue?.message).toContain("describes nothing");
  });

  it("flags a file name used as alt text", async () => {
    const found = await checks(await makeGoodPdf({ figureAlt: "chart-final-v2.png" }));
    expect(found).toContain("figure-alt");
  });

  it("accepts a real description", async () => {
    const found = await checks(await makeGoodPdf({ figureAlt: "Line chart of revenue by quarter" }));
    expect(found).not.toContain("figure-alt");
  });

  it("records the page the figure sits on", async () => {
    const report = await checkPdf(await makeGoodPdf({ figureAlt: null }));
    const issue = report.issues.find((i) => i.check === "figure-alt");
    expect(issue?.page).toBe(1);
  });
});

describe("untagged-image", () => {
  it("flags an image with no matching Figure element", async () => {
    const bytes = await makePdf({ tagged: true, withImage: true, headings: ["H1"] });
    const report = await checkPdf(bytes);
    const issue = report.issues.find((i) => i.check === "untagged-image");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("1 image");
  });
});

describe("table-headers", () => {
  it("flags a table with no header cells", async () => {
    const bytes = await makeGoodPdf({ withTable: true, tableHeaders: false });
    expect(await checks(bytes)).toContain("table-headers");
  });

  it("accepts a table with header cells", async () => {
    const bytes = await makeGoodPdf({ withTable: true, tableHeaders: true });
    expect(await checks(bytes)).not.toContain("table-headers");
  });
});

describe("heading-order", () => {
  it("flags a skipped level", async () => {
    const report = await checkPdf(await makeGoodPdf({ headings: ["H1", "H3"] }));
    const issue = report.issues.find((i) => i.check === "heading-order");
    expect(issue?.message).toContain("H1 to H3");
  });

  it("flags a document that does not start at H1", async () => {
    const report = await checkPdf(await makeGoodPdf({ headings: ["H2", "H3"] }));
    const issue = report.issues.find((i) => i.check === "heading-order");
    expect(issue?.message).toContain("first heading");
  });

  it("accepts a clean outline", async () => {
    const found = await checks(await makeGoodPdf({ headings: ["H1", "H2", "H3", "H2"] }));
    expect(found).not.toContain("heading-order");
  });
});

describe("annotations", () => {
  it("flags a link with no description", async () => {
    const found = await checks(await makeGoodPdf({ withLink: true, tabsOrder: true }));
    expect(found).toContain("link-alt");
  });

  it("accepts a described link", async () => {
    const found = await checks(
      await makeGoodPdf({ withLink: true, linkContents: "Read the refund policy", tabsOrder: true }),
    );
    expect(found).not.toContain("link-alt");
  });

  it("flags a form field with no tooltip", async () => {
    const report = await checkPdf(await makeGoodPdf({ withWidget: true, tabsOrder: true }));
    const issue = report.issues.find((i) => i.check === "form-field-label");
    expect(issue?.message).toContain("customer_name");
  });

  it("flags a page with annotations but no tab order", async () => {
    const found = await checks(
      await makeGoodPdf({ withWidget: true, widgetTooltip: "Customer name", tabsOrder: false }),
    );
    expect(found).toContain("tab-order");
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
    const bytes = await makePdf({ tagged: false });
    const report = await checkPdf(bytes, { checks: { "struct-tree": "off" } });
    expect(report.issues.map((i) => i.check)).not.toContain("struct-tree");
  });

  it("raises severity under the pdf-ua profile", async () => {
    const bytes = await makeGoodPdf({ title: null });
    const recommended = await checkPdf(bytes, { profile: "recommended" });
    const strict = await checkPdf(bytes, { profile: "pdf-ua" });
    expect(recommended.issues.find((i) => i.check === "document-title")?.severity).toBe("warn");
    expect(strict.issues.find((i) => i.check === "document-title")?.severity).toBe("error");
  });

  it("returns a read error instead of throwing on a file that is not a PDF", async () => {
    const report = await checkPdf(new TextEncoder().encode("this is not a pdf"));
    expect(report.readError ?? "").not.toBe("");
    expect(report.issues).toEqual([]);
  });
});
