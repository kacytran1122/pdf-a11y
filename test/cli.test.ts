import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPdfs, parseArgs, run } from "../src/cli-core.js";
import { makeGoodPdf, makePdf } from "./fixtures.js";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pdf-a11y-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(args: string[], options: { maxBuffer?: number } = {}): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: dir,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("argument parsing", () => {
  it("takes paths and defaults", () => {
    const parsed = parseArgs(["a.pdf", "b.pdf"]);
    expect(parsed).toMatchObject({ paths: ["a.pdf", "b.pdf"], profile: "recommended", format: "pretty" });
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["--nope", "a.pdf"])).toThrow(/Unknown option/);
  });

  it("rejects an unknown profile", () => {
    expect(() => parseArgs(["--profile", "strict", "a.pdf"])).toThrow(/Unknown profile/);
  });

  it("rejects an unknown check id", () => {
    expect(() => parseArgs(["--check", "not-a-check=off", "a.pdf"])).toThrow(/Unknown check/);
  });

  it("rejects a check with no severity", () => {
    expect(() => parseArgs(["--check", "tab-order", "a.pdf"])).toThrow(/needs <id>=<severity>/);
  });

  it("rejects an unknown severity", () => {
    expect(() => parseArgs(["--check", "tab-order=loud", "a.pdf"])).toThrow(/Unknown severity/);
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["a.pdf", "--profile"])).toThrow(/needs a value/);
  });

  it("rejects a max-warnings that is not a number", () => {
    expect(() => parseArgs(["--max-warnings", "lots", "a.pdf"])).toThrow(/whole number/);
  });

  it("rejects a negative max-warnings", () => {
    expect(() => parseArgs(["--max-warnings", "-1", "a.pdf"])).toThrow(/whole number/);
  });

  it("accepts zero max-warnings", () => {
    expect(parseArgs(["--max-warnings", "0", "a.pdf"])).toMatchObject({ maxWarnings: 0 });
  });

  it("requires at least one path", () => {
    expect(() => parseArgs([])).toThrow(/No PDF given/);
  });

  it("treats everything after -- as a path", () => {
    expect(parseArgs(["--", "--weird-name.pdf"])).toMatchObject({ paths: ["--weird-name.pdf"] });
  });

  it("returns the help request rather than a config", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs(["-h"])).toEqual({ help: true });
    expect(parseArgs(["--version"])).toEqual({ version: true });
    expect(parseArgs(["--checks"])).toEqual({ listChecks: true });
  });
});

describe("finding files", () => {
  let root: string;

  beforeAll(async () => {
    root = join(dir, "walk");
    await mkdir(join(root, "nested"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "b.pdf"), await makeGoodPdf());
    await writeFile(join(root, "a.PDF"), await makeGoodPdf());
    await writeFile(join(root, "notes.txt"), "hello");
    await writeFile(join(root, "nested", "c.pdf"), await makeGoodPdf());
    await writeFile(join(root, "node_modules", "skip.pdf"), await makeGoodPdf());
  });

  it("finds PDFs recursively, case insensitively, and skips node_modules", () => {
    const found = findPdfs([root]).map((p) => relative(root, p).split(sep).join("/"));
    expect(found).toEqual(["a.PDF", "b.pdf", "nested/c.pdf"]);
  });

  it("returns the same order every time", () => {
    expect(findPdfs([root])).toEqual(findPdfs([root]));
  });

  it("checks a file only once when a path is given twice", () => {
    expect(findPdfs([root, root])).toHaveLength(3);
  });

  it("does not loop forever on a symlinked directory cycle", async () => {
    const loop = join(dir, "loop");
    await mkdir(loop, { recursive: true });
    await writeFile(join(loop, "x.pdf"), await makeGoodPdf());
    await symlink(loop, join(loop, "self"), "dir").catch(() => {});
    expect(findPdfs([loop])).toHaveLength(1);
  });

  it("throws for a path that does not exist", () => {
    expect(() => findPdfs([join(dir, "nowhere")])).toThrow();
  });
});

describe("exit codes", () => {
  beforeAll(async () => {
    await writeFile(join(dir, "clean.pdf"), await makeGoodPdf());
    await writeFile(join(dir, "broken.pdf"), await makePdf({ tagged: false }));
    await writeFile(join(dir, "warnonly.pdf"), await makeGoodPdf({ displayDocTitle: false }));
    await writeFile(join(dir, "notpdf.pdf"), "definitely not a pdf");
  });

  it("is 0 for a clean file", async () => {
    const result = await cli(["clean.pdf"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No accessibility problems found.");
  });

  it("is 1 when there is an error", async () => {
    expect((await cli(["broken.pdf"])).code).toBe(1);
  });

  it("is 0 for warnings by default", async () => {
    expect((await cli(["warnonly.pdf"])).code).toBe(0);
  });

  it("is 1 for warnings above --max-warnings", async () => {
    expect((await cli(["warnonly.pdf", "--max-warnings", "0"])).code).toBe(1);
  });

  it("is 1 for a file that cannot be read", async () => {
    const result = await cli(["notpdf.pdf"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("read error");
  });

  it("is 2 for a bad option", async () => {
    const result = await cli(["--nope", "clean.pdf"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown option");
  });

  it("is 2 for a path that does not exist", async () => {
    expect((await cli(["nowhere.pdf"])).code).toBe(2);
  });

  it("is 0 for --version, --help and --checks", async () => {
    const version = await cli(["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^pdf-a11y \d+\.\d+\.\d+/);
    expect((await cli(["--help"])).code).toBe(0);
    const checks = await cli(["--checks"]);
    expect(checks.code).toBe(0);
    expect(checks.stdout).toContain("parent-tree");
  });
});

describe("output", () => {
  // Writes 120 files and spawns the CLI over them, which is slow enough on a
  // shared runner to need more than the 5s default.
  it("writes complete JSON to a pipe, however large", async () => {
    const many = join(dir, "many");
    await mkdir(many, { recursive: true });
    const bytes = await makePdf({ tagged: false, withWidget: true, withLink: true });
    for (let i = 0; i < 120; i++) await writeFile(join(many, `f${i}.pdf`), bytes);

    const result = await cli(["many", "--format", "json"]);
    expect(result.code).toBe(1);
    // Truncated output would throw here. This is the regression test for a
    // process.exit() that discarded whatever stdout had not flushed.
    const parsed = JSON.parse(result.stdout) as { reports: unknown[] };
    expect(parsed.reports).toHaveLength(120);
    expect(result.stdout.length).toBeGreaterThan(200_000);
  }, 30_000);

  it("produces github annotations, one per line", async () => {
    const result = await cli(["broken.pdf", "--format", "github"]);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line).toMatch(/^::(error|warning) file=/);
  });

  it("drops warnings under --quiet", async () => {
    const result = await cli(["broken.pdf", "--quiet", "--format", "json"]);
    const parsed = JSON.parse(result.stdout) as { warningCount: number; reports: { issues: [] }[] };
    expect(parsed.warningCount).toBe(0);
  });

  it("honours a check override from the command line", async () => {
    const result = await cli(["broken.pdf", "--check", "struct-tree=off", "--format", "json"]);
    const parsed = JSON.parse(result.stdout) as { reports: { issues: { check: string }[] }[] };
    expect(parsed.reports[0]!.issues.map((i) => i.check)).not.toContain("struct-tree");
  });

  it("leaves colour out when NO_COLOR is set", async () => {
    const result = await cli(["clean.pdf"]);
    expect(result.stdout).not.toContain("\u001b");
  });
});

describe("run() as a function", () => {
  it("returns the exit code rather than ending the process", async () => {
    const code = await run([join(dir, "clean.pdf")]);
    expect(code).toBe(0);
  });
});
