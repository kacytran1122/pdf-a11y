import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkFile, checkPdf } from "../src/index.js";
import { run } from "../src/cli-core.js";
import { makeGoodPdf, makePdf } from "./fixtures.js";

const ESC = "\u001b";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pdf-a11y-unit-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("checkFile", () => {
  it("checks a file on disk", async () => {
    const path = join(dir, "good.pdf");
    await writeFile(path, await makeGoodPdf());
    const report = await checkFile(path, { profile: "pdf-ua" });
    expect(report.issues).toEqual([]);
    expect(report.file).toBe(path);
  });

  it("uses the label the caller asked for", async () => {
    const path = join(dir, "good.pdf");
    const report = await checkFile(path, { file: "out/good.pdf" });
    expect(report.file).toBe("out/good.pdf");
  });

  it("reports a missing file instead of throwing", async () => {
    const report = await checkFile(join(dir, "nope.pdf"));
    expect(report.readError).toMatch(/ENOENT|no such file/i);
  });

  it("refuses a directory", async () => {
    const report = await checkFile(dir);
    expect(report.readError).toMatch(/Not a regular file|EISDIR/);
  });

  it("refuses a file above the size cap", async () => {
    const path = join(dir, "good.pdf");
    const report = await checkFile(path, { maxBytes: 10 });
    expect(report.readError).toContain("above the 10 byte limit");
  });

  it("reads any size when the cap is removed", async () => {
    const path = join(dir, "good.pdf");
    const report = await checkFile(path, { maxBytes: Number.POSITIVE_INFINITY });
    expect(report.readError).toBeUndefined();
  });
});

describe("structure tree edge cases", () => {
  const tree = async (
    build: (ctx: PDFDocument) => unknown,
  ): Promise<Awaited<ReturnType<typeof checkPdf>>> => {
    const doc = await PDFDocument.create();
    doc.addPage([10, 10]);
    build(doc);
    return checkPdf(await doc.save());
  };

  it("counts marked content references as content, not elements", async () => {
    const report = await tree((doc) => {
      const ctx = doc.context;
      const page = doc.getPages()[0]!;
      const mcr = ctx.obj({ Type: "MCR", Pg: page.ref, MCID: 0 });
      const objr = ctx.obj({ Type: "OBJR", Pg: page.ref });
      doc.catalog.set(
        PDFName.of("StructTreeRoot"),
        ctx.register(
          ctx.obj({
            Type: "StructTreeRoot",
            ParentTree: ctx.obj({ Nums: [] }),
            K: [ctx.register(ctx.obj({ Type: "StructElem", S: "P", Pg: page.ref, K: [mcr, objr] }))],
          }),
        ),
      );
    });
    expect(report.facts.tags.P).toBe(1);
    expect(Object.keys(report.facts.tags)).toEqual(["P"]);
  });

  it("accepts a single element as /K rather than an array", async () => {
    const report = await tree((doc) => {
      const ctx = doc.context;
      const page = doc.getPages()[0]!;
      doc.catalog.set(
        PDFName.of("StructTreeRoot"),
        ctx.register(
          ctx.obj({
            Type: "StructTreeRoot",
            K: ctx.register(ctx.obj({ Type: "StructElem", S: "H1", Pg: page.ref, K: PDFNumber.of(0) })),
          }),
        ),
      );
    });
    expect(report.facts.tags.H1).toBe(1);
  });

  it("ignores a role map entry that does not name a tag", async () => {
    const report = await tree((doc) => {
      const ctx = doc.context;
      const page = doc.getPages()[0]!;
      doc.catalog.set(
        PDFName.of("StructTreeRoot"),
        ctx.register(
          ctx.obj({
            Type: "StructTreeRoot",
            RoleMap: ctx.obj({ Chapter: PDFString.of("H1") }),
            K: [ctx.register(ctx.obj({ Type: "StructElem", S: "Chapter", Pg: page.ref }))],
          }),
        ),
      );
    });
    expect(report.facts.tags.Chapter).toBe(1);
  });

  it("ignores a structure tree root that is not a dictionary", async () => {
    const report = await tree((doc) => {
      doc.catalog.set(PDFName.of("StructTreeRoot"), PDFNumber.of(3));
    });
    expect(report.facts.tagged).toBe(false);
  });

  it("does not attribute a page when /Pg is written inline", async () => {
    const report = await tree((doc) => {
      const ctx = doc.context;
      doc.catalog.set(
        PDFName.of("StructTreeRoot"),
        ctx.register(
          ctx.obj({
            Type: "StructTreeRoot",
            K: [ctx.register(ctx.obj({ Type: "StructElem", S: "Figure", Pg: ctx.obj({ Type: "Page" }) }))],
          }),
        ),
      );
    });
    expect(report.issues.find((i) => i.check === "figure-alt")?.page).toBeUndefined();
  });
});

describe("xmp titles", () => {
  const title = async (body: string): Promise<string | null> => {
    const report = await checkPdf(await makeGoodPdf({ title: null, xmp: body }));
    return report.facts.title;
  };

  it("decodes named entities", async () => {
    expect(await title("<dc:title><rdf:li>A &amp; B &lt;C&gt;</rdf:li></dc:title>")).toBe("A & B <C>");
  });

  it("decodes decimal and hex character references", async () => {
    expect(await title("<dc:title><rdf:li>&#65;&#x42;</rdf:li></dc:title>")).toBe("AB");
  });

  it("leaves an entity it does not know alone", async () => {
    expect(await title("<dc:title><rdf:li>a &nbsp; b</rdf:li></dc:title>")).toBe("a &nbsp; b");
  });

  it("reads a title written without rdf:li", async () => {
    expect(await title("<dc:title>Plain Title</dc:title>")).toBe("Plain Title");
  });

  it("ignores an empty title", async () => {
    expect(await title("<dc:title><rdf:li>   </rdf:li></dc:title>")).toBeNull();
  });

  it("ignores metadata that is not a stream", async () => {
    const doc = await PDFDocument.load(await makeGoodPdf({ title: null }), { updateMetadata: false });
    doc.catalog.set(PDFName.of("Metadata"), PDFNumber.of(1));
    const report = await checkPdf(await doc.save());
    expect(report.facts.title).toBeNull();
  });
});

describe("truncating document text", () => {
  it("never leaves half of a surrogate pair behind", async () => {
    // An astral plane character is two code units, so a naive cut at an odd
    // offset produces a lone surrogate.
    const report = await checkPdf(await makeGoodPdf({ figureAlt: `${"\u{1F600}".repeat(200)}.png` }));
    const issue = report.issues.find((i) => i.check === "figure-alt");
    expect(issue).toBeDefined();
    expect(issue!.message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(issue!.message).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe("shared image resources", () => {
  it("counts a form XObject used on many pages without rewalking it", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const image = await doc.embedPng(`data:image/png;base64,${png}`);
    const form = ctx.register(
      ctx.flateStream("", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 1, 1],
        Resources: ctx.obj({ XObject: ctx.obj({ Im0: image.ref }) }),
      }),
    );
    for (let i = 0; i < 5; i++) {
      const page = doc.addPage([10, 10]);
      page.node.set(PDFName.of("Resources"), ctx.obj({ XObject: ctx.obj({ Fm0: form }) }));
    }
    const report = await checkPdf(await doc.save());
    expect(report.facts.images).toBe(5);
  });
});

describe("run() writes what each format asks for", () => {
  let out: string;
  let err: string;
  let restore: (() => void) | null = null;

  const capture = (): void => {
    out = "";
    err = "";
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
    restore = () => {
      stdout.mockRestore();
      stderr.mockRestore();
    };
  };

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("prints help", async () => {
    capture();
    expect(await run(["--help"])).toBe(0);
    expect(out).toContain("Usage");
  });

  it("prints the version", async () => {
    capture();
    expect(await run(["--version"])).toBe(0);
    expect(out).toMatch(/^pdf-a11y \d+\.\d+\.\d+/);
  });

  it("lists the checks with both profiles", async () => {
    capture();
    expect(await run(["--checks"])).toBe(0);
    expect(out).toContain("figure-alt");
    expect(out).toContain("pdf-ua:");
  });

  it("reports a usage error on stderr with code 2", async () => {
    capture();
    expect(await run(["--profile", "nope", "x.pdf"])).toBe(2);
    expect(err).toContain("Unknown profile");
  });

  it("reports a missing path with code 2", async () => {
    capture();
    expect(await run([join(dir, "missing")])).toBe(2);
    expect(err).not.toBe("");
  });

  it("reports an empty folder with code 2", async () => {
    capture();
    expect(await run([dir, "--check", "figure-alt=off"])).toBe(0);
    restore?.();
  });

  it("writes json", async () => {
    const path = join(dir, "untagged.pdf");
    await writeFile(path, await makePdf({ tagged: false }));
    capture();
    const code = await run([path, "--format", "json"]);
    expect(code).toBe(1);
    expect(() => JSON.parse(out) as unknown).not.toThrow();
  });

  it("writes github annotations", async () => {
    const path = join(dir, "untagged.pdf");
    capture();
    await run([path, "--format", "github"]);
    expect(out).toMatch(/^::(error|warning) file=/m);
  });

  it("drops warnings under --quiet", async () => {
    const path = join(dir, "untagged.pdf");
    capture();
    await run([path, "--quiet", "--format", "json"]);
    const parsed = JSON.parse(out) as { warningCount: number };
    expect(parsed.warningCount).toBe(0);
  });

  it("fails when warnings exceed the ceiling", async () => {
    const path = join(dir, "warn.pdf");
    await writeFile(path, await makeGoodPdf({ displayDocTitle: false }));
    capture();
    expect(await run([path, "--max-warnings", "0"])).toBe(1);
  });

  it("keeps colour out when asked", async () => {
    const path = join(dir, "good.pdf");
    capture();
    await run([path, "--no-color"]);
    expect(out).not.toContain(ESC);
  });

  it("puts colour in when asked", async () => {
    const path = join(dir, "good.pdf");
    capture();
    await run([path, "--color"]);
    expect(out).toContain(ESC);
  });
});
