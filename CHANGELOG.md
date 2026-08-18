# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0

A correctness, robustness and throughput release. Every bug below has a
regression test.

### Fixed

- **A deeply nested structure tree crashed the checker.** The tree was read
  recursively, so a document nesting elements ~20,000 deep threw
  `RangeError: Maximum call stack size exceeded` straight out of `checkPdf`,
  breaking the documented "never throws" contract and killing the CLI. The walk
  is now iterative and bounded by `CheckOptions.limits`.
- **Issues were reported against the wrong page.** Pages were identified by
  serialising the page dictionary and using the text as a key. Pages that
  serialise identically — which any two blank or repeated pages do — collapsed
  onto one entry, so a figure on page 1 of a five page document was reported on
  page 5. Pages are now identified by their object reference.
- **A nested table's header cells excused the table around it.** The check
  flattened the whole subtree, so an outer table with no `TH` passed as long as
  some inner table had one, and the reported cell count included the inner
  table's cells. Each table is now measured up to its nested tables, not through
  them.
- **Images in inherited page resources were invisible.** `/Resources` is
  inheritable from the page tree, and only the page's own dictionary was read,
  so `untagged-image` silently missed every image on such a page.
- **The CLI truncated its own output.** `console.log` followed by
  `process.exit()` discards whatever stdout has not flushed, which for a pipe is
  everything past the 64 KB buffer. `pdf-a11y ./out --format json | jq` lost the
  output after the first 65,536 bytes. The CLI now sets `process.exitCode` and
  lets Node exit normally.
- **GitHub annotations broke on ordinary text.** Newlines, `%`, commas and
  colons were written into workflow commands unescaped, which silently truncated
  an annotation or corrupted its properties. They are escaped now, and a file
  that could not be read produces an annotation instead of nothing.
- **`--max-warnings` with a missing or non-numeric value was ignored.**
  `Number(undefined)` is `NaN` and every comparison against it is false, so the
  ceiling never applied. Bad values are now a usage error, exit code 2.
- **The parser wrote to your console.** A damaged file made pdf-lib print
  dozens of lines to `console.warn` from inside a library call. Those warnings
  are captured; pass `onParserWarning` to see them.
- **Document text could inject escape sequences into your terminal.** Alt text,
  language tags and form field names went into messages verbatim, so a PDF could
  emit ANSI escapes into a terminal or a newline into a GitHub annotation, and
  a multi-megabyte value could flood the output. All document text is now
  stripped of control characters and length capped.
- **A structure tag called `__proto__` corrupted `facts.tags`.** Counts are
  accumulated in a `Map` and materialised with `Object.fromEntries`.
- **`extraction-allowed` warned about every encrypted file.** It now reads the
  `/Encrypt /P` permission bits and only reports a problem when extraction is
  actually blocked, or when the flags cannot be read.
- **Encrypted documents produced confidently wrong results.** pdf-lib does not
  decrypt, so every string in an encrypted file is ciphertext, which a naive
  reader judges as a malformed language tag or as valid alt text. Checks that
  judge the _content_ of a value are now skipped for encrypted files, and the
  report says why in `limitations`.
- **A form XObject shared across pages was walked once per page**, and a
  self referential one was only stopped by a depth cap. Results are memoised and
  cycles are detected.
- **File discovery was order dependent and could repeat work.** Directory
  entries are sorted, each real path is visited once, and a symlink loop no
  longer makes the walk recurse forever.
- **`node:` prefixes were stripped from the built output**, which breaks Deno,
  Bun and edge bundlers that only resolve prefixed builtins.
- **A form field labelled through its parent field was reported as unlabelled.**
  `/TU` and `/T` are inherited up the field hierarchy, and only the widget's own
  dictionary was read, so every grouped field was a false positive.
- **Hidden annotations were reported.** An annotation with the Hidden or NoView
  flag is not on the page as far as a reader is concerned, so it needs neither
  an accessible name nor a tab stop.
- **A compressible XMP metadata stream could exhaust memory.** The stream was
  inflated in full before its size was looked at, so a few kilobytes of metadata
  could become hundreds of megabytes of heap. Only a bounded prefix is read now.
- **Truncating long document text could split a surrogate pair**, leaving a lone
  surrogate in the message.
- **An unrecognised profile name silently turned every check off**, because
  spreading an undefined profile produced an empty severity table. It now falls
  back to `recommended`.
- **Capturing parser warnings swallowed the host application's own logs.** Only
  messages the PDF parser actually emits are intercepted; everything else
  logged during a parse passes straight through.

### Added

- `parent-tree` check: a tagged document with no `/ParentTree` cannot map page
  content back to its tags. `warn` under `recommended`, `error` under `pdf-ua`.
- `marked-content` also reports `/MarkInfo /Suspects`, the producer flagging its
  own tagging as unreliable.
- Document titles fall back to XMP `dc:title`, which is where PDF 2.0 and
  PDF/UA-2 put them, removing a false `document-title` on files that only carry
  XMP metadata.
- `Report.limitations`: what the run could not determine, in plain words.
- `CheckOptions.limits` bounds the structure tree walk (`maxNodes`, `maxDepth`).
- `CheckOptions.onParserWarning` surfaces parser complaints about damaged files.
- `checkFile` takes `maxBytes`, defaulting to the new `MAX_FILE_BYTES` (512 MB).
- CLI: `--concurrency` checks several files at once on worker threads,
  `--no-color` / `--color`, and `--` to end option parsing.
- Pretty output wraps to the terminal width, as the README always showed, and
  reports `limitations` as notes.
- `bench/` — a reproducible corpus and harness for the library, the analysis
  stage and the command line, plus a CI sanity guard.

### Changed

- Checking a folder of files now uses one worker thread per CPU by default
  (up to 8). On a 40 file directory this is **1510 ms → 458 ms, 3.3x faster**.
  Use `--concurrency 1` for the previous behaviour.
- The analysis stage is substantially faster on documents with large structure
  trees: **-69%** on a 500 page report, **-82%** on deeply nested tables,
  **-57%** on a 10,000 cell table. End to end times move less, because parsing
  dominates.
- The published package no longer carries a second copy of the checker for the
  command line: 103 kB → 75 kB packed, 421 kB → 302 kB unpacked.
- Issues are ordered by page, then errors before warnings, then check id.
  Sorting on the check id alone printed `struct-tree`, the finding that matters
  most, underneath the warnings.
- `figure-alt` also rejects `chart`, `diagram`, `none` and `n/a` as placeholder
  alt text.
- `heading-order` understands `H1` through `H9` and ignores the unnumbered `H`
  tag, which carries no level.
- `CHECK_IDS` is frozen. Mutating a library's exported constant was never
  supported; it now fails loudly instead of corrupting other consumers.
- `engines.node` is `>=18.18`, which is what the toolchain actually requires.
- `pdf-a11y/browser` now resolves for CommonJS consumers and for `node10` style
  resolution. Previously `require("pdf-a11y/browser")` resolved to ESM.

### Notes for upgraders

The public API is source compatible. Two behaviours changed deliberately:

- New findings can appear on documents that previously passed: `parent-tree`,
  `/MarkInfo /Suspects`, and the wider placeholder alt list. Turn any of them
  off with `--check <id>=off` or `checks: { "<id>": "off" }`.
- Fewer findings appear on encrypted documents whose permissions allow
  extraction, and on files whose title lives only in XMP. Both were false
  positives.

## 0.1.0

- Initial release.
