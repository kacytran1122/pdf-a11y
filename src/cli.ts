#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CHECK_IDS, checkFile, profiles } from "./index.js";
import { formatGithub, formatJson, formatPretty } from "./format.js";
import type { CheckId, ProfileName, Report, Severity } from "./types.js";

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
  --quiet             Only report errors
  --checks            List every check and exit
  --help              Show this help

Examples
  npx pdf-a11y invoice.pdf
  npx pdf-a11y ./out --profile pdf-ua
  npx pdf-a11y invoice.pdf --format json
  npx pdf-a11y ./out --check tab-order=off

Exit code is 1 when there is at least one error.
`;

interface Cli {
  paths: string[];
  profile: ProfileName;
  checks: Partial<Record<CheckId, Severity>>;
  format: "pretty" | "json" | "github";
  maxWarnings: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Cli | { help: true } | { listChecks: true } {
  const cli: Cli = {
    paths: [],
    profile: "recommended",
    checks: {},
    format: "pretty",
    maxWarnings: Number.POSITIVE_INFINITY,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        return { help: true };
      case "--checks":
        return { listChecks: true };
      case "--quiet":
        cli.quiet = true;
        break;
      case "--profile": {
        const value = argv[++i];
        if (value !== "recommended" && value !== "pdf-ua") throw new Error(`Unknown profile: ${value}`);
        cli.profile = value;
        break;
      }
      case "--format": {
        const value = argv[++i];
        if (value !== "pretty" && value !== "json" && value !== "github") {
          throw new Error(`Unknown format: ${value}`);
        }
        cli.format = value;
        break;
      }
      case "--max-warnings":
        cli.maxWarnings = Number(argv[++i]);
        break;
      case "--check": {
        const [id, severity] = (argv[++i] ?? "").split("=") as [CheckId, Severity];
        if (!CHECK_IDS.includes(id)) throw new Error(`Unknown check: ${id}`);
        if (!["off", "warn", "error"].includes(severity)) throw new Error(`Unknown severity: ${severity}`);
        cli.checks[id] = severity;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        cli.paths.push(arg);
    }
  }

  if (cli.paths.length === 0) throw new Error("No PDF given. Run pdf-a11y --help.");
  return cli;
}

function findPdfs(target: string, out: string[] = []): string[] {
  const stats = statSync(target);
  if (stats.isFile()) {
    out.push(target);
    return out;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findPdfs(join(target, entry.name), out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      out.push(join(target, entry.name));
    }
  }
  return out;
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  if ("help" in parsed) {
    console.log(HELP.trim());
    return;
  }
  if ("listChecks" in parsed) {
    for (const id of CHECK_IDS) {
      console.log(`${id.padEnd(20)} recommended: ${profiles.recommended[id].padEnd(6)} pdf-ua: ${profiles["pdf-ua"][id]}`);
    }
    return;
  }

  const cli = parsed;
  const files: string[] = [];
  try {
    for (const path of cli.paths) findPdfs(resolve(path), files);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  if (files.length === 0) {
    console.error("No PDF files found.");
    process.exit(2);
  }

  const reports: Report[] = [];
  for (const file of files) {
    const report = await checkFile(file, {
      file: relative(process.cwd(), file),
      profile: cli.profile,
      checks: cli.checks,
    });
    if (cli.quiet) {
      report.issues = report.issues.filter((i) => i.severity === "error");
      report.warningCount = 0;
    }
    reports.push(report);
  }

  const output =
    cli.format === "json"
      ? formatJson(reports)
      : cli.format === "github"
        ? formatGithub(reports)
        : formatPretty(reports);
  if (output) console.log(output);

  const errors = reports.reduce((n, r) => n + r.errorCount, 0);
  const warnings = reports.reduce((n, r) => n + r.warningCount, 0);
  const failedToRead = reports.some((r) => r.readError);
  process.exit(errors > 0 || failedToRead || warnings > cli.maxWarnings ? 1 : 0);
}

void main();
