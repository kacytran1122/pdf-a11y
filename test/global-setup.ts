import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * The CLI and worker tests run the built files, because that is what users get.
 * Building here keeps `vitest run` self contained without rebuilding when the
 * output is already newer than the sources.
 */
export default function setup(): void {
  let built = 0;
  try {
    built = statSync(CLI).mtimeMs;
  } catch {
    built = 0;
  }
  if (built > newestMtime(SRC)) return;
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    stdio: "inherit",
  });
}
