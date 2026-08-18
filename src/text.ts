/**
 * Every string this module handles comes from a PDF, which means it comes from
 * whoever produced the file. It is rendered into terminals, GitHub annotations
 * and logs, so it is treated as untrusted: control characters are stripped and
 * length is capped before it reaches any output.
 */

/** Longest run of document text embedded in a message. */
export const MAX_QUOTED = 80;

// C0 and C1 control characters plus the Unicode line separators. Removing these
// is what stops a PDF from injecting ANSI escapes into a terminal, or a newline
// into a GitHub workflow command.
// Matching control characters is the entire point of this pattern; the lint
// rule exists to catch accidental ones.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
const WHITESPACE = /\s+/g;

/**
 * Makes a PDF derived string safe to print and short enough to read.
 * Collapses whitespace, drops control characters and truncates.
 */
export function quote(value: string, max: number = MAX_QUOTED): string {
  const clean = value.replace(CONTROL, " ").replace(WHITESPACE, " ").trim();
  if (clean.length <= max) return clean;

  let cut = max - 1;
  // Cutting between the halves of a surrogate pair would leave a lone
  // surrogate, which renders as a replacement character.
  const last = clean.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--;
  return `${clean.slice(0, cut)}…`;
}
