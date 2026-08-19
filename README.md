# pdf-a11y

[![npm version](https://img.shields.io/npm/v/pdf-a11y.svg)](https://www.npmjs.com/package/pdf-a11y)
[![CI](https://github.com/kacytran1122/pdf-a11y/actions/workflows/ci.yml/badge.svg)](https://github.com/kacytran1122/pdf-a11y/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.19-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Make sure the PDFs your software creates can be read by everyone.**

A PDF can look perfect on a screen and still be almost useless to a person
using a screen reader.

The problem is hidden inside the file. A heading may only _look_ like a
heading. A table may have no real connection between its labels and values. An
image may have no description. The reading order may be missing completely.

`pdf-a11y` checks that hidden structure before the document reaches a customer.

[View pdf-a11y on npm](https://www.npmjs.com/package/pdf-a11y)

## Try it in one command

You do not need to install anything first:

```bash
npx pdf-a11y invoice.pdf
```

Example result:

```text
invoice.pdf
  1 page · untagged · no language · 0 images

  error  No document language is set.
  error  No structure tree. A screen reader sees one unbroken block.
  warn   No document title.

2 errors, 1 warning
```

The command returns a failure code when it finds a serious problem. That means
it can stop an inaccessible document from being released by accident.

## Who is this for?

- Teams that generate invoices, statements, contracts, tickets, or reports.
- Products that create PDFs with tools such as pdfkit or Puppeteer.
- Accessibility teams that need repeatable checks instead of manual spot checks.
- Agencies that deliver documents for many clients.
- Developers who want PDF checks in the same release process as website checks.

You do not need to understand the PDF file format to use the command. The
report explains each problem in ordinary language.

## Why a normal visual check is not enough

A person looking at the document can see a title, columns, pictures, and a
table. A screen reader does not see the page the same way. It relies on labels
and relationships stored inside the PDF.

Without those details:

- every paragraph may become one long sentence;
- table values can lose their column names;
- images are announced with no useful description;
- form fields may have no name;
- keyboard focus can move in a confusing order;
- the reader may pronounce the document in the wrong language.

`pdf-a11y` checks the file itself, not just a screenshot of the page.

## What it checks

| Human question                                                    | Check name           |
| ----------------------------------------------------------------- | -------------------- |
| Does the document have a real reading structure?                  | `struct-tree`        |
| Can page content be connected back to that structure?             | `parent-tree`        |
| Does the file say that its content is tagged?                     | `marked-content`     |
| Does a screen reader know the document language?                  | `document-lang`      |
| Does the document have a useful title?                            | `document-title`     |
| Do meaningful images have descriptions?                           | `figure-alt`         |
| Are there images that never appear in the reading structure?      | `untagged-image`     |
| Do data cells have table headers?                                 | `table-headers`      |
| Do headings follow a sensible order?                              | `heading-order`      |
| Do links explain where they go?                                   | `link-alt`           |
| Do form fields have names?                                        | `form-field-label`   |
| Do security settings allow assistive technology to read the file? | `extraction-allowed` |
| Does keyboard focus follow the document structure?                | `tab-order`          |

Every finding points to a related PDF/UA or WCAG clause. The standard is there
for teams that need it; the main message stays readable for everyone else.

## Install it in a project

```bash
npm install --save-dev pdf-a11y
```

Node 20.19 or newer is required. The package has one runtime dependency,
`pdf-lib`. It has no native binary and does not need Java.

Add a script to `package.json`:

```json
{
  "scripts": {
    "check:pdf": "pdf-a11y ./out"
  }
}
```

Then run:

```bash
npm run check:pdf
```

## Three common ways to use it

### 1. Check a PDF that already exists

```bash
npx pdf-a11y invoice.pdf
npx pdf-a11y ./out
```

A folder is checked in parallel, using up to eight worker threads.

### 2. Check every release in GitHub Actions

Generate the PDFs your product really sends, then check that folder:

```yaml
- run: node scripts/create-invoices.js
- run: npx pdf-a11y ./out --format github
```

Problems appear as GitHub annotations. A serious finding makes the workflow
fail.

### 3. Check a PDF directly in code

```js
import { checkPdf } from "pdf-a11y";

const bytes = await page.pdf();
const report = await checkPdf(bytes);

if (report.errorCount > 0) {
  throw new Error("The PDF needs accessibility fixes.");
}
```

For a file already on disk:

```js
import { checkFile } from "pdf-a11y";

const report = await checkFile("invoice.pdf");

for (const problem of report.issues) {
  console.log(problem.page ?? "document", problem.check, problem.message);
}
```

In a browser or edge runtime, import from `pdf-a11y/browser`. It provides the
same in-memory checker without the file-system functions.

## Choose how strict to be

The default `recommended` profile separates serious errors from useful
warnings. It is designed for a team starting to improve its PDFs.

The `pdf-ua` profile treats all 13 checks as required:

```bash
npx pdf-a11y ./out --profile pdf-ua
```

You can also change one check:

```bash
npx pdf-a11y invoice.pdf --check tab-order=off
```

Other useful commands:

```bash
pdf-a11y invoice.pdf --format json    # output for another program
pdf-a11y ./out --format github       # GitHub annotations
pdf-a11y ./out --quiet               # show errors only
pdf-a11y ./out --concurrency 1       # check one file at a time
pdf-a11y --checks                    # list all 13 checks
```

| Exit code | Meaning                                                             |
| --------: | ------------------------------------------------------------------- |
|         0 | No blocking problem was found                                       |
|         1 | A blocking problem, unreadable file, or too many warnings was found |
|         2 | The command was used incorrectly                                    |

## What the report tells you

The result is more than pass or fail. It includes useful facts about the
document:

```jsonc
{
  "pages": 4,
  "tagged": true,
  "lang": "vi",
  "title": "Hóa đơn 2026-0142",
  "images": 3,
  "figures": 1,
  "tags": {
    "P": 212,
    "Table": 2,
    "TD": 48,
    "Figure": 1,
  },
}
```

In this example, the file contains three images but only one is represented as
a figure. It has tables and data cells but no table-header tags. Those facts
help a team understand the shape of the problem instead of only seeing a red
or green result.

If a damaged or encrypted file hides information, the report includes a
`limitations` note. The tool says what it could not determine rather than
pretending the file passed.

## What it cannot promise

No automatic checker can certify that a PDF is fully accessible. Human review
still matters.

- It can confirm that a reading order exists, but not that the order makes sense.
- It can catch missing or placeholder image descriptions, but not judge whether
  a real description is helpful.
- It does not check colour contrast because that requires looking at the
  rendered page.
- It reports problems; it does not rewrite the PDF. The best fix is usually in
  the code or template that created the document.
- It does not break encryption. When text cannot be read, the report says so.
- Decorative images still count as image objects, which is why that check is a
  warning by default.

Use the tool to catch repeatable structural problems, then ask a person using
assistive technology to test important document journeys.

## Designed for untrusted files

PDFs may come from customers or other systems, so the checker treats them as
untrusted input.

- A damaged or non-PDF file returns a `readError` instead of crashing the process.
- Deep, circular, or repeated structures have safety limits.
- Text from the file is cleaned before it reaches the terminal or GitHub.
- Files above 512 MB are refused by default.
- One broken file does not stop the rest of a folder from being checked.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Performance

Checking a folder uses several worker threads by default. In the project's
repeatable 40-document test, version 0.2.0 processed the folder about **3.3
times faster** than version 0.1.0 on the same machine.

The benchmark code and test documents are in [bench/](bench/). Performance
numbers are a guide, not a promise for every computer or PDF.

## Contributing

```bash
npm ci
npm run check
```

That command checks formatting, code quality, types, tests, coverage, the
build, and the published package shape. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the project rules and
[CHANGELOG.md](CHANGELOG.md) for release notes.

## Related

Use [motion-a11y](https://www.npmjs.com/package/motion-a11y) for animation
accessibility and `axe-core` for accessibility checks on rendered web pages.

## Licence

MIT. Use it for personal or commercial projects.
