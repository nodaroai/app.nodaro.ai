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

## The equivalence harness (`equivalence.mjs`)

Before a de-duplication PR removes a test, merges files or drops a guard, the
harness checks that what the removed test asserts is still asserted
somewhere else (plan §2). Each mode prints a markdown table to paste into the
PR, and exits 0 when the proof holds, 1 when it fails, and 2 when it is
inconclusive. Only a removal heading says `PROVEN`. The other headings are
`REFUTED`, `UNRESOLVED` and `VACUOUS`.

```sh
node tools/test-dedup/equivalence.mjs remove --project backend \
  --candidate 'backend/src/x/__tests__/a.test.ts#suite > title' \
  --keepers backend/src/x/__tests__/a.test.ts,backend/src/x/__tests__/b.test.ts \
  --subject backend/src/x/a.ts:120-260
node tools/test-dedup/equivalence.mjs merge --project backend \
  --before a.test.ts,b.test.ts --after ab.test.ts --subject backend/src/x/a.ts
node tools/test-dedup/equivalence.mjs guard --project backend \
  --candidate g.test.ts --keepers h.test.ts --seeds seeds/
```

### `remove`: kill-set subsumption

The gate is the dependency-free mutator, `mutate.mjs` (decided 2026-10-16).

- It mutates the subjects one site at a time with a fixed operator set. The
  set is StrykerJS's, minus regex and string-method arguments; see the
  header of `mutate.mjs`.
- Every mutant is served from memory to one long-lived Vitest instance. No
  product file is written, and no snapshot is either (`update: "none"`).
- The candidate may go only if `killed(keepers) ⊇ killed(candidate)`.

What counts as a kill:

- **A failed test, or a test under a hook that threw.** A `beforeAll` that
  throws leaves its tests skipped, and an `afterAll` that throws leaves
  them passed. Either way the file is red. A module that fails to load
  takes all its tests.
- **The candidate's kills** come from a run of its own file.
- **The keepers' kills** come only from runs *without* the candidate. It is
  left out of its own file by exact full name. A same-file keeper may fail
  a mutant only because the candidate ran first and left state behind, and
  that is no evidence once the candidate is gone.
  - The keepers must pass on their own before any mutant runs. Keepers that
    need the candidate are refused with exit 2.
  - Each narrowed run is checked to have run exactly what it names.
- **A mutant can rename tests.** Names built from data (catalog ids,
  `it.each` rows) change when the mutant changes that data, so a test can
  appear under a name no baseline test had.
  - A mutant can also rename a test onto a name a sibling already has.
    `it.each([0, 1])` under `0` → `1` collects two "n=1" tests. The
    collection changed either way: one name now on more tests than at
    baseline.
  - Candidate run: when the collection changed, any failing test in the
    file counts as the candidate's kill. Over-counting can only refute.
  - Keeper run: a test with a new name, one name on more tests than at
    baseline, or a keeper test that vanished makes the run unreadable, so
    the mutant is unresolved. A renamed candidate is
    not left out by its old name, and a renamed keeper must not pass or kill
    silently.
  - Guard and merge modes are unaffected. Guard judges a side by any failing
    test in its files, as CI does, so a renamed test that fails is a catch.
    Merge compares the name census, so a rename shows as missing plus new.
- **A keeper's kill must repeat** in a second run, and must be more than a
  timeout. Otherwise the mutant is unresolved. A timeout, an unhandled
  error, or a mutant that never loaded is unresolved too.
- **The coverage pre-filter** drops a site only when the candidate's
  **whole file** never executes it: that is the order in which the
  candidate's kills are measured. Every test in the coverage run must pass.
  - `--prefilter-candidate-only` narrows the coverage run to the candidate's
    own tests. The candidate must still run and pass. This drops more
    mutants, so it is faster, but run alone the candidate can take a
    different branch than in file order. Example: a sibling switched a
    module flag first. The candidate kills a mutant on that branch only in
    file order. The narrow filter drops the mutant as "never executed", and
    if no keeper kills it the result is a false `PROVEN`. The regression
    test `state.cases.mjs` shows the default refuting what the opt-in
    proves. Use the opt-in only for a file whose tests share no module
    state.
  - `--no-prefilter` evaluates every site.
  - Statement ends that Vitest reports as a null column mean "to the end of
    the line". The filter reads them that way, and a statement that starts
    later on the same line counts as the inner one.

`--stryker-report <mutation.json>` reads a StrykerJS kill matrix instead.
Treat it as an optional cross-check, never as the gate. Run Stryker from a
scratch install; it is not a dependency.

- The report must say `disableBail: true` and `coverageAnalysis: "perTest"`.
- A mutant whose `killedBy` or `coveredBy` is missing or names an unknown
  test is unresolved.
- Stryker runs a file's tests together, so its same-file kills have the
  ordering problem described above. Confirm a Stryker `PROVEN` with the
  fallback.

### `merge`: census, coverage and statics

- **Census:** the same test names and the same number of passes. A test
  under a throwing hook counts as a failure.
- **Coverage:** `--subject` is required. The covered statements, branch arms
  and functions must be the same, not just the covered lines. A subject that
  coverage cannot instrument, because it lies outside the project root, is
  refused.
- **Statics** (`census.mjs`):
  - the same `@vitest-environment`;
  - the same `vi.mock` set and factories in every file;
  - no shared-worker file (`no-isolate-files.json`);
  - every hook kept;
  - the union of the `@test-watches` / `@test-always` annotations kept;
  - at most 800 lines per merged file;
  - the same multiset of assertion chains and of test bodies, printed
    without comments. A dropped `expect` fails here, even though names,
    passes and coverage cannot see it.
- A run that timed out or had unhandled errors is unresolved.

### `guard`: seeded violations

- Each seed patch is applied in a scratch worktree of HEAD. Wherever the
  candidate fails, the keepers must fail too.
- A timeout on either side is never a catch; it is unresolved.
- If the candidate catches no seed, the result is vacuous (exit 2).
- **The worktree uses its own workspace packages.** Its `node_modules` links
  third-party packages into the checkout, but `@nodaro/*` resolves to the
  worktree's own `packages/`. The `dist/` directories are copies, and a
  package that a seed touches is rebuilt in the worktree.
- SIGINT and SIGTERM remove the worktree and the scratch directories.

### Self-tests

- **`tools/__tests__/test-dedup-equivalence.test.mjs`** runs with no
  `npm ci`. It has the verdict core and node:test fixtures with precomputed
  sites. Its mutator checks skip without `typescript`.
- **`tools/__tests__/test-dedup-equivalence-vitest.test.mjs`** drives the
  real Vitest runner, coverage and the CLI on a small Vitest fixture project.
  It holds the review probes of #2302 (the hook, ordering and operator
  probes), each of which once produced a false `PROVEN`. It takes about a minute.
  CI runs both files in the **Test De-dup Harness** job (`ci.yml`), which has
  `npm ci`. There `TEST_DEDUP_REQUIRE_VITEST=1` makes a missing install fail
  instead of skip. The Diff Gate starts the job when a file matching the
  Vitest file's `@test-watches` changes, and always on push. A guard test
  holds `ci.yml`'s case list equal to those globs. The no-`npm ci` tools job
  skips these cases.
