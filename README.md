# pdf-a11y

[![CI](https://github.com/kacytran1122/pdf-a11y/actions/workflows/ci.yml/badge.svg)](https://github.com/kacytran1122/pdf-a11y/actions/workflows/ci.yml)


**Check whether the PDFs your code generates can actually be read.**

```bash
npx pdf-a11y invoice.pdf
```

No installer. No licence. No Java.
[pdf-a11y.dev](https://pdf-a11y.dev/) · [npm](https://www.npmjs.com/package/pdf-a11y)

---

## Every invoice you generate is one long unbroken sentence

`pdfkit` and `puppeteer` both produce **untagged** PDFs by default.

An untagged PDF has no headings, no table structure and no reading order. On screen it looks
perfect. To a screen reader it is a single blob of text: amounts drift away from their labels,
column headers vanish, and there is no way to skip to a section.

Your web app has `axe-core` in CI. Your PDFs have had nothing.

**This is that check.**

## Try it in one command

```bash
npx pdf-a11y invoice.pdf
```

Here is a plain ten-line `pdfkit` invoice. Nothing was sabotaged to get this output — it is the
out-of-the-box starting point for almost every Node service that emails a PDF:

```
invoice.pdf
  1 page  ·  untagged  ·  no lang  ·  0 images
  doc    error  No document language is set. A screen reader will fall back to
                its own language and mispronounce the text.
                document-lang  WCAG 3.1.1
  doc    error  No structure tree. A screen reader reads this document as one
                undifferentiated blob with no headings, lists or tables.
                struct-tree  PDF/UA 7.1, WCAG 1.3.1
  doc    warn   No document title. Assistive technology announces the file name
                instead, which is usually a generated string.
                document-title  WCAG 2.4.2
  doc    warn   MarkInfo/Marked is not set to true, so the document does not
                declare itself as tagged.
                marked-content  PDF/UA 7.1

2 errors, 2 warnings
```

The command exits with code `1`, so it works as a gate anywhere you can run a command.

## Why this matters now

The **European Accessibility Act** has applied since **28 June 2025**. It reaches customer-facing
documents — invoices, statements, contracts, reports — for a wide range of services sold into the
EU. Each member state sets its own penalties and its own enforcement body.

The hard part was never the law. It was that teams had no way to check.

| When  | What happened                                                                        |
| ----- | ------------------------------------------------------------------------------------ |
| 2001  | Tagged PDF arrives in PDF 1.4. Most generators still do not emit a structure tree.   |
| 2012  | PDF/UA published as ISO 14289-1 — a precise definition of an accessible PDF.         |
| 2025  | The European Accessibility Act reaches customer-facing documents, not just websites. |
| Today | Your invoice pipeline has no check. One line in CI closes it.                        |

Web accessibility has had automated tooling for a decade. PDF accessibility had desktop software,
paid services and Java command line tools — none of which fit into a Node build. This one runs
with `npx`.

## Install

```bash
npm install --save-dev pdf-a11y
```

Node 18.18 or newer. One dependency, no native binaries, no Java.

## Three ways to run it

### 1. On a file you already have

Point it at a PDF, or at a folder full of them.

```bash
npx pdf-a11y invoice.pdf                  # one file
npx pdf-a11y ./out                        # every PDF in a folder
npx pdf-a11y ./out --profile pdf-ua       # strictest: every check is an error
npx pdf-a11y invoice.pdf --format json    # machine readable
npx pdf-a11y ./out --check tab-order=off  # turn one check off
npx pdf-a11y ./out --quiet                # errors only
```

A folder is checked on one worker thread per CPU, up to eight. On forty files that is about
**3.3x faster** than one at a time — see [Performance](#performance). `--concurrency 1` turns it
off.

| Exit code | Meaning                                                          |
| --------: | ---------------------------------------------------------------- |
|         0 | No errors                                                        |
|         1 | An error, an unreadable file, or warnings above `--max-warnings` |
|         2 | Bad usage — an unknown option, or a path that does not exist     |

### 2. In CI, on the PDFs you actually ship

Generate the documents your service really sends, then check those. The `github` format puts each
finding straight onto the pull request.

```yaml
- run: node scripts/generate-invoices.js
- run: npx pdf-a11y ./out --format github
```

### 3. Before it ever touches disk

`checkPdf` takes a `Uint8Array`, so a `puppeteer` buffer can be checked in the same function that
created it.

```js
import { checkPdf } from "pdf-a11y";

const bytes = await page.pdf(); // puppeteer
const report = await checkPdf(bytes);

if (report.errorCount > 0) {
  throw new Error("This PDF is not accessible.");
}
```

Or from a path, in Node:

```js
import { checkFile } from "pdf-a11y";

const report = await checkFile("invoice.pdf", { profile: "pdf-ua" });

for (const issue of report.issues) {
  console.log(issue.page ?? "doc", issue.check, issue.message);
}
```

Neither function ever throws. A file that is damaged, truncated, encrypted, hostile or simply not
a PDF comes back as a report with `readError` set, so one bad file cannot take down a batch.

## The 13 checks

Every finding points at a published clause. There are two profiles: `recommended` is what a team
can reasonably fix this sprint, `pdf-ua` turns everything into an error. Any check can be switched
off on its own.

| Check                | Default | Clause                 | What it catches                                                                   |
| -------------------- | ------- | ---------------------- | --------------------------------------------------------------------------------- |
| `struct-tree`        | error   | PDF/UA 7.1, WCAG 1.3.1 | No tag tree at all. The one that matters most.                                    |
| `document-lang`      | error   | WCAG 3.1.1             | Missing or malformed `/Lang`, so the reader guesses the language                  |
| `figure-alt`         | error   | PDF/UA 7.3, WCAG 1.1.1 | Figure with no alt text, or alt text like `image` or `chart.png`                  |
| `table-headers`      | error   | PDF/UA 7.5, WCAG 1.3.1 | Table with data cells but no header cells, so values lose their column            |
| `form-field-label`   | error   | PDF/UA 7.18.4          | Form field with no `/TU` tooltip, which is its accessible name                    |
| `marked-content`     | warn    | PDF/UA 7.1             | `MarkInfo/Marked` not true, or `Suspects` true                                    |
| `document-title`     | warn    | WCAG 2.4.2             | No title in the info dictionary or XMP, or a title viewers will not display       |
| `parent-tree`        | warn    | PDF/UA 7.1             | Tagged document with no `/ParentTree` to map content back to its tags             |
| `untagged-image`     | warn    | WCAG 1.1.1             | More images on the page than Figure elements in the tree                          |
| `heading-order`      | warn    | WCAG 1.3.1             | Heading levels skip, or the document does not start at H1                         |
| `link-alt`           | warn    | PDF/UA 7.18.5          | Link annotation with no description of where it goes                              |
| `tab-order`          | warn    | PDF/UA 7.18.3          | Page has annotations but no `/Tabs /S`, so keyboard order is arbitrary            |
| `extraction-allowed` | warn    | PDF/UA 7.1             | Encryption permission flags that block assistive technology from reading anything |

Run `pdf-a11y --checks` to print this table with both profiles.

## Beyond pass and fail

Every report also carries a `facts` object, including a count of **every structure tag in the
document**. This is often the most useful part: authors are regularly surprised to learn their
template emits two hundred paragraphs and not a single heading.

```jsonc
{
  "pages": 4,
  "tagged": true,
  "lang": "vi",
  "title": "Hóa đơn 2026-0142",
  "images": 3,
  "figures": 1, // two images never made it into the tree
  "tags": { "P": 212, "Table": 2, "TD": 48, "Figure": 1 }, // no H1, no TH: the structure is flat
}
```

The full result:

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
    tags: Record<string, number>;
    encrypted: boolean;
  };
  limitations?: string[];  // what this run could not determine
  readError?: string;      // set instead of throwing
}
```

`limitations` is how the checker admits what it could not see. An encrypted document cannot have
its text decoded, so its title and alt text are checked for presence but never judged on content —
and it says so, rather than reporting a pass.

### Options

```ts
await checkPdf(bytes, {
  profile: "pdf-ua", // or "recommended", the default
  checks: { "tab-order": "off" }, // per check severity
  limits: { maxNodes: 500_000, maxDepth: 100_000 }, // bounds on the tree walk
  onParserWarning: (message) => log(message), // complaints about a damaged file
});

await checkFile("invoice.pdf", { maxBytes: 50 * 1024 * 1024 });
```

In a browser or an edge runtime, import `pdf-a11y/browser`. It is the same checker without the
file-system entry point.

## What it cannot do

No automated tool can certify a PDF as accessible, and anything claiming otherwise is selling you
something. These are the edges, stated plainly.

- **Reading order.** It can tell you an order exists. It cannot tell you the order makes sense. A
  tag tree in the wrong sequence still passes.
- **Alt text quality.** It catches the mechanical failures — empty, whitespace, a file name, or a
  placeholder word like `image`. Whether a real sentence describes the picture well needs a person.
- **Colour contrast.** Out of scope: contrast needs the rendered page, and this reads the object
  graph underneath it.
- **Repair.** It reports, it does not rewrite. Fixing means changing the generator, which is where
  the structure has to come from anyway.
- **Encrypted text.** Encryption is ignored rather than broken, so strings stay unreadable.
  Presence is checked, content is not, and the report says so in `limitations`.
- **`untagged-image` counts image objects, not drawn images.** An image marked as decoration still
  counts, which is why it is a warning and not an error.

Role maps are applied, so a document that renames the standard tags is read correctly rather than
reported as broken.

## Hostile input

The files this reads come from somewhere else, so they are treated as hostile.

- `checkPdf` and `checkFile` **never throw**. Anything unreadable comes back as `readError`.
- The structure tree is walked **iteratively and with a budget**, so a document nested tens of
  thousands of levels deep neither overflows the stack nor runs forever. Cycles and shared
  subtrees are visited once.
- Text taken from a document is **stripped of control characters and truncated** before it reaches
  a message, so a PDF cannot inject escape sequences into your terminal or a newline into a GitHub
  annotation.
- A structure tag named `__proto__` is **data, not a prototype write**.
- `checkFile` refuses files above 512 MB unless you raise `maxBytes`.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Performance

Measured on an Apple M4 Pro (15 cores), Node 24.18, comparing a build of v0.1.0 against v0.2.0 in
the same session. Reproduce with the harness in [`bench/`](bench/).

**Checking a folder** of forty generated reports, seven runs, wall clock for the whole command:

|            |       v0.1.0 |       v0.2.0 |   Change |
| ---------- | -----------: | -----------: | -------: |
| Mean       |      1510 ms |       458 ms | **-70%** |
| Median     |      1509 ms |       454 ms |     -70% |
| p95        |      1519 ms |       474 ms |     -69% |
| Throughput | 26.5 files/s | 87.4 files/s | **3.3x** |

**The analysis itself**, with parsing excluded — the part this project owns. Forty iterations per
document:

| Document                          |   v0.1.0 |   v0.2.0 |   Change |
| --------------------------------- | -------: | -------: | -------: |
| 500 page tagged report            | 33.10 ms | 10.34 ms | **-69%** |
| 50 page tagged report             |  3.36 ms |  1.20 ms |     -64% |
| 10,000 cell table                 | 15.57 ms |  6.72 ms |     -57% |
| 200 deep nested tables            |  6.73 ms |  1.18 ms | **-82%** |
| Structure tree nested 20,000 deep |    crash | 13.13 ms |    fixed |

End-to-end times move far less, because parsing is roughly 90% of the work on a large file. That
is the honest ceiling on single-file latency, and it is why checking a folder went to worker
threads instead.

## Contributing

```bash
npm ci
npm run check   # format, lint, types, tests with coverage, build, package checks
```

Everything `npm run check` runs is also a CI gate, and CI is a release gate. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the bar a change has to clear, and
[CHANGELOG.md](CHANGELOG.md) for what has moved.

## Related

Use with [`motion-a11y`](https://www.npmjs.com/package/motion-a11y) for animation accessibility,
and `axe-core` for the rendered page.

## Licence

MIT — see [LICENSE](LICENSE).
