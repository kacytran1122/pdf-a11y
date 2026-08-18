# pdf-a11y

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

Node 18 or newer. No native binaries and no Java, unlike most PDF/UA tooling.

## Checks

| Check | Default | Clause | What it catches |
| --- | --- | --- | --- |
| `struct-tree` | error | PDF/UA 7.1, WCAG 1.3.1 | No tag tree at all |
| `document-lang` | error | WCAG 3.1.1 | Missing or malformed `/Lang` |
| `figure-alt` | error | PDF/UA 7.3, WCAG 1.1.1 | Figure with no alt text, or useless alt such as `image` or `chart.png` |
| `table-headers` | error | PDF/UA 7.5, WCAG 1.3.1 | Table with data cells but no `TH` header cells |
| `form-field-label` | error | PDF/UA 7.18.4 | Form field with no `/TU` tooltip, which is its accessible name |
| `marked-content` | warn | PDF/UA 7.1 | `MarkInfo/Marked` not set to true |
| `document-title` | warn | WCAG 2.4.2 | No title, or a title that viewers will not display |
| `untagged-image` | warn | WCAG 1.1.1 | More images on the page than Figure elements in the tree |
| `heading-order` | warn | WCAG 1.3.1 | Heading levels skip, or the document does not start at H1 |
| `link-alt` | warn | PDF/UA 7.18.5 | Link annotation with no `/Contents` description |
| `tab-order` | warn | PDF/UA 7.18.3 | Page has annotations but no `/Tabs /S` |
| `extraction-allowed` | warn | PDF/UA 7.1 | Encrypted file that may block assistive technology entirely |

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
```

Exit code is 1 when there is at least one error. Use `--max-warnings 0` to fail on warnings too.

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
const bytes = await page.pdf();          // puppeteer
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
  readError?: string;               // set instead of throwing
}
```

`facts.tags` is useful on its own. It tells you what structure your generator is actually emitting, which is usually less than the author thinks.

## What it does not do

A checker is only trustworthy if it is honest about its edge.

- **It cannot tell you whether the reading order makes sense.** It can only tell you whether one exists. A tag tree in the wrong order passes.
- **It cannot judge alt text quality.** It catches the mechanical failures: empty, whitespace, a file name, or a placeholder word like `image`. Whether a real sentence describes the image well needs a human.
- **It does not check colour contrast**, because that needs the rendered page rather than the object graph.
- **It does not repair anything.** Fixing means changing the generator. `pdfkit` supports tagging through its accessibility API, and `puppeteer` inherits structure from well written HTML.
- **Encrypted files are read with the encryption ignored**, so permission flags are reported as a risk rather than resolved.

Role maps are applied, so a document that renames standard tags is read correctly rather than reported as broken.

## Related

Use with [`motion-a11y`](https://www.npmjs.com/package/motion-a11y) for animation accessibility, and `axe-core` for the rendered page.

## Licence

MIT
