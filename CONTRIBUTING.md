# Contributing

## Getting set up

```bash
npm ci
npm run check   # format, lint, types, tests with coverage, build, package checks
```

`npm test` builds the CLI first when `dist/` is stale, because the command line
and worker tests run the built files rather than the sources.

## The bar for a change

Everything `npm run check` runs is also a CI gate, and CI is a release gate.

- **A bug fix comes with a regression test.** Every bug listed in the changelog
  has one.
- **A performance claim comes with a measurement.** `npm run bench` measures the
  public API end to end, `npm run bench:cli` measures the command line over a
  folder. Report before and after from the same machine in the same session.
- **A new check earns its false positive rate.** A check that fires on a
  correct document is worse than no check. If a rule cannot be decided from the
  object graph, say so in "What it does not do" in the README instead.
- **Untrusted text stays untrusted.** Anything read out of a PDF goes through
  `quote()` in `src/text.ts` before it reaches a message.

## Layout

| Path                           | What lives there                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/pdf.ts`                   | The object graph layer: typed accessors, the structure tree walk, image counting, permissions, XMP |
| `src/checks.ts`                | The rules, and the single pass over the tree that runs them                                        |
| `src/core.ts`                  | `checkPdf`, severity profiles, the never-throws contract                                           |
| `src/index.ts`                 | `checkFile`, the Node entry                                                                        |
| `src/cli-core.ts`              | Argument parsing, file discovery, `run()`                                                          |
| `src/pool.ts`, `src/worker.ts` | Checking several files at once                                                                     |
| `src/format.ts`                | pretty, json and github output                                                                     |
| `bench/`                       | Corpus, benchmarks and the CI sanity guard                                                         |

## Releasing

1. Update `CHANGELOG.md` under a new version heading.
2. Bump the version in `package.json`.
3. Tag `vX.Y.Z` and push the tag.

The release workflow refuses to publish if the tag and the version disagree, if
the changelog has no entry for the version, or if any CI gate fails.
