import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { checkPdf } from "../src/index.js";
import {
  makeCyclicPdf,
  makeDeepPdf,
  makeEncryptedPdf,
  makeGoodPdf,
  makeIdenticalPagesPdf,
  makeInheritedResourcesPdf,
  makePdf,
} from "./fixtures.js";

describe("hostile and damaged files", () => {
  // Building and parsing a 20,000 object document is genuinely slow — about a
  // second here, several times that on a shared CI runner under coverage — so
  // it gets a real budget rather than the 5s default. The assertion is
  // unchanged: the old recursive reader threw a RangeError here.
  it("reads a structure tree nested 20000 deep without blowing the stack", async () => {
    const report = await checkPdf(await makeDeepPdf(20_000));
    expect(report.readError).toBeUndefined();
    expect(report.facts.tagged).toBe(true);
    expect(report.facts.tags.Div).toBe(20_000);
    expect(report.limitations).toEqual([]);
  }, 30_000);

  it("terminates on a structure tree that points back at itself", async () => {
    const report = await checkPdf(await makeCyclicPdf());
    expect(report.readError).toBeUndefined();
    expect(report.facts.tags.Div).toBe(2);
  });

  it("stops at the element limit and says so", async () => {
    const report = await checkPdf(await makeDeepPdf(500), { limits: { maxNodes: 10 } });
    expect(report.readError).toBeUndefined();
    expect(report.limitations?.join(" ")).toContain("larger than the configured limit");
  });

  it("stops at the depth limit and says so", async () => {
    const report = await checkPdf(await makeDeepPdf(500), { limits: { maxDepth: 5 } });
    expect(report.limitations?.join(" ")).toContain("larger than the configured limit");
    expect(report.facts.tags.Div).toBe(6);
  });

  it("ignores limits that are not usable numbers", async () => {
    const report = await checkPdf(await makeGoodPdf(), {
      limits: { maxNodes: Number.NaN, maxDepth: -3 },
      profile: "pdf-ua",
    });
    expect(report.issues).toEqual([]);
  });

  it("returns a read error rather than throwing on random bytes", async () => {
    const report = await checkPdf(new Uint8Array([1, 2, 3, 4, 5]));
    expect(report.readError).toBeDefined();
    expect(report.facts.pages).toBe(0);
  });

  it("returns a read error on an empty input", async () => {
    const report = await checkPdf(new Uint8Array(0));
    expect(report.readError).toBeDefined();
  });

  it("survives a file cut in half", async () => {
    const whole = await makeGoodPdf();
    const report = await checkPdf(whole.slice(0, Math.floor(whole.length / 2)));
    expect(() => report).not.toThrow();
    expect(typeof report.file).toBe("string");
  });

  it("does not write parser complaints to the console", async () => {
    const whole = await makeGoodPdf();
    const half = whole.slice(0, Math.floor(whole.length / 2));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await checkPdf(half);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("hands parser complaints to the caller when asked", async () => {
    const whole = await makeGoodPdf();
    const half = whole.slice(0, Math.floor(whole.length / 2));
    const warnings: string[] = [];
    await checkPdf(half, { onParserWarning: (m) => warnings.push(m) });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("puts the console back afterwards", async () => {
    const before = console.warn;
    await checkPdf(await makeGoodPdf());
    expect(console.warn).toBe(before);
  });

  it("puts the console back after concurrent checks", async () => {
    const before = console.warn;
    const bytes = await makeGoodPdf();
    await Promise.all([checkPdf(bytes), checkPdf(bytes), checkPdf(bytes)]);
    expect(console.warn).toBe(before);
  });
});

describe("the library's effect on its host", () => {
  it("lets the surrounding application keep using console.warn during a parse", async () => {
    const seen: unknown[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      seen.push(args.join(" "));
    });
    try {
      const whole = await makeGoodPdf();
      const half = whole.slice(0, Math.floor(whole.length / 2));
      const check = checkPdf(half);
      console.warn("application log line");
      await check;
      expect(seen).toContain("application log line");
      expect(seen.join(" ")).not.toContain("Trying to parse invalid object");
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the recommended profile when handed a name it does not know", async () => {
    const report = await checkPdf(await makePdf({ tagged: false }), {
      profile: "strict" as never,
    });
    expect(report.issues.map((i) => i.check)).toContain("struct-tree");
    expect(report.errorCount).toBeGreaterThan(0);
  });

  it("does not read an unbounded amount of highly compressible metadata", async () => {
    // 8 MB of one repeated character compresses to a few kilobytes. Decoding
    // it whole before checking the size is how a small file becomes a large
    // heap. A wall clock assertion would be flaky on a shared runner, so what
    // is checked is that the read stopped: the title never comes back, because
    // the closing tag is past the cap.
    const doc = await PDFDocument.load(await makeGoodPdf({ title: null }), { updateMetadata: false });
    const bomb = `<dc:title><rdf:li>${"a".repeat(8 * 1024 * 1024)}</rdf:li></dc:title>`;
    doc.catalog.set(
      PDFName.of("Metadata"),
      doc.context.register(doc.context.flateStream(bomb, { Type: "Metadata", Subtype: "XML" })),
    );
    const bytes = await doc.save();
    expect(bytes.length).toBeLessThan(200_000);

    const report = await checkPdf(bytes);
    expect(report.readError).toBeUndefined();
    expect(report.facts.title).toBeNull();
    expect(report.issues.map((i) => i.check)).toContain("document-title");
  }, 30_000);
});

describe("page identity", () => {
  it("reports an issue against the page it is on, not a page that looks the same", async () => {
    const report = await checkPdf(await makeIdenticalPagesPdf(5));
    expect(report.facts.pages).toBe(5);
    expect(report.issues.find((i) => i.check === "figure-alt")?.page).toBe(1);
  });
});

describe("images", () => {
  it("finds images through resources inherited from the page tree", async () => {
    const report = await checkPdf(await makeInheritedResourcesPdf());
    expect(report.facts.images).toBe(1);
  });

  it("terminates on a form XObject that contains itself", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const page = doc.addPage([10, 10]);
    const formRef = ctx.nextRef();
    const resources = ctx.obj({ XObject: ctx.obj({ Fm0: formRef }) });
    ctx.assign(
      formRef,
      ctx.flateStream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1], Resources: resources }),
    );
    page.node.set(PDFName.of("Resources"), ctx.obj({ XObject: ctx.obj({ Fm0: formRef }) }));

    const report = await checkPdf(await doc.save());
    expect(report.readError).toBeUndefined();
    expect(report.facts.images).toBe(0);
  });
});

describe("encryption", () => {
  it("flags flags that block extraction", async () => {
    // -1 with bit 5 (copy) and bit 10 (extract for accessibility) cleared.
    const report = await checkPdf(await makeEncryptedPdf(-1 & ~16 & ~512));
    const issue = report.issues.find((i) => i.check === "extraction-allowed");
    expect(issue?.message).toContain("block content extraction");
    expect(report.facts.encrypted).toBe(true);
  });

  it("stays quiet when the flags allow extraction for accessibility", async () => {
    const report = await checkPdf(await makeEncryptedPdf(-1 & ~16));
    expect(report.issues.map((i) => i.check)).not.toContain("extraction-allowed");
  });

  it("stays quiet when the flags allow copying outright", async () => {
    const report = await checkPdf(await makeEncryptedPdf(-1));
    expect(report.issues.map((i) => i.check)).not.toContain("extraction-allowed");
  });

  it("treats a revision 2 file as blocked when the copy bit is clear", async () => {
    const report = await checkPdf(await makeEncryptedPdf(-1 & ~16, 2));
    expect(report.issues.map((i) => i.check)).toContain("extraction-allowed");
  });

  it("says so when the permission flags cannot be read", async () => {
    const report = await checkPdf(await makeEncryptedPdf(null));
    const issue = report.issues.find((i) => i.check === "extraction-allowed");
    expect(issue?.message).toContain("could not be read");
  });

  it("records that text values could not be decoded", async () => {
    const report = await checkPdf(await makeEncryptedPdf(-1));
    expect(report.limitations?.join(" ")).toContain("encrypted");
  });

  it("does not judge a language value it cannot decode", async () => {
    const doc = await PDFDocument.load(await makeGoodPdf(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    // Same document, but declared encrypted: the /Lang string is now ciphertext
    // as far as the reader is concerned, so its shape must not be judged.
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: "Standard", V: 2, R: 3, P: -1 } as never),
    );
    const report = await checkPdf(await doc.save());
    expect(report.issues.map((i) => i.check)).not.toContain("document-lang");
  });
});

const ESC = "\u001b";
// Asserting control characters are gone needs a pattern that matches them.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]");

describe("untrusted document text", () => {
  it("strips terminal escapes out of alt text before it reaches a message", async () => {
    const report = await checkPdf(await makeGoodPdf({ figureAlt: `${ESC}[2Jchart.png` }));
    const issue = report.issues.find((i) => i.check === "figure-alt");
    expect(issue).toBeDefined();
    expect(issue?.message).not.toMatch(CONTROL);
  });

  it("caps how much document text can be pushed into a message", async () => {
    const long = `${"a".repeat(5000)}.png`;
    const report = await checkPdf(await makeGoodPdf({ figureAlt: long }));
    const issue = report.issues.find((i) => i.check === "figure-alt");
    expect(issue?.message.length).toBeLessThan(300);
  });

  it("caps a form field name too", async () => {
    const report = await checkPdf(
      await makeGoodPdf({ withWidget: true, widgetName: "n".repeat(5000), tabsOrder: true }),
    );
    const issue = report.issues.find((i) => i.check === "form-field-label");
    expect(issue?.message.length).toBeLessThan(200);
  });

  it("does not let a structure tag reach Object.prototype", async () => {
    const report = await checkPdf(await makeGoodPdf({ extraTags: ["__proto__", "constructor"] }));
    expect(report.facts.tags.__proto__).toBe(1);
    expect(report.facts.tags.constructor).toBe(1);
    expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(report.facts.tags)).constructor).toBe(1);
  });

  it("does not spend unbounded time on a huge language value", async () => {
    const report = await checkPdf(await makeGoodPdf({ lang: `en-${"a".repeat(100_000)}` }));
    const issue = report.issues.find((i) => i.check === "document-lang");
    expect(issue?.message.length).toBeLessThan(200);
  });
});

describe("empty and minimal documents", () => {
  it("handles a document with nothing in it", async () => {
    const doc = await PDFDocument.create();
    const report = await checkPdf(await doc.save());
    expect(report.readError).toBeUndefined();
    expect(report.facts.tagged).toBe(false);
    expect(report.issues.map((i) => i.check)).toContain("struct-tree");
  });

  it("handles a structure tree root with an empty /K", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([10, 10]);
    doc.catalog.set(
      PDFName.of("StructTreeRoot"),
      doc.context.register(doc.context.obj({ Type: "StructTreeRoot", K: [] })),
    );
    const report = await checkPdf(await doc.save());
    expect(report.facts.tagged).toBe(false);
  });

  it("ignores structure elements with no /S tag", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const page = doc.addPage([10, 10]);
    doc.catalog.set(
      PDFName.of("StructTreeRoot"),
      ctx.register(
        ctx.obj({
          Type: "StructTreeRoot",
          K: [ctx.register(ctx.obj({ Type: "StructElem", Pg: page.ref } as never))],
        } as never),
      ),
    );
    const report = await checkPdf(await doc.save());
    expect(report.facts.tagged).toBe(false);
  });

  it("does not attribute a page number when /Pg points nowhere useful", async () => {
    const report = await checkPdf(await makePdf({ tagged: true, headings: ["H2"] }));
    const issue = report.issues.find((i) => i.check === "heading-order");
    expect(issue?.page).toBe(1);
  });
});
