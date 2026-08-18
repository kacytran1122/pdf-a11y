# Security

## Reporting

Report a vulnerability through GitHub's private advisory form:
<https://github.com/kacytran1122/pdf-a11y/security/advisories/new>.
Please do not open a public issue for anything exploitable.

Expect an acknowledgement within seven days.

## Threat model

`pdf-a11y` reads files that, by definition, come from somewhere else. Treat
every PDF it is pointed at as hostile input.

What the library guarantees:

- **It never throws.** A damaged, truncated, hostile or non-PDF file comes back
  as a report with `readError` set.
- **Traversal is bounded.** The structure tree is walked iteratively with a node
  and depth limit (`CheckOptions.limits`), so deeply nested or cyclic trees
  cannot exhaust the stack or run forever. Shared subtrees are visited once.
- **Document text never reaches your terminal unfiltered.** Alt text, language
  tags and form field names are stripped of control characters and truncated
  before they appear in a message, so a PDF cannot inject ANSI escapes into a
  terminal or a newline into a GitHub Actions annotation.
- **Structure tag names cannot reach `Object.prototype`.** `facts.tags` is built
  from a `Map`, so a tag called `__proto__` is data, not a prototype write.
- **Files are size capped.** `checkFile` refuses anything over
  `MAX_FILE_BYTES` (512 MB) unless you raise `maxBytes`.

What it does not do:

- **It does not decrypt.** Encrypted files are read with the encryption ignored,
  so their strings stay ciphertext. The report says so in `limitations`, and
  checks that judge the _content_ of a value are skipped rather than guessed at.
- **It does not execute anything in the PDF.** JavaScript actions, embedded
  files and launch actions are never run, opened or extracted.
- **It makes no network requests**, and it writes nothing except the report.

## Supported versions

The latest minor release receives security fixes.
