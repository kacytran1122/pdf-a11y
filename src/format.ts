import { quote } from "./text.js";
import type { Issue, Report } from "./types.js";

export interface FormatOptions {
  /** Force colour on or off. Defaults to what the terminal supports. */
  color?: boolean;
  /** Wrap width for the pretty output. Defaults to the terminal width. */
  width?: number;
}

/**
 * Decided per call rather than at import, so a process that reassigns stdout,
 * or a test that sets NO_COLOR, gets the answer it expects.
 */
/** `undefined` outside Node, where this formatter may still be imported. */
const host = (): NodeJS.Process | undefined => (typeof process === "undefined" ? undefined : process);

function colorEnabled(override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  const env = host()?.env ?? {};
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return host()?.stdout.isTTY ?? false;
}

function terminalWidth(override: number | undefined): number {
  if (override !== undefined && Number.isFinite(override)) return Math.max(40, Math.floor(override));
  const columns = host()?.stdout.columns;
  return Math.max(40, Math.min(120, columns !== undefined && Number.isFinite(columns) ? columns : 80));
}

type Paint = (code: string, text: string) => string;

/** Written as an escape rather than a literal so the source stays plain ASCII. */
const ESC = "\u001b";

const GUTTER = 6;
// Two spaces, the page gutter, a space, the five column badge, two spaces.
const BODY_INDENT = GUTTER + 10;

/** Greedy wrap. Words longer than the width are left alone rather than cut. */
function wrap(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function factsLine(report: Report): string {
  const f = report.facts;
  const parts = [
    `${f.pages} page${f.pages === 1 ? "" : "s"}`,
    f.tagged ? "tagged" : "untagged",
    f.lang ? `lang ${quote(f.lang, 32)}` : "no lang",
    `${f.images} image${f.images === 1 ? "" : "s"}`,
  ];
  if (f.encrypted) parts.push("encrypted");
  return parts.join("  ·  ");
}

/**
 * The file name is never wrapped or truncated: a path that has been cut in half
 * is no longer something the reader can act on. Every other line fits `width`.
 */
export function formatPretty(reports: Report[], options: FormatOptions = {}): string {
  const useColor = colorEnabled(options.color);
  const paint: Paint = (code, text) => (useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text);
  const dim = (t: string) => paint("2", t);
  const red = (t: string) => paint("31", t);
  const yellow = (t: string) => paint("33", t);
  const green = (t: string) => paint("32", t);
  const bold = (t: string) => paint("1", t);

  const width = terminalWidth(options.width);
  const bodyWidth = Math.max(24, width - BODY_INDENT);

  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;

  for (const report of reports) {
    lines.push(bold(quote(report.file, 200)));
    if (report.readError !== undefined) {
      for (const line of wrap(quote(report.readError, 400), bodyWidth)) {
        lines.push(`  ${red("read error")} ${line}`);
      }
      lines.push("");
      continue;
    }
    for (const line of wrap(factsLine(report), width - 2)) lines.push(`  ${dim(line)}`);

    for (const note of report.limitations ?? []) {
      for (const line of wrap(note, bodyWidth)) lines.push(`  ${dim(`note   ${line}`)}`);
    }

    if (report.issues.length === 0) {
      lines.push(`  ${green("No accessibility problems found.")}`);
      lines.push("");
      continue;
    }

    for (const issue of report.issues) {
      const badge = issue.severity === "error" ? red("error") : yellow("warn ");
      const where = dim((issue.page ? `p${issue.page}` : "doc").padEnd(GUTTER));
      const body = wrap(issue.message, bodyWidth);
      lines.push(`  ${where} ${badge}  ${body[0] ?? ""}`);
      for (const extra of body.slice(1)) lines.push(`  ${" ".repeat(GUTTER)}        ${extra}`);
      const meta = [issue.check, issue.clause].filter(Boolean).join("  ");
      lines.push(`  ${" ".repeat(GUTTER)}        ${dim(meta)}`);
      if (issue.severity === "error") errors++;
      else warnings++;
    }
    lines.push("");
  }

  const summary = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
  lines.push(errors > 0 ? red(summary) : warnings > 0 ? yellow(summary) : green(summary));
  return lines.join("\n");
}

export function formatJson(reports: Report[]): string {
  return JSON.stringify(
    {
      reports,
      errorCount: reports.reduce((n, r) => n + r.errorCount, 0),
      warningCount: reports.reduce((n, r) => n + r.warningCount, 0),
    },
    null,
    2,
  );
}

// A workflow command ends at the first newline, so an unescaped newline in a
// message silently truncates the annotation, and an unescaped comma corrupts
// the property list. https://docs.github.com/actions/reference/workflow-commands
const escapeData = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

const escapeProperty = (value: string): string => escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** GitHub Actions annotations. PDFs have no line numbers, so page goes in the title. */
export function formatGithub(reports: Report[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    if (report.readError !== undefined) {
      lines.push(
        `::error file=${escapeProperty(report.file)},title=${escapeProperty("pdf-a11y read error")}::${escapeData(quote(report.readError, 400))}`,
      );
      continue;
    }
    for (const issue of report.issues) {
      lines.push(annotation(report.file, issue));
    }
  }
  return lines.join("\n");
}

function annotation(file: string, issue: Issue): string {
  const level = issue.severity === "error" ? "error" : "warning";
  const title = [issue.check, issue.page ? `page ${issue.page}` : null, issue.clause]
    .filter(Boolean)
    .join(" · ");
  return `::${level} file=${escapeProperty(file)},title=${escapeProperty(title)}::${escapeData(issue.message)}`;
}
