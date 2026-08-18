import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts", core: "src/core.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node18",
    // tsup strips the `node:` prefix by default. Keeping it is what lets Deno,
    // Bun and edge bundlers resolve the builtins at all.
    removeNodeProtocol: false,
  },
  {
    // The CLI and the worker it starts share one build, and both import the
    // library at runtime rather than bundling a second copy of the checker.
    // The relative specifier is the same in src/ and in dist/, so leaving it
    // external resolves to dist/index.js once installed.
    entry: { cli: "src/cli.ts", worker: "src/worker.ts" },
    format: ["esm"],
    external: ["./index.js"],
    splitting: true,
    clean: false,
    // No source map: nobody steps through a bin, and it is a third of the
    // published package.
    sourcemap: false,
    target: "node18",
    removeNodeProtocol: false,
  },
]);
