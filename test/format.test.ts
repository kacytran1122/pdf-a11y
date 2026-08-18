import { describe, expect, it } from "vitest";
import { formatGithub, formatJson, formatPretty } from "../src/format.js";
import type { Report } from "../src/types.js";

const ESC = "\u001b";

const report = (over: Partial<Report> = {}): Report => ({
  file: "out/invoice.pdf",
  issues: [],
  errorCount: 0,
  warningCount: 0,
  limitations: [],
  facts: {
    pages: 1,
    marked: true,
    tagged: true,
    lang: "en-GB",
    title: "Invoice",
    images: 0,
    figures: 0,
    tags: {},
    encrypted: false,
  },
  ...over,
});

describe("github annotations", () => {
  it("escapes newlines, which would otherwise cut the annotation short", () => {
    const out = formatGithub([
      report({
        issues: [{ check: "figure-alt", severity: "error", message: "line one\nline two\r\nend" }],
        errorCount: 1,
      }),
    ]);
    expect(out).not.toContain("\n");
    expect(out).toContain("line one%0Aline two%0D%0Aend");
  });

  it("escapes percent signs before anything else", () => {
    const out = formatGithub([
      report({ issues: [{ check: "figure-alt", severity: "warn", message: "100%0A not a newline" }] }),
    ]);
    expect(out).toContain("100%250A");
  });

  it("escapes commas and colons in property values", () => {
    const out = formatGithub([
      report({
        file: "out/a,b.pdf",
        issues: [{ check: "figure-alt", severity: "error", message: "x", clause: "WCAG 1.1.1", page: 2 }],
      }),
    ]);
    expect(out).toContain("file=out/a%2Cb.pdf");
    expect(out).toContain("title=figure-alt · page 2 · WCAG 1.1.1");
  });

  it("reports a file it could not read as a single line error annotation", () => {
    const out = formatGithub([report({ readError: "Cannot parse: bad\nxref" })]);
    expect(out).toMatch(/^::error /);
    expect(out).not.toContain("\n");
    expect(out).toContain("bad xref");
  });

  it("produces nothing for a clean run", () => {
    expect(formatGithub([report()])).toBe("");
  });
});

describe("pretty output", () => {
  it("leaves colour out when it is turned off", () => {
    const out = formatPretty([report()], { color: false });
    expect(out).not.toContain(ESC);
    expect(out).toContain("No accessibility problems found.");
  });

  it("uses colour when it is turned on", () => {
    expect(formatPretty([report()], { color: true })).toContain(ESC);
  });

  it.each([40, 60, 80, 120])("wraps to %i columns without overrunning", (width) => {
    // Single characters, so the greedy wrap has to fill each line right to the
    // edge. Anything wider than the indent it assumes shows up immediately.
    const message = "x ".repeat(400).trim();
    const out = formatPretty(
      [
        report({
          issues: [{ check: "figure-alt", severity: "error", message, clause: "WCAG 1.1.1", page: 3 }],
          errorCount: 1,
        }),
      ],
      { color: false, width },
    );
    const lines = out.split("\n").filter((line) => !line.startsWith("out/"));
    expect(lines.some((line) => line.length > width - 4)).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
  });

  it("does not paste a file name straight into the terminal either", () => {
    const out = formatPretty([report({ file: `${ESC}[2Jout/a.pdf` })], { color: false });
    expect(out).not.toContain(ESC);
  });

  it("shows what the run could not determine", () => {
    const out = formatPretty([report({ limitations: ["The file is encrypted."] })], { color: false });
    expect(out).toContain("note   The file is encrypted.");
  });

  it("shows a read error and no facts", () => {
    const out = formatPretty([report({ readError: "not a PDF" })], { color: false });
    expect(out).toContain("read error");
    expect(out).not.toContain("tagged");
  });

  it("counts errors and warnings across every file", () => {
    const out = formatPretty(
      [
        report({ issues: [{ check: "figure-alt", severity: "error", message: "a" }], errorCount: 1 }),
        report({ issues: [{ check: "tab-order", severity: "warn", message: "b" }], warningCount: 1 }),
      ],
      { color: false },
    );
    expect(out.trim().endsWith("1 error, 1 warning")).toBe(true);
  });

  it("does not paste document text straight into the terminal", () => {
    const out = formatPretty([report({ facts: { ...report().facts, lang: `${ESC}[2Jen` } })], {
      color: false,
    });
    expect(out).not.toContain(ESC);
  });
});

describe("json output", () => {
  it("is parseable and totals the counts", () => {
    const parsed = JSON.parse(
      formatJson([report({ errorCount: 2, warningCount: 1 }), report({ errorCount: 1 })]),
    ) as { errorCount: number; warningCount: number; reports: unknown[] };
    expect(parsed.errorCount).toBe(3);
    expect(parsed.warningCount).toBe(1);
    expect(parsed.reports).toHaveLength(2);
  });
});
