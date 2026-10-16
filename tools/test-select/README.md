<!-- tools/test-select/README.md -->
# test-select

Picks the vitest files a change can affect. CI runs it on every PR into `dev`
(it reads the PR's files from the GitHub API with `GH_TOKEN`/`GITHUB_TOKEN` —
no `gh` binary needed); every dev commit then runs the full suite (`post-merge`
mode, no coverage — coverage runs nightly);
`npm run test:affected` runs the same selection locally against `origin/dev`
(committed, uncommitted and untracked changes). It builds the workspace
packages first — without their `dist/` the graph has no package edges — and
runs both projects even when the frontend fails, exiting non-zero if either did.

## Shadow mode, then enforcement

PRs into `dev` run in **shadow mode** first (decided 2026-10-13): the FULL
suite runs and alone decides pass/fail; the selector still runs (`cli.mjs
--shadow`), its choice goes into the job summary as `shadow (would run:
affected|none|full)`, and `shadow-check.mjs` compares it with what failed. A
failing test file the selector would have skipped is a **selector miss**: a
`Selector miss` warning annotation, a `#### Shadow check` section in the
summary, and an entry in the `shadow-frontend-<shard>` / `shadow-backend-<shard>`
artifacts. Each suite runs in four shards (`SHARD=i/4` in `run-suite.sh`, decided
2026-10-14); `shadow-report.mjs` merges a run's shards per project, and a shard
that finished without shadow data counts against a clean record.
A run that failed with no failing test file (a crash before the report), or
that logged a Vitest unhandled error (the JSON report does not record those),
cannot be fully checked against the selection: it is recorded as
**unattributed** — a possible miss, which a clean record excludes. So is a
selector that crashed (the job falls back to a plain full run).
The shadow check is reporting only — it can never change a run's result.

**Pass cache** (§5.6, decided 2026-10-14; `pass-cache.mjs`, `pass-cache-cli.mjs`).
On a PR, a test file whose exact inputs already passed is not run again. Its
key hashes the file, every module Vitest's graph says it loads (workspace
`dist/` files included), the files its `@test-watches` and its modules' `@reads`
name, its snapshot, and an environment key (the global triggers, undeclared
test data, the Node version, `PASS_CACHE_EPOCH`). Never cached: `@test-always`
files, untagged scanners, files that load an undeclared reader, and the frontend
shared-worker files. Each shard plans its own files by a stable hash of the
path, then drops the cached ones — so no file falls between shards whatever
each shard restored. The fan-in job merges the shards' proven passes into a new
Actions-cache entry (`test-pass-<project>-<run>`); the next run restores the
newest. Dev's post-merge runs record passes (they seed every PR) but never skip
anything, and neither does shadow mode (decided 2026-10-14: a cached skip
uses the selector's own dependency knowledge, so it could hide the misses the
shadow week exists to find) — the cache records during shadow mode and starts
skipping once `TEST_SELECT_ENFORCE=true`. A file counts as passed only when
every one of its tests ran and passed; the key also carries the ISO week and
the runner image, which bounds what it cannot see (the clock, system
libraries, a flaky pass) to a week. Bump `PASS_CACHE_EPOCH` to throw every
recorded pass away.

In CI the Select step reads the change from the checked-out merge commit
(`--merge-commit`: its diff against the first parent), not the PR files API:
the commit is fixed by the run's SHA, so all four shards select from the same
diff even if the PR moves while they start.

Two refinements of the "run everything" rules (decided 2026-10-15): a
`package.json` or `package-lock.json` change that only bumps versions (a
release) is no global trigger — a package's own bumped manifest still selects
that package's consumers, since its build may inline the version; and the test
data listed in `declared-test-data.json` (generated goldens) selects its
readers instead of every test — `test-data-readers-guard.test.mjs` fails when
any file names such a golden without importing it or declaring it.
**Mock-aware edges** (decided 2026-10-15; `mocks.mjs`). A test that replaces a
module with `vi.mock("<module>", () => …)` never loads the real module, so the
graph does not enter it: a change to that module (or to what is reachable only
through it) does not select the test. Every form that may load the real module
keeps the edge — one argument (automock / `__mocks__`), `{ spy: true }`, a
factory that is not an inline function, or one that names `importOriginal`,
`importActual`, `importMock`, `requireActual`, `import(` or `require(`;
`vi.doMock`; and a module the test also un-mocks. Measured on the full graph:
no test gains a dependency, every test without a factory mock is unchanged,
mean dependencies per test 284 → 225 (backend) and 171 → 126 (frontend);
`credits.ts` reaches 920 → 653 backend tests, `supabase.ts` 1,453 → 610.
**Symbol-level @nodaro/shared** (decided 2026-10-15: an engine-only index, no
public API change; `package-symbols.mjs`). In CI a change to modules of
`packages/shared/src` reaches only the names exported by the modules that import
it, directly or transitively (template `import()` loaders included). A test is
then selected through the package only if its own file or an app module it loads
imports one of those names. Any doubt keeps the package rule: a deleted or
non-`.ts` source, a top-level call in a changed module (it may register into
another), a test or module that takes the whole namespace (`import *`, `export
*`, `import()`, `vi.mock` of the package), or a test that also loads another
workspace package (prompts and the rest use shared; their use is not indexed).
Replayed over the last 247 commits touching shared: 244 narrow; the app modules
importing a reached name are a median 24 % of the package's importers.
**Key-level i18n** (decided 2026-10-15; `i18n-keys.mjs`). Every component
that calls `t()` reaches every locale dict, so a one-string change used to
select ~1,000 frontend tests. In CI (`--merge-commit`) a change that only adds,
removes or rewrites `"key": value` lines in a locale dict selects the tests
that can see a changed key: their own file or a module they load names the key
as a string literal, or they reach a module that imports a dict as data (the
resolver `i18n/index.ts` and registry `i18n/dicts.ts` excepted). Any doubt keeps
today's rule: another kind of edit in the dict, a key no source names literally,
a template literal or a concatenated dotted prefix (`"nodes." + type`) outside
the dict readers that could build it. Replayed over the last 232 dict commits:
178 narrow, with a median of 44 user files.

Enforcement — PRs into `dev` run only the selected tests — is the repository
variable `TEST_SELECT_ENFORCE=true` (exactly `true`; anything else, unset
included, stays in shadow mode). No code change flips it.
`node tools/test-select/shadow-report.mjs --since <ISO date>` (a local tool,
`gh` authenticated) lists the misses across the shadow runs since then and the
median share of each suite the selector would have run — the evidence for
flipping the variable. It reports "Clean" only when no run has a miss, an
unattributed failure, a crashed selector, an unreadable check, or a test job
that ran without leaving shadow data. A run counts whether its PR is open or
already merged (the base of a merged PR is found through its commit, since
GitHub lists a run's PR only while it is open); a run whose base cannot be
determined counts as missing data. Pick a `--since` no earlier than shadow
mode reaching `dev`: an older PR run into `dev` counts as missing data too.

## Post-merge failures are never re-run green

On a dev commit, a test file that fails is re-run once, alone, only to label
it for the comment on the merged PR: failed again, passed alone — likely
flaky, or unknown when the re-run crashed without a report. Either way the
run stays red (decided 2026-10-13): `verified` lets
`main` skip its tests because the same tree passed on `dev`, so a green dev
run must never rest on a masked failure. Fix the flaky test, or re-run the
workflow.

## How a test is selected

A test file runs when, compared with the base:

- the test file or its snapshot changed;
- it imports (directly or through any chain) a changed file — the graph is
  Vitest's own, the one `vitest --changed` walks;
- it uses a workspace package any file of which changed (`src/`, build
  config, scripts) — the package's own tests and its markdown docs outside
  `src/` excepted; narrowed to the built files a `src/` change ends up in
  when the package's build metafile is there (see below);
- it declares `// @test-always <reason>`;
- a changed file matches a glob it declares in `// @test-watches <glob>…`;
- it reads files at run time (`readFileSync`, `readdir`, `git ls-files`, …),
  itself or through a test helper it imports, and declares neither — the safe
  default;
- a product module it reaches declares `// @reads <glob>…` and a changed file
  matches;
- a product module it reaches reads files without declaring `@reads` or
  `@reads-none` (or could not be read), and any file that is not a JS/TS
  module changed — `.json` and `README.md` included, anywhere in the repo;
  only `CLAUDE.md` is never read — the safe default.

The whole suite runs instead when a global file changed (package manifests,
lockfile, vitest/vite/tsconfig configs, test setup, `ci.yml`, this
directory, the `Dockerfile` and `tools/install-pinned-ffmpeg.sh` that pin the
ffmpeg the backend's e2e tests run against), any file other than a test file
was removed or renamed under `frontend/`, `backend/` or `packages/` (tests
import across projects by path), a manual mock changed, test
data changed (a non-JS/TS file under `__tests__/`, `__goldens__/`,
`__fixtures__/`, `fixtures/` or a test-helper directory — snapshots excepted,
they select their own test), the diff is too large to list, or the engine
could not decide.

## Package changes and build metafiles

Tests load a workspace package through its build (`packages/<name>/dist/…`),
never its `src/`. On its own, the engine cannot tell which built file a
`src/` change lands in, so it selects every test that uses the package.

A package whose `tsup.config.ts` sets `metafile: true` also writes
`dist/metafile-esm.json` / `metafile-cjs.json`. Each holds two things:
- `outputs`: each output file and the sources it carries bytes from;
- `inputs`: every source and the sources it imports.

`package-chunks.mjs` reads both. A change narrows to the tests that load an
output it can reach:
- an output built from the changed file;
- an output built from any source that imports the changed file, directly or
  through other sources;
- every output that imports one of those.

The second case is needed because an output's own list leaves out any source
that contributes no bytes to it, even though a change to that source can
change the output. That happens to a TS enum, whose values are inlined where
they are used, and to a module tree-shaken out of one output but kept in
another. The import graph in `inputs` records those edges anyway. With split
chunks, a module in one entry's chunk selects only that entry's consumers.
Until the packages emit metafiles, nothing changes.

The whole-package rule still applies in these cases:
- the metafile is missing, unreadable or not esbuild's shape, including one
  with no `inputs` import graph;
- an output it lists is missing or newer than it (the dist is from another
  build);
- a source imports something esbuild left external that is not a package
  name (`./x`, `../x`, `/x`, `#x`, `~/x`, `@/x`). That may be a file of the
  package esbuild did not follow; tsup's treeshake records an unused relative
  import this way;
- a source imports, or an output is built from, a file the metafile does not
  describe;
- a changed file is not under `src/` (build config, scripts);
- a changed `src/` file reaches no output (a new file, a type-only module);
- the test reaches a file under the package that no metafile lists (the cjs
  build with only an esm metafile, source imported by path).

A metafile that cannot be loaded never forces a full run.

## Tests that read files

A test that reads the source tree or a fixture has no import edge to what it
reads. Tell the engine what it reads, at the top of the file:

```ts
// @test-watches frontend/src/**/*.tsx frontend/src/lib/i18n/*.ts
```

or, when it genuinely depends on everything:

```ts
// @test-always walks every tracked file with git ls-files
```

or, when its file reads never touch the repo (temp files it writes):

```ts
// @test-reads-none reads only the temp files it writes
```

A test helper (a non-test file under `__tests__/`, `src/test/`,
`test-utils/` or `fixtures/`) is part of the tests that import it: annotate it
with `@test-watches` / `@test-always` / `@test-reads-none`, like a test. A helper that reads only
the paths its caller passes it (a parse cache, a file loader) has nothing of
its own to declare — the importing test decides what is read — so it says so:

```ts
// @test-reads-for-caller reads only the source files the guard passes it
```

The marker only adds a requirement: any `@test-watches` / `@test-always` the
helper declares still flows into the tests that import it, and a test
importing it must ALSO declare `@test-watches` / `@test-always` /
`@test-reads-none` itself (watches inherited from a helper do not count), or it runs on every change. A
helper that imports such a module is a caller too: the guard fails it unless
it carries `@test-reads-for-caller` itself or declares `@test-watches` /
`@test-always`. `@test-reads-none` does not pass there, because nothing can
check it: if the helper handed the module repo paths under that marker, the
tests importing it would truthfully declare only their own reads, the
helper's requests would be declared by no one, and a change to those files
would select none of those tests. So such a helper names what it has the
module read (`@test-watches`), or passes the declaration on to its own
callers (`@test-reads-for-caller`).

Globs are repo-relative; `**`, `*`, `?` and `{a,b}` are supported.
`tools/__tests__/test-watches-guard.test.mjs` fails a new file-reading test
that declares none of these, and a glob that matches no tracked file. The
files that predate the rule are listed in `untagged-scanners.json`; that list only
shrinks.

## Product code that reads files

A product module that reads repo files at run time (skills markdown, docs,
migrations, templates) declares them, so a change to one of those files runs
exactly the tests that reach the module:

```ts
// @reads backend/skills/**/*.md
```

A module whose file reads never touch the repo (temp files, uploads, paths
from the user) says so:

```ts
// @reads-none reads only the temp files it creates
```

`tools/__tests__/reads-guard.test.mjs` fails a new file-reading module with
neither. Until a module is declared (the burn-down in
`undeclared-readers.json`), any change to a non-code file runs every test that
reaches it.

## Registries (node units)

Node units (`frontend/src/nodes/<type>/`, `backend/src/nodes/<type>/`,
`tools/units/README.md`) are collected into generated aggregates under
`_generated/`, and a few central **composers** spread them into the
collections the product reads (`NODE_DEFINITIONS`, `NODE_OPTIONS`, …).
Every test that imports a composer reaches every unit, so without a rule a
one-line edit inside one unit would select every test that touches a
registry. `registry.mjs` holds the rule (decided 2026-10-16):

| Annotation | On | Meaning |
|---|---|---|
| `// @registry <glob>…` | aggregate | its imports of matching files are **member edges** |
| `// @registry-exports <aggregate>: <Name>…` | aggregate | the names the aggregate's collection is consumed through. A **composer** declares the names it re-exports in `tools/units/registry-composers.json` (`exports`), and is a pass-through for those registries, not an enumerator |
| `// @registry-lookup <reason>` | product module | names a registry export but only looks up the entry for a type it is given |
| `// @registry-enumerates <reason>` | product module | iterates the collection (what an undeclared module is assumed to do) |
| `// @test-units-by-name <reason>` | test or helper | names a registry export but only looks up the unit types it names literally |

A changed file **inside a unit folder** that a test reaches **only through
member edges** does not select it by "imports". It selects the test when (a)
the test reaches an **enumerator** of that registry (a module that names an
export, is not a pass-through and does not declare `@registry-lookup`), (b)
the test names the unit's type id as a string literal, (c) the test names a
registry export and declares neither `@test-units-by-name`, `@test-always`
nor a `@test-watches` covering the changed file (a watch of migrations,
docs, the other tree's units or other unit files does not waive it; G4
counts a watch of `{frontend,backend}/src/nodes/**` as declared; the burn-down
`registry-users-tests.json`: counted as needing every unit), or (d) the
changed module fails G7's AST check (`tools/units/structure.mjs`, run by the
CLI) or could not be checked — then every test reaching the registry. A file
outside the unit folders is never narrowed. Composer exports that read a
composed collection (`getEnrichedRegistry`, `FAMILY_RANK`, `localize*`) are
listed in `registry-composers.json` (`exports`, or `lookups` for one-type
answers), and `node-units-structure.test.ts` fails an unlisted one. An
aggregate diff made only of `// unit:<type>` lines (a member added or
removed; `--merge-commit` only) is narrowed the same way. `@test-always`, `@test-watches`, `@reads` and the
scanner rules keep their precedence. The full closure stays the test's
`deps`, so the pass cache is still invalidated by any unit change.

**Its own shadow period.** Until the repository variable
`TEST_SELECT_REGISTRY_RULE` is exactly `enforce`, the selection is today's;
the narrowed one is recorded beside it (`registryRule.selection` in
`selection-<project>.json`, `--registry-list`), and a failing test it would
have skipped — a failure the main selection covers and the rule's does not —
is a **Registry-rule miss**: an annotation, a summary line, and
`registryMisses` in the shadow artifact (in affected mode,
`registry-check-<project>.json` in the selection artifact). `shadow-report.mjs`
reports them apart from the selector's own misses (also from affected runs'
selection artifacts), counts only runs where the two selections differ, and
they never decide its "clean". This works whether the main selector is in shadow mode or enforcing.
With no unit in the tree, nothing here runs and selection is byte-identical.
