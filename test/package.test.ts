import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { makeGoodPdf } from "./fixtures.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  exports: Record<string, unknown>;
  main: string;
  module: string;
  types: string;
};

const NODE_BUILTIN = /^(node:|fs|path|os|url|module|worker_threads|child_process|crypto|stream|util)/;

/** Every local file the given entry pulls in, following relative imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      const spec = match[1]!;
      if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
    }
  };
  walk(entry);
  return [...seen];
}

function imports(files: string[]): string[] {
  const specs: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      specs.push(match[1]!);
    }
  }
  return specs;
}

describe("published files", () => {
  it("ships every file the manifest points at", () => {
    for (const target of [pkg.main, pkg.module, pkg.types, ...Object.values(pkg.bin)]) {
      expect(existsSync(resolve(root, target)), target).toBe(true);
    }
  });

  it("ships the worker the CLI starts by URL", () => {
    expect(existsSync(resolve(root, "dist/worker.js"))).toBe(true);
    expect(readFileSync(resolve(root, "dist/cli.js"), "utf8")).toContain("worker.js");
  });

  it("imports the library rather than shipping a second copy of the checker", () => {
    for (const entry of ["dist/cli.js", "dist/worker.js"]) {
      const source = readFileSync(resolve(root, entry), "utf8");
      expect(source, entry).toMatch(/from "\.\/index\.js"/);
      // The checker's own strings only exist in the library build.
      expect(source, entry).not.toContain("No structure tree.");
    }
  });

  it("keeps the shebang on the executable", () => {
    expect(readFileSync(resolve(root, "dist/cli.js"), "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("keeps the node: prefix on builtins, which edge runtimes require", () => {
    const source = readFileSync(resolve(root, "dist/index.js"), "utf8");
    expect(source).toContain('from "node:fs/promises"');
  });
});

describe("browser entry", () => {
  it("pulls in no node builtins", () => {
    for (const entry of ["dist/core.js", "dist/core.cjs"]) {
      const specs = imports(reachable(resolve(root, entry))).filter((s) => !s.startsWith("."));
      const builtins = specs.filter((s) => NODE_BUILTIN.test(s));
      expect(builtins, entry).toEqual([]);
    }
  });

  it("exports the checker and the profiles", async () => {
    const browser = (await import(pathToFileURL(resolve(root, "dist/core.js")).href)) as Record<
      string,
      unknown
    >;
    expect(typeof browser.checkPdf).toBe("function");
    expect(browser.profiles).toBeDefined();
    expect(Array.isArray(browser.CHECK_IDS)).toBe(true);
    expect(browser.checkFile).toBeUndefined();
  });
});

describe("built entries behave like the source", () => {
  it("works from ESM", async () => {
    const mod = (await import(pathToFileURL(resolve(root, "dist/index.js")).href)) as {
      checkPdf: (b: Uint8Array, o?: unknown) => Promise<{ issues: unknown[] }>;
    };
    const report = await mod.checkPdf(await makeGoodPdf(), { profile: "pdf-ua" });
    expect(report.issues).toEqual([]);
  });

  it("works from CommonJS", async () => {
    const mod = require(resolve(root, "dist/index.cjs")) as {
      checkPdf: (b: Uint8Array, o?: unknown) => Promise<{ issues: unknown[] }>;
      checkFile: unknown;
    };
    expect(typeof mod.checkFile).toBe("function");
    const report = await mod.checkPdf(await makeGoodPdf(), { profile: "pdf-ua" });
    expect(report.issues).toEqual([]);
  });
});
