<!-- tools/structure/README.md -->
# Structure ratchets

Four guards on the shape of the import graph of `backend/src` and
`frontend/src`. Each records today's state in a JSON baseline that may only
shrink, in the style of `tools/test-select/untagged-scanners.json`.

Only C1 and C3 fail the build. C2 and C4 are **report only** (decided
2026-10-15, after measuring that about a third of recent dev commits would
have tripped them): they print a trend line per project (new, grew, shrank
against the baseline, plus the heaviest tests or the files that entered) and
their offenders to the CI log, as notices and in the job summary.

| | Ratchet | Mode | Flags | Baseline |
|---|---|---|---|---|
| C1 | Cycles | **fails** | the largest import cycle (strongly connected component of product files) of a project grows, or a cycle of 3+ files appears whose members are not all inside one recorded cycle | `cycles.json` |
| C2 | Test import budget | report | a test loads more than `default` (300) product files and is not listed, or a listed test loads more than its recorded count | `import-budget.json` |
| C3 | Boundaries | **fails** | `frontend/src/lib/**` imports `frontend/src/components/**` or `frontend/src/app/**` through an edge that is not recorded; a node unit (`{frontend,backend}/src/nodes/<type>/`) imports another unit, a `_generated/` aggregate or an engine module (`node-units`, G5 of `tools/units/README.md`) | `boundaries.json` |
| C4 | Hub register | report | a product file is loaded by ≥ 25 % of its project's tests and is not in the register | `hubs.json` |

Every message names the offending edge or file and the fix: break the cycle,
import a narrower module, move the shared piece into `lib/`. **Never add an
offender to a baseline**; that defeats the ratchet.

The backend rule "core may not import `ee/billing/credits.ts` except through
the shims" is not a C3 rule here. `tools/check-ee-imports.mjs` already fails
any static core → `ee/` import outside its allowlist, and the dynamic
`import()` it does not match is the shim path.

## What is counted

`scanner.mjs` parses each file once with the repo's own TypeScript (no new
dependency) and keeps only the imports that load something at run time:
`import … from`, `import "x"`, `export … from`, literal `import("x")`,
`require("x")` and `vi.importActual("x")`. It skips `import type`,
`export type`, type-only specifiers, and imports in a TypeScript file whose
bindings are only used as types (the compiler and esbuild drop those, so Vitest
never loads them). It resolves relative paths (`.js` → `.ts`/`.tsx`, directory
`index` files) and the tsconfig `paths` aliases (`@/`); packages, including
`@nodaro/*`, are not followed.

- **Product file**: a source file under `src/` that is neither a test nor a
  test-side helper (`__tests__/`, `test/`, `test-utils/`, `fixtures/`).
- **A test's closure**: every file it reaches through value imports, helpers
  included. C2 and C4 count only the product files in it.
- The scan reads the working tree, so locally it also sees untracked files.

## Running it

CI runs the ratchets in the frontend Vitest suite:
`frontend/src/__tests__/structure-ratchets.test.ts` (C1 and C3 as tests on
the full scan of both projects; the C2/C4 report goes to the log, the notices
and the job summary) and `structure-scanner.test.ts` (unit tests on
in-memory fixtures). They run there because the tools self-test job
(`node --test tools/__tests__`) has no `npm install`, so it has no TypeScript
to parse with. The backend tsconfig has no `allowJs` for these `.mjs` modules.

```sh
node tools/structure/cli.mjs             # check; exit 1 on a C1/C3 violation, C2/C4 printed
node tools/structure/cli.mjs --tighten   # shrink the baselines to what is true now
```

## Updating the baselines

- **Something got better** (a cycle shrank, a hub dropped below 25 %, a listed
  test slimmed down, a recorded boundary edge is gone): the check prints a note
  and, in CI, a notice annotation. Run `--tighten` and commit the JSON diff.
  `--tighten` only removes entries and lowers numbers, and it refuses to run
  while C1 or C3 fails.
- **Something got worse**: for C1/C3, fix the code; the failure says how. For
  C2/C4 the report names the offenders; nothing blocks, and `--tighten` never
  adds them.
- `--init` rewrites every baseline from today's state, violations included. It
  exists to create the baselines. Using it later loosens the ratchets; that
  shows up as a JSON diff a reviewer must accept.
