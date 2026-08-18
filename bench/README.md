# Benchmarks

Everything here is reproducible from a clean checkout. The corpus is generated,
not committed, so a run does not depend on any file that might drift.

```bash
npm ci && npm run build
npm run bench          # the public API, end to end
npm run bench:cli      # the command line over a folder
node bench/guard.mjs   # the CI sanity check
```

## The corpus

`corpus.mjs` builds twelve documents in memory, covering the normal cases and
the ones that break naive readers:

| Document                    | What it is for                                       |
| --------------------------- | ---------------------------------------------------- |
| `untagged-1p`               | What pdfkit and puppeteer emit by default            |
| `tagged-1p`                 | The smallest fully conformant document               |
| `tagged-50p`, `tagged-500p` | Realistic reports: headings, figures, tables, images |
| `image-heavy-100p`          | 2,000 image XObjects, some behind form XObjects      |
| `annot-heavy-100p`          | 2,000 link and widget annotations                    |
| `deep-nest-20k`             | Adversarial: 20,000 levels of nesting                |
| `nested-tables-200`         | Adversarial: tables inside tables, 200 deep          |
| `wide-table-10k`            | Worst case for the table check                       |
| `cyclic`                    | A structure tree that points back at itself          |
| `not-a-pdf`, `truncated`    | Malformed input                                      |

## The harnesses

- **`run.mjs`** measures `checkPdf` end to end against any build, so the same
  script can measure a previous release and the current one on the same machine
  in the same session. `--module`, `--iterations`, `--only`, `--json`.
- **`analyse.mjs`** measures only the analysis stage, with the document parsed
  once up front. Parsing is roughly 90% of an end to end call, so this is where
  a change to the checker is actually visible. Point it at a bundle that
  re-exports `analyse`:

  ```bash
  mkdir -p .bench-current
  echo 'export { analyse } from "../src/checks.js";' > .bench-current/entry.ts
  npx esbuild .bench-current/entry.ts --bundle --platform=node --format=esm \
    --external:pdf-lib --outfile=.bench-current/analyse.mjs
  npm run bench:analyse
  ```

- **`cli.mjs`** measures the whole command against a temporary folder of forty
  files, at each concurrency level. This is the number that matters to someone
  running the tool in CI.
- **`guard.mjs`** is what CI runs. It is not a performance gate — shared runners
  are far too noisy for that — it asserts that every document, including the
  adversarial ones, completes without throwing and inside a budget generous
  enough that only a genuine complexity regression trips it, and that the
  documents that should produce findings still do.

## Reporting a result

Report before and after from the same machine in the same session, with the
iteration count. Latency on a laptop under thermal pressure is not evidence.
