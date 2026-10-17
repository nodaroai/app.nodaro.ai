# test-dedup

A read-only report of where CI does the same test work twice (CI speed
program, §5.7, phase 1). It changes nothing: it is the evidence a later
de-duplication PR starts from, and every removal still needs its own
equivalence proof.

```sh
node tools/test-dedup/report.mjs --project backend \
  --durations shard1.log --durations shard2.log --durations shard3.log --durations shard4.log \
  --out report.md
```

- `--project frontend|backend|packages|packages/<dir>` (required). `packages`
  is every workspace package with a `test` script, one graph each. The
  package suites run inside the Backend Tests shards, so there is no saving
  estimate for them.
- `--graph <file>`: a test graph written by `tools/test-select/cli.mjs --graph-out`.
  Without it the report builds the graph with `buildTestGraph`
  (`tools/test-select/graph.mjs`, about 100 s; the workspace packages must be
  built). It never builds a second graph of its own.
- `--durations <log>` (repeatable): the CI job logs of that project's test
  shards (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`). The `Duration`
  line of the largest Vitest run in each log gives the suite's import and
  environment time. Vitest's JSON report carries no import time, so it is not
  read. Without logs the report gives no saving estimate.

Its pure parts (`executions.mjs`, `clusters.mjs`, `bodies.mjs`,
`cross-tree.mjs`) use Node built-ins only and are tested by
`tools/__tests__/test-dedup-report.test.mjs`, which runs with no npm install.
`report.mjs` loads Vitest (through `graph.mjs`) and `typescript` lazily.

## The four sections

**(a) Duplicate CI executions.** Every Vitest invocation in
`.github/workflows/ci.yml` (`run-suite.sh`, `npm run test --workspace=…`,
`npm run test` in a package, `npx vitest run <files>`, and the Type Check
parity function), expanded to the files it runs. A file is listed when more
than one invocation runs it on the same event. A job or step condition that
pins `github.event_name` (with no `||`) restricts its events; anything else is
taken to allow every event, which can only over-report. A file that a
dedicated job lists by name and whose suites switch on the environment
(`runIf` / `skipIf`, the real-Redis suites) is listed apart: it runs for real
in one job only.

The parity discovery is read out of `ci.yml` (the `grep -rl -e …` inside the
function that hands its matches to `npx vitest run "${files[@]}"`), emulated
over the tracked files, and checked against the real `grep`. The report fails
if the two disagree.

**(b) Merge clusters.** Files in one directory with one stem (the name up to
its first `-` or `.`), the same `vi.mock` / `vi.doMock` specifiers, at least
50 dependencies each, and a pairwise dependency Jaccard index of at least 0.9
(complete linkage: every pair). Frontend shared-worker files
(`frontend/src/test/no-isolate-files.json`) are left out, as they already
share a worker. The estimated saving is a model: a file's load cost (import +
environment) is taken as proportional to the modules it loads, and merging a
cluster into `k = ceil(lines / 800)` files loads its graph `k` times instead of
once per file: `(Σ deps − k · max deps) × cost per dependency`.

**(c) Copy-pasted test bodies.** Each `it` / `test` body is printed from the
TypeScript AST without comments and keyed by its text (80+ characters), by
its subjects (each imported identifier it uses, with the module it comes
from, relative specifiers resolved) and by the file's mock and setup context.
Same-scope copies (one file, one describe chain) are the candidates. Copies
across files are listed for a human to judge: most are deliberate
per-locale or per-engine twins. Parameterized forms (`it.each`, `.for`,
`.skip`, `.skipIf`, `.runIf`, `.fails`) are not read; tests inside a
`describe.each` / `describe.skipIf` block fold into the enclosing scope (see
`bodies.mjs`).

**(d) Cross-tree parity tests** (`--project backend`). Each file the parity
grep discovers, by what ties it to the frontend tree: it reads files and
declares `@test-watches` naming `frontend/` (`watch-frontend`) or not
(`watch-other`), declares `@test-always`, reads files and declares nothing
(`undeclared-scanner`), imports frontend modules (`imports-frontend`), or none
of these (`neither`: the grep matched a string only).

## Against the plan's figures (2026-10-16)

The plan counted on dev `2caffe217`; this report was first run about 700
files later.

| Figure | Plan | This report |
|---|---|---|
| (a)/(d) parity files / neither / reading frontend (undeclared) | 64 / 27 / 37 (29) | 64 / 27 / 37 (29: 6 watch frontend, 2 watch other) |
| (a) locale completeness run twice | yes | yes (1 file) |
| (b) backend groups / files a merge removes | 114 / 220 | 125 / 247 (372 files in clusters) |
| (b) frontend groups / files a merge removes | 51 / 89 | 53 / 95 (148 files in clusters) |
| (b) packages | — | 29 / 49 (78 files in clusters) |
| (b) model saving, one file / capped (backend + frontend) | 169 + 112 / 134 + 86 s | 178 + 145 / 139 + 110 s |
| (b) `payload*` cluster | 47 files, ≈ 30 s | 47 files, 30.1 s |
| (c) same-scope copies | 27 | 9 (2 backend, 3 frontend, 4 packages) |

**(b)** The plan's 220 / 89 are the files a merge would remove (cluster size
minus one, summed), not the files in clusters: 114 groups of two or more hold
at least 228 files. On that reading this report gives 247 / 95, the drift of
some 700 files since.

**(c)** The key here is strict: one file, one describe chain, and the same
body text after comments and layout are dropped. No key reproduces 27 without
also counting closure-parameterized twins: the same body text in sibling
`describe` blocks that each bind the variables it reads differently
(`describe("character", () => { const route = …; it("…", () => { … route … }) })`
beside the same for `location`). Their text matches, their subject does not, so
they are not copies. Dropping the scope from the key (one file, any describe)
gives 15 in frontend + backend; the 10 extra ones sit in sibling describe
blocks, where the same text usually reads a different binding, so each needs
a look before it counts. The phase-2 hygiene PR starts from these 9.
