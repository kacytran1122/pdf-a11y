# pdf-a11y

[![CI](https://github.com/kacytran1122/pdf-a11y/actions/workflows/ci.yml/badge.svg)](https://github.com/kacytran1122/pdf-a11y/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pdf-a11y.svg)](https://www.npmjs.com/package/pdf-a11y)

Accessibility checker for PDFs, built for the ones your code generates.

`pdfkit` and `puppeteer` both produce untagged PDFs by default. An untagged PDF has no headings, no tables and no reading order, so a screen reader announces the whole page as one unbroken blob. Every invoice, statement and report your service emails out has this problem, and nothing in your test suite will tell you.

```bash
npx pdf-a11y invoice.pdf
```

```
invoice.pdf
  1 page  ·  untagged  ·  no lang  ·  0 images
  doc    error  No structure tree. A screen reader reads this document as one
                undifferentiated blob with no headings, lists or tables.
                struct-tree  PDF/UA 7.1, WCAG 1.3.1
  doc    error  No document language is set. A screen reader will fall back to
                its own language and mispronounce the text.
                document-lang  WCAG 3.1.1
  doc    warn   No document title. Assistive technology announces the file name
                instead, which is usually a generated string.
                document-title  WCAG 2.4.2

2 errors, 2 warnings
```

That output is from a plain `pdfkit` document. This is the normal starting point, not an unusual failure.

## Why now

The European Accessibility Act has applied since 28 June 2025. It covers customer facing documents such as invoices, statements, contracts and reports for a wide range of services sold into the EU. Penalties are set by each member state.

Web accessibility already has `axe-core` in CI. PDF accessibility had nothing on npm. This closes that gap.

## Install

```bash
npm install --save-dev pdf-a11y
```

Node 18.18 or newer. No native binaries and no Java, unlike most PDF/UA tooling.

## Checks

| Check                | Default | Clause                 | What it catches                                                                     |
| -------------------- | ------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `struct-tree`        | error   | PDF/UA 7.1, WCAG 1.3.1 | No tag tree at all                                                                  |
| `document-lang`      | error   | WCAG 3.1.1             | Missing or malformed `/Lang`                                                        |
| `figure-alt`         | error   | PDF/UA 7.3, WCAG 1.1.1 | Figure with no alt text, or useless alt such as `image` or `chart.png`              |
| `table-headers`      | error   | PDF/UA 7.5, WCAG 1.3.1 | Table with data cells but no `TH` header cells, ignoring any nested table's headers |
| `form-field-label`   | error   | PDF/UA 7.18.4          | Form field with no `/TU` tooltip, which is its accessible name                      |
| `marked-content`     | warn    | PDF/UA 7.1             | `MarkInfo/Marked` not true, or `Suspects` true                                      |
| `document-title`     | warn    | WCAG 2.4.2             | No title in the info dictionary or XMP, or a title viewers will not display         |
| `parent-tree`        | warn    | PDF/UA 7.1             | Tagged document with no `/ParentTree` to map content back to its tags               |
| `untagged-image`     | warn    | WCAG 1.1.1             | More images on the page than Figure elements in the tree                            |
| `heading-order`      | warn    | WCAG 1.3.1             | Heading levels skip, or the document does not start at H1                           |
| `link-alt`           | warn    | PDF/UA 7.18.5          | Link annotation with no `/Contents` description                                     |
| `tab-order`          | warn    | PDF/UA 7.18.3          | Page has annotations but no `/Tabs /S`                                              |
| `extraction-allowed` | warn    | PDF/UA 7.1             | Encryption permission flags that block content extraction                           |

Under `--profile pdf-ua` every check is an error.

Run `pdf-a11y --checks` to see the table with both profiles.

## Usage

### Command line

```bash
pdf-a11y invoice.pdf                  # check one file
pdf-a11y ./out                        # check every PDF in a folder
pdf-a11y ./out --profile pdf-ua       # every check becomes an error
pdf-a11y invoice.pdf --format json    # machine readable
pdf-a11y ./out --format github        # annotations on a pull request
pdf-a11y ./out --check tab-order=off
pdf-a11y ./out --quiet                # errors only
pdf-a11y ./out --concurrency 1        # one file at a time
```

| Exit code | Meaning                                                                    |
| --------- | -------------------------------------------------------------------------- |
| 0         | No errors                                                                  |
| 1         | At least one error, an unreadable file, or warnings above `--max-warnings` |
| 2         | Bad usage: an unknown option, or a path that does not exist                |

A folder is checked on one worker thread per CPU, up to eight. On a forty file
directory that is 3.2x faster than checking them one at a time; see
[Performance](#performance). `--concurrency 1` restores the sequential path.

### In CI, on the PDFs you actually ship

```yaml
- run: node scripts/generate-invoices.js
- run: npx pdf-a11y ./out --format github
```

### Programmatic

```js
import { checkFile, checkPdf } from "pdf-a11y";

const report = await checkFile("invoice.pdf", { profile: "pdf-ua" });

if (report.errorCount > 0) {
  for (const issue of report.issues) {
    console.log(issue.page ?? "doc", issue.check, issue.message);
  }
}
```

`checkPdf` takes a `Uint8Array`, so you can check a buffer before it ever reaches disk:

```js
const bytes = await page.pdf(); // puppeteer
const report = await checkPdf(bytes);
```

Both return:

```ts
{
  file: string;
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  facts: {
    pages: number;
    marked: boolean;
    tagged: boolean;
    lang: string | null;
    title: string | null;
    images: number;
    figures: number;
    tags: Record<string, number>;   // every structure tag, with counts
    encrypted: boolean;
  };
  limitations?: string[];           // what this run could not determine
  readError?: string;               // set instead of throwing
}
```

`checkPdf` and `checkFile` never throw. A file that is damaged, truncated,
encrypted, hostile or simply not a PDF comes back as a report with `readError`
set, so a bad file in a batch cannot take the run down.

`limitations` is how the checker admits what it could not see. An encrypted
document, for example, cannot have its text decoded, so its title and alt text
are checked for presence but not for content, and that is said out loud rather
than reported as a pass.

### Options

```ts
await checkPdf(bytes, {
  profile: "pdf-ua", // or "recommended", the default
  checks: { "tab-order": "off" }, // per check severity override
  limits: { maxNodes: 500_000, maxDepth: 100_000 }, // bounds on the tree walk
  onParserWarning: (message) => log(message), // complaints about a damaged file
});

await checkFile("invoice.pdf", { maxBytes: 50 * 1024 * 1024 });
```

`facts.tags` is useful on its own. It tells you what structure your generator is actually emitting, which is usually less than the author thinks.

## What it does not do

A checker is only trustworthy if it is honest about its edge.

- **It cannot tell you whether the reading order makes sense.** It can only tell you whether one exists. A tag tree in the wrong order passes.
- **It cannot judge alt text quality.** It catches the mechanical failures: empty, whitespace, a file name, or a placeholder word like `image`. Whether a real sentence describes the image well needs a human.
- **It does not check colour contrast**, because that needs the rendered page rather than the object graph.
- **It does not repair anything.** Fixing means changing the generator. `pdfkit` supports tagging through its accessibility API, and `puppeteer` inherits structure from well written HTML.
- **It cannot read encrypted text.** Encryption is ignored rather than broken, so in an encrypted file every string is still ciphertext. Presence is checked, content is not, and the report says so in `limitations` instead of guessing. The permission flags themselves are read, so a file that blocks extraction outright is reported.
- **`untagged-image` counts image XObjects, not drawn images.** An image marked as an artifact still counts, so this one is a warning rather than an error.

Role maps are applied, so a document that renames standard tags is read correctly rather than reported as broken.

## Hostile input

The files this reads come from somewhere else, so they are treated as hostile.

- `checkPdf` and `checkFile` **never throw**; anything unreadable comes back as `readError`.
- The structure tree is walked **iteratively and with a budget**, so nesting tens of thousands deep neither overflows the stack nor runs forever. Cycles and shared subtrees are visited once. Tune with `limits`.
- Text taken from a document is **stripped of control characters and truncated** before it reaches a message, so a PDF cannot inject ANSI escapes into your terminal or a newline into a GitHub annotation.
- A structure tag named `__proto__` is **data, not a prototype write**.
- `checkFile` refuses files above `MAX_FILE_BYTES` (512 MB) unless you raise `maxBytes`.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Performance

Measured on an Apple M4 Pro (15 cores), Node 24.18, comparing a build of v0.1.0
against v0.2.0 in the same session. Reproduce with the harness in
[`bench/`](bench/).

**Checking a folder** of forty generated reports, seven runs, wall clock for the
whole command:

|            |       v0.1.0 |       v0.2.0 |   Change |
| ---------- | -----------: | -----------: | -------: |
| Mean       |      1510 ms |       458 ms | **-70%** |
| Median     |      1509 ms |       454 ms |     -70% |
| p95        |      1519 ms |       474 ms |     -69% |
| Throughput | 26.5 files/s | 87.4 files/s | **3.3x** |

**The analysis itself**, with parsing excluded, which is the part this project
owns. Forty iterations per document:

| Document                          |   v0.1.0 |   v0.2.0 |   Change |
| --------------------------------- | -------: | -------: | -------: |
| 500 page tagged report            | 33.10 ms | 10.34 ms | **-69%** |
| 50 page tagged report             |  3.36 ms |  1.20 ms |     -64% |
| 10,000 cell table                 | 15.57 ms |  6.72 ms |     -57% |
| 200 deep nested tables            |  6.73 ms |  1.18 ms | **-82%** |
| Structure tree nested 20,000 deep |    crash | 13.13 ms |    fixed |

End to end times move far less, because `pdf-lib` parsing is roughly 90% of the
work on a large file. That is the honest ceiling on single file latency without
replacing the parser, and it is why checking a folder went to worker threads
instead.

## Related

Use with [`motion-a11y`](https://www.npmjs.com/package/motion-a11y) for animation accessibility, and `axe-core` for the rendered page.

## Licence

MIT
