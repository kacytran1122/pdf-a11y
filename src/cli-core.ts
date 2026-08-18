import { availableParallelism } from "node:os";
import { createRequire } from "node:module";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CHECK_IDS, profiles } from "./index.js";
import { checkFiles, type FileJob } from "./pool.js";
import { formatGithub, formatJson, formatPretty } from "./format.js";
import type { CheckId, ProfileName, Severity } from "./types.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".cache"]);

const HELP = `
pdf-a11y  Accessibility checker for PDFs

Usage
  pdf-a11y <files or folders...> [options]

Options
  --profile <name>    recommended (default) or pdf-ua
  --check <id>=<sev>  Override one check. sev is off, warn or error. Repeatable.
  --format <name>     pretty (default), json or github
  --max-warnings <n>  Exit 1 when warnings exceed n. Default: unlimited
  --concurrency <n>   Files to check at once. Default: one per CPU, up to 8
  --quiet             Only report errors
  --no-color          Never colour the output. NO_COLOR is honoured too.
  --color             Always colour the output, even when piped.
  --checks            List every check and exit
  --version           Print the version and exit
  --help              Show this help
  --                  Treat everything after this as a path

Examples
  npx pdf-a11y invoice.pdf
  npx pdf-a11y ./out --profile pdf-ua
  npx pdf-a11y invoice.pdf --format json
  npx pdf-a11y ./out --check tab-order=off

Exit codes
  0  no errors
  1  at least one error, an unreadable file, or warnings above --max-warnings
  2  bad usage, for example an unknown option or a path that does not exist
`;

interface Cli {
  paths: string[];
  profile: ProfileName;
  checks: Partial<Record<CheckId, Severity>>;
  format: "pretty" | "json" | "github";
  maxWarnings: number;
  concurrency: number;
  quiet: boolean;
  color: boolean | undefined;
}

type Parsed = Cli | { help: true } | { listChecks: true } | { version: true };

class UsageError extends Error {}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new UsageError(`${flag} needs a value.`);
  return value;
}

function positiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`${flag} needs a whole number of 0 or more, got "${raw}".`);
  }
  return value;
}

/**
 * Applies one option that takes a value. Separated from the flag dispatch so
 * "which option is this" and "is this value usable" stay independently readable.
 */
function applyValueOption(cli: Cli, flag: string, value: string): void {
  switch (flag) {
    case "--profile":
      if (value !== "recommended" && value !== "pdf-ua") {
        throw new UsageError(`Unknown profile: ${value}. Use recommended or pdf-ua.`);
      }
      cli.profile = value;
      return;
    case "--format":
      if (value !== "pretty" && value !== "json" && value !== "github") {
        throw new UsageError(`Unknown format: ${value}. Use pretty, json or github.`);
      }
      cli.format = value;
      return;
    case "--max-warnings":
      cli.maxWarnings = positiveInt(value, flag);
      return;
    case "--concurrency":
      cli.concurrency = Math.max(1, positiveInt(value, flag));
      return;
    default: {
      const split = value.indexOf("=");
      if (split === -1) throw new UsageError(`--check needs <id>=<severity>, got "${value}".`);
      const id = value.slice(0, split);
      const severity: string = value.slice(split + 1);
      if (!CHECK_IDS.includes(id as CheckId)) {
        throw new UsageError(`Unknown check: ${id}. Run pdf-a11y --checks.`);
      }
      if (severity !== "off" && severity !== "warn" && severity !== "error") {
        throw new UsageError(`Unknown severity: ${severity}. Use off, warn or error.`);
      }
      cli.checks[id as CheckId] = severity satisfies Severity;
    }
  }
}

const VALUE_OPTIONS = new Set(["--profile", "--format", "--max-warnings", "--concurrency", "--check"]);

export function parseArgs(argv: readonly string[]): Parsed {
  const cli: Cli = {
    paths: [],
    profile: "recommended",
    checks: {},
    format: "pretty",
    maxWarnings: Number.POSITIVE_INFINITY,
    concurrency: defaultConcurrency(),
    quiet: false,
    color: undefined,
  };

  let pathsOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (pathsOnly) {
      cli.paths.push(arg);
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      applyValueOption(cli, arg, requireValue(argv, ++i, arg));
      continue;
    }
    switch (arg) {
      case "--":
        pathsOnly = true;
        break;
      case "--help":
      case "-h":
        return { help: true };
      case "--checks":
        return { listChecks: true };
      case "--version":
      case "-v":
        return { version: true };
      case "--quiet":
        cli.quiet = true;
        break;
      case "--no-color":
        cli.color = false;
        break;
      case "--color":
        cli.color = true;
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`Unknown option: ${arg}`);
        cli.paths.push(arg);
    }
  }

  if (cli.paths.length === 0) throw new UsageError("No PDF given. Run pdf-a11y --help.");
  return cli;
}

function defaultConcurrency(): number {
  try {
    return Math.max(1, Math.min(8, availableParallelism()));
  } catch {
    return 1;
  }
}

/**
 * Collects PDFs under the given paths.
 *
 * Results are sorted so two machines produce the same report order, and each
 * real path is visited once so a symlink loop or a repeated argument cannot
 * make the walk run forever or check a file twice.
 */
export function findPdfs(targets: readonly string[]): string[] {
  // Keyed by real path so a symlink or a repeated argument cannot produce the
  // same file twice; the value is the path the user would recognise.
  const found = new Map<string, string>();
  const visitedDirs = new Set<string>();

  const real = (path: string): string | null => {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  };

  // An explicit stack rather than recursion: a directory tree deep enough to
  // exhaust the call stack is a plausible thing to be pointed at by accident.
  const walk = (root: string): void => {
    const pending = [root];
    while (pending.length > 0) {
      const dir = pending.pop()!;
      const key = real(dir) ?? dir;
      if (visitedDirs.has(key)) continue;
      visitedDirs.add(key);

      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const child = join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const stats = statSync(child);
            isDirectory = stats.isDirectory();
            isFile = stats.isFile();
          } catch {
            continue;
          }
        }
        if (isDirectory) {
          if (!SKIP_DIRS.has(entry.name)) pending.push(child);
        } else if (isFile && entry.name.toLowerCase().endsWith(".pdf")) {
          remember(found, real(child), child);
        }
      }
    }
  };

  for (const target of targets) {
    const absolute = resolve(target);
    // statSync follows symlinks, so a link to a file or folder works.
    const stats = statSync(absolute);
    if (stats.isDirectory()) walk(absolute);
    else remember(found, real(absolute), absolute);
  }

  return [...found.values()].sort();
}

function remember(found: Map<string, string>, key: string | null, display: string): void {
  const id = key ?? display;
  if (!found.has(id)) found.set(id, display);
}

function write(stream: NodeJS.WriteStream, text: string): void {
  try {
    stream.write(text);
  } catch {
    // A closed pipe, for example `pdf-a11y ... | head`. Nothing to do.
  }
}

export async function run(argv: readonly string[]): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    write(process.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if ("help" in parsed) {
    write(process.stdout, `${HELP.trim()}\n`);
    return 0;
  }
  if ("version" in parsed) {
    write(process.stdout, `pdf-a11y ${version}\n`);
    return 0;
  }
  if ("listChecks" in parsed) {
    const rows = CHECK_IDS.map(
      (id) =>
        `${id.padEnd(20)} recommended: ${profiles.recommended[id].padEnd(6)} pdf-ua: ${profiles["pdf-ua"][id]}`,
    );
    write(process.stdout, `${rows.join("\n")}\n`);
    return 0;
  }

  const cli = parsed;
  let files: string[];
  try {
    files = findPdfs(cli.paths);
  } catch (error) {
    write(process.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if (files.length === 0) {
    write(process.stderr, "No PDF files found.\n");
    return 2;
  }

  const cwd = process.cwd();
  const jobs: FileJob[] = files.map((path) => ({ path, file: relative(cwd, path) || path }));

  let reports = await checkFiles(jobs, {
    concurrency: cli.concurrency,
    base: { profile: cli.profile, checks: cli.checks },
  });

  if (cli.quiet) {
    reports = reports.map((report) => ({
      ...report,
      issues: report.issues.filter((issue) => issue.severity === "error"),
      warningCount: 0,
    }));
  }

  const output =
    cli.format === "json"
      ? formatJson(reports)
      : cli.format === "github"
        ? formatGithub(reports)
        : formatPretty(reports, { color: cli.color });
  if (output.length > 0) write(process.stdout, `${output}\n`);

  let errors = 0;
  let warnings = 0;
  let unreadable = false;
  for (const report of reports) {
    errors += report.errorCount;
    warnings += report.warningCount;
    if (report.readError !== undefined) unreadable = true;
  }
  return errors > 0 || unreadable || warnings > cli.maxWarnings ? 1 : 0;
}
