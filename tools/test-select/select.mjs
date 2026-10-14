// tools/test-select/select.mjs
// Which test files a change can affect. Pure: the graph and the change list
// come in, a decision comes out. Every rule that cannot be sure says "full".
import { matchesAny } from "./glob.mjs"
import { TEST_FILE, TEST_SIDE_HELPER } from "./test-node.mjs"

// Changing any of these can change the outcome of ANY test — through
// dependencies, configuration, the shared setup, or this engine itself.
export const GLOBAL_TRIGGERS = [
  "package.json", "**/package.json", "package-lock.json",
  "**/vitest.config.*", "**/vitest.*.config.*", "**/vite.config.*", "**/tsconfig*.json",
  "frontend/src/test/**", "backend/src/test/**",
  ".github/workflows/ci.yml", ".github/actions/**", "tools/test-select/**",
  // pin the ffmpeg binary the backend's real-ffmpeg e2e tests run against
  "Dockerfile", "tools/install-pinned-ffmpeg.sh",
]
// The GitHub files API stops at 3000 entries; past this we cannot see the diff.
export const MAX_VISIBLE_CHANGES = 2900

// Any file under a package can change its build (tsup config, build scripts,
// src) — except its tests and its prose docs. Markdown under src/ may be
// bundled, so it still counts.
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

export function selectTests({ project, changes, tests }) {
  const full = (reason) => ({ mode: "full", reason, files: [] })
  const inProject = (p) => p.startsWith(`${project}/`)

  if (changes.length >= MAX_VISIBLE_CHANGES) return full(`the diff lists ${changes.length} files — too many to see them all`)
  const trigger = changes.find((c) => matchesAny(c.path, GLOBAL_TRIGGERS))
  if (trigger) return full(`${trigger.path} can affect every test`)
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
    && (TEST_DATA_DIR.test(c.path) || TEST_SIDE_HELPER.test(c.path)))
  if (testData) return full(`${testData.path} is test data read at run time — running everything`)

  const changed = new Set(changes.map((c) => c.path))
  const changedPackages = [...new Set(changes
    .filter((c) => PACKAGE_FILE.test(c.path) && !IN_TEST_DIR.test(c.path) && !PACKAGE_DOC.test(c.path))
    .map((c) => `packages/${c.path.match(PACKAGE_FILE)[1]}/`))]
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

  const ctx = { changes, changed, changedPackages, snapshotOwners, nonModule }
  const files = tests
    .map((t) => ({ file: t.file, why: reasonFor(t, ctx) }))
    .filter((f) => f.why)
    .sort((a, b) => a.file.localeCompare(b.file))
  return files.length
    ? { mode: "affected", reason: `${files.length} of ${tests.length} test files can be affected`, files }
    : { mode: "none", reason: `no ${project} test imports or watches a changed file`, files: [] }
}

// Order matters: `always` and an untagged reader come before `watches`,
// because a test may inherit watches from one helper while another helper is
// an untagged reader; and a watcher never prevents any other test from being
// selected.
function reasonFor(t, ctx) {
  if (ctx.changed.has(t.file)) return "the test file itself changed"
  const snapshot = ctx.snapshotOwners.get(t.file)
  if (snapshot) return `its snapshot ${snapshot} changed`
  const dep = t.deps.find((d) => ctx.changed.has(d))
  if (dep) return `imports ${dep}`
  const pkg = t.deps.find((d) => ctx.changedPackages.some((p) => d.startsWith(p)))
  if (pkg) return `uses ${pkg.split("/").slice(0, 2).join("/")}, which changed`
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
