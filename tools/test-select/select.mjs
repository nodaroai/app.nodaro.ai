// tools/test-select/select.mjs
// Which test files a change can affect. Pure: the graph and the change list
// come in, a decision comes out. Every rule that cannot be sure says "full".
import { readFileSync } from "node:fs"
import { matchesAny } from "./glob.mjs"
import { outputsBuiltFrom } from "./package-chunks.mjs"
import { TEST_FILE, TEST_SIDE_HELPER } from "./test-node.mjs"
import { unitOf } from "./registry.mjs"

// Changing any of these can change the outcome of ANY test — through
// dependencies, configuration, the shared setup, or this engine itself.
export const GLOBAL_TRIGGERS = [
  "package.json", "**/package.json", "package-lock.json",
  "**/vitest.config.*", "**/vitest.*.config.*", "**/vite.config.*", "**/tsconfig*.json",
  "frontend/src/test/**", "backend/src/test/**",
  ".github/workflows/ci.yml", ".github/actions/**",
  // this engine: its code, the script that runs every suite, and the data its
  // code reads (decided 2026-10-18 — not its README, its type declarations or
  // the burn-down lists only the tools/__tests__ guards read;
  // test-select-triggers.test.mjs classifies every file here)
  "tools/test-select/**/*.{mjs,js,ts}", "tools/test-select/run-suite.sh", "tools/test-select/declared-test-data.json",
  // the registry rule's side-effect check (G7's predicate, registry.mjs (d)),
  // and the composer list graph.mjs reads for it
  "tools/units/structure.mjs", "tools/units/registry-composers.json",
  // pin the ffmpeg binary the backend's real-ffmpeg e2e tests run against
  "Dockerfile", "tools/install-pinned-ffmpeg.sh",
]
// A vitest/vite config under tools/__tests__/fixtures/ is a fixture that a
// tool's own node tests load (the test-dedup harness), never the config of a
// suite (decided 2026-10-18). It is judged like any other file: the tests
// that import or watch it are selected. Only there: a config anywhere else,
// even inside a test directory, stays a trigger.
const FIXTURE_CONFIGS = ["tools/__tests__/fixtures/**/{vitest.config.*,vitest.*.config.*,vite.config.*}"]
export const NOT_VERSION_ONLY = "more than versions and workspace ranges changed"
export function isGlobalTrigger(path) {
  return matchesAny(path, GLOBAL_TRIGGERS) && !matchesAny(path, FIXTURE_CONFIGS)
}
// The GitHub files API stops at 3000 entries; past this we cannot see the diff.
export const MAX_VISIBLE_CHANGES = 2900
// Test data whose every reader is known (decided 2026-10-15): generated goldens
// that tests either import (the graph sees it) or declare with @test-watches.
// test-data-readers-guard.test.mjs proves no other file names them, so a
// change selects their readers instead of every test.
export const DECLARED_TEST_DATA = JSON.parse(readFileSync(new URL("./declared-test-data.json", import.meta.url), "utf8"))

// Any file under a package can change its build (tsup config, build scripts,
// src) — except its tests and its prose docs. Markdown under src/ may be
// bundled, so it still counts. With the package's build metafile, a src change
// narrows to the outputs built from it (package-chunks.mjs).
const PACKAGE_FILE = /^packages\/([^/]+)\//
const PACKAGE_DOC = /^packages\/[^/]+\/(?!src\/)(?:.*\/)?[^/]+\.md$/i
// Tests import across projects by path (frontend tests read backend templates
// and fixtures), so a removal anywhere under these can break either project.
const REMOVAL_SCOPE = /^(?:frontend|backend|packages)\//
const IN_TEST_DIR = new RegExp(`(?:/__tests__/|${TEST_FILE.source})`)
const JS_TS_MODULE = /\.[cm]?[jt]sx?$/
// Agent instructions only. README.md is NOT here: docs/nodes/README.md is
// read at run time by docs-inventory.ts.
const NEVER_READ_BY_TESTS = ["**/CLAUDE.md"]
// Test data lives next to the tests that read it: goldens, fixtures, sample
// files under __tests__/. Their readers use spellings no scanner list can be
// sure to know (`toMatchFileSnapshot` was missed until a review found it).
const TEST_DATA_DIR = /\/(?:__tests__|__goldens__|__fixtures__|fixtures)\//
const SNAPSHOT = /^(.*)\/__snapshots__\/(.+)\.snap$/

// `packageChunks`: { "packages/<name>/": chunk map } from loadPackageChunks —
// optional; a package without one is judged by the whole-package rule.
// `registryRule` (registry.mjs): "shadow" (the default — today's selection,
// with the narrowed one recorded beside it) or "enforce" (the narrowed one
// is the selection). The result always carries `registryRule: { mode,
// selection }`, the narrowed selection, so a shadow run can be checked.
export function selectTests({ project, changes, tests, packageChunks = {}, registryRule = "shadow" }) {
  const rule = registryRule === "enforce" ? "enforce" : "shadow"
  const decided = decide({ project, changes, tests, packageChunks })
  const narrowed = decided.pick ? decided.pick(true) : decided
  const main = decided.pick ? (rule === "enforce" ? narrowed : decided.pick(false)) : decided
  return { ...main, registryRule: { mode: rule, selection: { mode: narrowed.mode, reason: narrowed.reason, files: narrowed.files } } }
}

function decide({ project, changes, tests, packageChunks }) {
  const full = (reason) => ({ mode: "full", reason, files: [] })
  const inProject = (p) => p.startsWith(`${project}/`)

  if (changes.length >= MAX_VISIBLE_CHANGES) return full(`the diff lists ${changes.length} files — too many to see them all`)
  const trigger = changes.find((c) => isGlobalTrigger(c.path) && !c.versionOnly)
  // A manifest the CLI checked (`versionOnly: false`) says so, so a report can
  // tell it from one judged before the workspace-range rule or never checked.
  if (trigger) return full(`${trigger.path} can affect every test${trigger.versionOnly === false ? ` — ${NOT_VERSION_ONLY}` : ""}`)
  // A removed module drops out of the graph, so a test that still imports it
  // would never be selected — and it is exactly the test that now fails.
  const removed = changes.find((c) => c.status === "D" && REMOVAL_SCOPE.test(c.path) && !TEST_FILE.test(c.path))
  if (removed) return full(`${removed.path} was removed or renamed — a test may still import it`)
  const mock = changes.find((c) => inProject(c.path) && c.path.includes("/__mocks__/"))
  if (mock) return full(`${mock.path} is a manual mock — vi.mock() loads it without an import`)
  // The backstop for the next unknown read spelling: test data changes
  // rarely, so running everything costs little. No @test-watches claim
  // exempts it — a watcher says who else reads a file, not that nobody does.
  const testData = changes.find((c) => inProject(c.path) && !JS_TS_MODULE.test(c.path) && !SNAPSHOT.test(c.path)
    && (TEST_DATA_DIR.test(c.path) || TEST_SIDE_HELPER.test(c.path)) && !DECLARED_TEST_DATA.includes(c.path))
  if (testData) return full(`${testData.path} is test data read at run time — running everything`)

  const changed = new Set(changes.map((c) => c.path))
  const packageChanges = changes
    .filter((c) => PACKAGE_FILE.test(c.path) && !IN_TEST_DIR.test(c.path) && !PACKAGE_DOC.test(c.path))
  const changedPackages = [...new Set(packageChanges.map((c) => `packages/${c.path.match(PACKAGE_FILE)[1]}/`))]
    .map((pkg) => {
      const own = packageChanges.filter((c) => c.path.startsWith(pkg))
      const symbols = own.every((c) => Array.isArray(c.sharedNames)) ? new Set(own.flatMap((c) => c.sharedNames)) : null
      return packageScope(pkg, own.map((c) => c.path), packageChunks?.[pkg], symbols)
    })
  const snapshotOwners = new Map(changes
    .map((c) => c.path.match(SNAPSHOT))
    .filter(Boolean)
    .map((m) => [`${m[1]}/${m[2]}`, m[0]]))

  // A non-code file can be read at run time by product code (skills markdown,
  // docs, migrations, templates). Declared readers (`@reads`) are selected
  // precisely; a test that reaches an UNDECLARED file-reading module is
  // selected by any non-code change — the fail-safe while the burn-down in
  // undeclared-readers.json is not empty.
  // `.json` counts: product code may read it as text as well as import it.
  const nonModule = changes.filter((c) => !JS_TS_MODULE.test(c.path) && !SNAPSHOT.test(c.path) && !matchesAny(c.path, NEVER_READ_BY_TESTS))

  // A locale dict change with key-level users (i18n-keys.mjs) selects those
  // users, not every test that reaches the dict.
  const narrowed = new Map(changes.filter((c) => Array.isArray(c.i18nUsers)).map((c) => [c.path, new Set(c.i18nUsers)]))
  // Registry rule inputs (cli.mjs marks them): an aggregate diff made only of
  // member lines, and whether a changed unit module passed G7's AST check
  // (declarations only). Unmarked means unknown, which never narrows.
  const registryUnits = new Map(changes.filter((c) => Array.isArray(c.registryUnits) && c.registry).map((c) => [c.path, { registry: c.registry, units: c.registryUnits }]))
  const sideEffectFree = new Set(changes.filter((c) => c.sideEffects === false).map((c) => c.path))
  const pick = (useRegistry) => {
    const ctx = { changes, changed, changedPackages, snapshotOwners, nonModule, narrowed, useRegistry, registryUnits, sideEffectFree }
    const files = tests
      .map((t) => ({ file: t.file, why: reasonFor(t, ctx) }))
      .filter((f) => f.why)
      .sort((a, b) => a.file.localeCompare(b.file))
    return files.length
      ? { mode: "affected", reason: `${files.length} of ${tests.length} test files can be affected`, files }
      : { mode: "none", reason: `no ${project} test imports or watches a changed file`, files: [] }
  }
  return { pick }
}

// How a changed dependency `d` reaches the test, when the registry rule may
// narrow it: `d` is a file INSIDE a unit folder reached only through member
// edges (`viaRegistry`), or an aggregate whose diff only added or removed
// members. A file outside the unit folders is never narrowed, even when only
// units reach it: G7 does not hold it to declarations-only. null = the plain
// "imports" rule.
function registryScope(t, d, ctx) {
  const via = t.viaRegistry?.[d]
  if (via && unitOf(d)) return { registries: via.registries, units: via.units, sideEffects: !ctx.sideEffectFree.has(d) }
  const members = ctx.registryUnits.get(d)
  if (members) return { registries: [members.registry], units: members.units, sideEffects: false }
  return null
}

// Rules (a)–(d) of registry.mjs, for one changed dependency.
function registryReason(t, d, scope) {
  const regs = scope.registries
  if (scope.sideEffects) return `reaches ${d} through the ${regs.join("/")} registry, and ${d} may have top-level side effects`
  for (const r of regs) if (t.enumerates?.[r]) return `reaches ${t.enumerates[r]}, which enumerates the ${r} registry; ${d} changed`
  for (const u of scope.units) if (t.typeLiterals?.includes(u)) return `names the unit "${u}"; ${d} changed`
  // A watch waives (c) only when it covers THIS changed file (the watch rule
  // then selects the test): a test watching migrations, docs, or only the
  // other tree's units (backend/src/nodes/** for a frontend unit change), or
  // only some unit files (price.ee.ts when tiers.ts changed), still needs it.
  const declared = t.unitsByName || t.always || matchesAny(d, t.watches ?? [])
  if (!declared) {
    for (const r of regs) {
      const names = t.registryNames?.[r]
      if (names?.length) return `names ${names[0]} (the ${r} registry) and declares no @test-units-by-name — counted as needing every unit; ${d} changed`
    }
  }
  return null
}

// Order matters: `always` and an untagged reader come before `watches`,
// because a test may inherit watches from one helper while another helper is
// an untagged reader; and a watcher never prevents any other test from being
// selected.
function reasonFor(t, ctx) {
  if (ctx.changed.has(t.file)) return "the test file itself changed"
  const snapshot = ctx.snapshotOwners.get(t.file)
  if (snapshot) return `its snapshot ${snapshot} changed`
  for (const d of t.deps) {
    if (!ctx.changed.has(d) || ctx.narrowed?.has(d)) continue
    const scope = ctx.useRegistry ? registryScope(t, d, ctx) : null
    if (!scope) return `imports ${d}`
    const why = registryReason(t, d, scope)
    if (why) return why
  }
  for (const [dict, users] of ctx.narrowed ?? []) {
    if (!t.deps.includes(dict) && t.file !== dict) continue
    const user = users.has(t.file) ? t.file : t.deps.find((d) => users.has(d))
    if (user) return `${user} uses a key changed in ${dict}`
  }
  const pkg = packageReason(t, ctx.changedPackages)
  if (pkg) return pkg
  if (t.always) return `@test-always: ${t.always}`
  if (t.scanner && t.passThroughOnly) return "uses a helper that reads only what its caller passes, and declares no @test-watches/@test-always/@test-reads-none"
  if (t.scanner) return "reads files at run time (itself or through a test helper) and declares no @test-watches/@test-always/@test-reads-none"
  const reads = t.reads ?? []
  const declared = reads.length ? ctx.changes.find((c) => matchesAny(c.path, reads)) : null
  if (declared) return `a module it uses declares @reads matching ${declared.path}`
  if (t.undeclaredReader && ctx.nonModule.length) {
    return `uses ${t.undeclaredReader}, which reads files without declaring @reads, and ${ctx.nonModule[0].path} changed`
  }
  if (t.watches.length) {
    const hit = ctx.changes.find((c) => matchesAny(c.path, t.watches))
    return hit ? `watches ${hit.path}` : null
  }
  return null
}

// A changed package narrows to the outputs built from its changed files only
// when every one of them is a src file its metafile places in some output.
// Anything else — no metafile, a build-config or script change, a src file in
// no output (new, type-only) — keeps the whole-package rule.
function packageScope(pkg, files, chunkMap, symbols = null) {
  if (!chunkMap) return { pkg, built: null, symbols }
  const built = new Map() // output → the changed source it was built from
  for (const file of files) {
    const outputs = file.startsWith(`${pkg}src/`) ? outputsBuiltFrom(chunkMap, file) : null
    if (!outputs) return { pkg, built: null }
    for (const out of outputs) if (!built.has(out)) built.set(out, file)
  }
  return { pkg, built, known: chunkMap.outputs, symbols }
}

// §5.8 A2a: the names a @nodaro/shared change can reach (package-symbols.mjs,
// computed by the CLI) — a test that imports none of them, through its own file
// or any app module it loads, is not selected through the package. Only when
// every change in the package came with names, the test's imports are known by
// name, and it loads no OTHER workspace package (prompts and the rest use
// shared too — their use is not indexed).
function untouchedBySymbols(t, scope) {
  if (scope.pkg !== "packages/shared/" || !scope.symbols || !Array.isArray(t.sharedImports)) return false
  if (t.deps.some((d) => d.startsWith("packages/") && !d.startsWith(scope.pkg))) return false
  return !t.sharedImports.some((n) => scope.symbols.has(n))
}

// Narrowed only for a test whose every file under the package is an output the
// metafile describes: a dist file it does not list (the cjs build when only
// the esm metafile exists, a copied asset) or package source imported by path
// keeps the whole-package rule.
function packageReason(t, scopes) {
  for (const scope of scopes) {
    const used = t.deps.filter((d) => d.startsWith(scope.pkg))
    if (used.length === 0) continue
    if (untouchedBySymbols(t, scope)) continue
    const name = scope.pkg.slice(0, -1)
    if (!scope.built) return `uses ${name}, which changed`
    const hit = used.find((d) => scope.built.has(d))
    if (hit) return `uses ${hit}, built from ${scope.built.get(hit)}, which changed`
    const unknown = used.find((d) => !scope.known.has(d))
    if (unknown) return `uses ${unknown}, which no build metafile of ${name} describes, and ${name} changed`
  }
  return null
}
