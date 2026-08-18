import type { Report } from "./types.js";

const supportsColor = process.env.NO_COLOR === undefined && process.stdout.isTTY === true;
const paint = (code: string, text: string) => (supportsColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = (t: string) => paint("2", t);
const red = (t: string) => paint("31", t);
const yellow = (t: string) => paint("33", t);
const green = (t: string) => paint("32", t);
const bold = (t: string) => paint("1", t);

function factsLine(report: Report): string {
  const f = report.facts;
  const parts = [
    `${f.pages} page${f.pages === 1 ? "" : "s"}`,
    f.tagged ? "tagged" : "untagged",
    f.lang ? `lang ${f.lang}` : "no lang",
    `${f.images} image${f.images === 1 ? "" : "s"}`,
  ];
  if (f.encrypted) parts.push("encrypted");
  return dim(parts.join("  ·  "));
}

export function formatPretty(reports: Report[]): string {
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;

  for (const report of reports) {
    lines.push(bold(report.file));
    if (report.readError) {
      lines.push(`  ${red("read error")} ${report.readError}`);
      lines.push("");
      continue;
    }
    lines.push(`  ${factsLine(report)}`);

    if (report.issues.length === 0) {
      lines.push(`  ${green("No accessibility problems found.")}`);
      lines.push("");
      continue;
    }

    for (const issue of report.issues) {
      const badge = issue.severity === "error" ? red("error") : yellow("warn ");
      const where = dim((issue.page ? `p${issue.page}` : "doc").padEnd(6));
      lines.push(`  ${where} ${badge}  ${issue.message}`);
      const meta = [issue.check, issue.clause].filter(Boolean).join("  ");
      lines.push(`  ${" ".repeat(6)}        ${dim(meta)}`);
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

/** GitHub Actions annotations. PDFs have no line numbers, so page goes in the title. */
export function formatGithub(reports: Report[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    for (const issue of report.issues) {
      const level = issue.severity === "error" ? "error" : "warning";
      const title = [issue.check, issue.page ? `page ${issue.page}` : null, issue.clause]
        .filter(Boolean)
        .join(" · ");
      lines.push(`::${level} file=${report.file},title=${title}::${issue.message}`);
    }
  }
  return lines.join("\n");
}
