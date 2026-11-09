import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The shared site header's resolver (frontend/src/ee/shell/header-module-plugin.ts)
 * in a REAL `vite build`: what a bundle carries when the header is not there.
 * Vite bundles the fixture's config — and the TypeScript plugin it imports —
 * itself, so this runs on any Node the repo supports.
 *
 *   - flag on, another edition → the stub (and the media editor's stub), and
 *     the flag compiled to false;
 *   - control: the same flag with no resolver reaches the bundle as true
 *     (so the first case is the resolver's doing);
 *   - cloud + flag on + no package → the build is refused;
 *   - a cloud build writes `shell-version.json` beside the bundle, no other
 *     build does;
 *   - a community build never carries the hosted header's loader address (its
 *     module resolves to a stub that has none).
 *
 * It needs the workspace's dependencies (vite at the repo root). The tool
 * self-tests job runs tools/__tests__ WITHOUT `npm ci`, so there it skips and
 * says so; the shared-header contract job installs them and sets
 * SHARED_HEADER_TESTS_REQUIRE_VITE=1, under which a missing vite is a failure,
 * never a skip.
 */

const repo = fileURLToPath(new URL("../../", import.meta.url))
const VITE = join(repo, "node_modules", "vite", "bin", "vite.js")
const REQUIRE_VITE = process.env.SHARED_HEADER_TESTS_REQUIRE_VITE === "1"

/** True when vite is installed; otherwise skips the test — or fails it where the dependencies must be there. */
function viteReady(t) {
  if (existsSync(VITE)) return true
  if (REQUIRE_VITE) assert.fail(`vite is not installed at the repo root (${VITE}), and SHARED_HEADER_TESTS_REQUIRE_VITE=1`)
  t.skip("vite is not installed at the repo root (no npm ci in this job)")
  return false
}
const PLUGIN = join(repo, "frontend", "src", "ee", "shell", "header-module-plugin.ts").replace(/\\/g, "/")

function fixture({ withResolver }) {
  const dir = mkdtempSync(join(tmpdir(), "site-header-build-"))
  writeFileSync(join(dir, "stub.js"), "export const headerAvailable = false\n")
  writeFileSync(join(dir, "media-editor-stub.js"), "export const mediaEditorAvailable = false\nexport const TrimPanel = null\n")
  writeFileSync(join(dir, "hosted-stub.js"), 'export const hostedHeaderAvailable = false\nexport const LOADER_URL = ""\n')
  writeFileSync(
    join(dir, "main.js"),
    [
      withResolver ? 'import { headerAvailable } from "virtual:site-header"' : "const headerAvailable = null",
      withResolver ? 'import { mediaEditorAvailable, TrimPanel } from "virtual:media-editor"' : "const mediaEditorAvailable = null, TrimPanel = null",
      withResolver ? 'import { hostedHeaderAvailable, LOADER_URL } from "virtual:hosted-header"' : "const hostedHeaderAvailable = null, LOADER_URL = null",
      'export const flagOn = import.meta.env.VITE_SHARED_HEADER === "true"',
      'export const whiteLabelOn = import.meta.env.VITE_SHARED_HEADER === "white-label"',
      "export const header = headerAvailable",
      "export const mediaEditor = mediaEditorAvailable",
      "export const trimPanel = TrimPanel",
      "export const hosted = hostedHeaderAvailable",
      "export const loader = LOADER_URL",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "vite.config.ts"),
    [
      'import path from "node:path"',
      withResolver ? `import { siteHeaderModule } from "${PLUGIN}"` : "",
      "export default {",
      "  root: __dirname,",
      "  envDir: __dirname,",
      "  logLevel: 'silent',",
      withResolver ? "  plugins: [siteHeaderModule({ root: __dirname, stubPath: path.resolve(__dirname, 'stub.js'), localeStubPath: path.resolve(__dirname, 'locale-stub.js'), a11yStubPath: path.resolve(__dirname, 'a11y-stub.js'), mediaEditorStubPath: path.resolve(__dirname, 'media-editor-stub.js'), hostedHeaderStubPath: path.resolve(__dirname, 'hosted-stub.js'), isInstalled: () => false })]," : "",
      "  build: { minify: false, outDir: path.resolve(__dirname, 'out'), lib: { entry: path.resolve(__dirname, 'main.js'), formats: ['es'], fileName: 'out' } },",
      "}",
      "",
    ].join("\n"),
  )
  return dir
}

function viteBuild(dir, env) {
  const result = spawnSync(process.execPath, [VITE, "build", "--config", join(dir, "vite.config.ts")], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, VITE_EDITION: "", VITE_SHARED_HEADER: "", ...env },
  })
  const outDir = join(dir, "out")
  let files = {}
  try {
    files = Object.fromEntries(readdirSync(outDir).map((f) => [f, readFileSync(join(outDir, f), "utf8")]))
  } catch {
    files = {}
  }
  return { status: result.status, output: `${result.stdout}${result.stderr}`, code: Object.values(files).join("\n"), files }
}

function withFixture(options, run) {
  const dir = fixture(options)
  try {
    return run(dir)
  } finally {
    // Best effort: on Windows a refused build can hold the directory for a
    // moment; a leftover temp dir must not fail the assertion that ran.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      // left in the OS temp dir
    }
  }
}

test("flag on, another edition: the bundle carries the stub and a literal false", (t) => {
  if (!viteReady(t)) return
  withFixture({ withResolver: true }, (dir) => {
    const r = viteBuild(dir, { VITE_EDITION: "community", VITE_SHARED_HEADER: "true" })
    assert.equal(r.status, 0, r.output)
    assert.match(r.code, /flagOn = false/)
    assert.match(r.code, /headerAvailable = false/)
    // The media editor's stub: a part imported by name builds, as null.
    assert.match(r.code, /mediaEditorAvailable = false/)
    assert.match(r.code, /TrimPanel = null/)
    // The hosted header's module is a stub with no loader: a community page can never ask for it.
    assert.match(r.code, /hostedHeaderAvailable = false/)
    assert.doesNotMatch(r.code, /_header\/v/)
    // Only a cloud build says which header it carries.
    assert.equal(r.files["shell-version.json"], undefined)
  })
})

test("the white-label value, another edition: the stub, and the flag compiled to false too", (t) => {
  if (!viteReady(t)) return
  withFixture({ withResolver: true }, (dir) => {
    const r = viteBuild(dir, { VITE_EDITION: "community", VITE_SHARED_HEADER: "white-label" })
    assert.equal(r.status, 0, r.output)
    assert.match(r.code, /whiteLabelOn = false/)
    assert.match(r.code, /headerAvailable = false/)
  })
})

test("cloud + the white-label value + no package: the build is refused, as for true", (t) => {
  if (!viteReady(t)) return
  withFixture({ withResolver: true }, (dir) => {
    const r = viteBuild(dir, { VITE_EDITION: "cloud", VITE_SHARED_HEADER: "white-label" })
    assert.notEqual(r.status, 0)
    assert.match(r.output, /VITE_SHARED_HEADER=white-label on a cloud build/)
  })
})

test("control: without the resolver the same flag reaches the bundle as true", (t) => {
  if (!viteReady(t)) return
  withFixture({ withResolver: false }, (dir) => {
    const r = viteBuild(dir, { VITE_EDITION: "community", VITE_SHARED_HEADER: "true" })
    assert.equal(r.status, 0, r.output)
    assert.match(r.code, /flagOn = true/)
  })
})

test("cloud + flag on + no package: the build is refused", (t) => {
  if (!viteReady(t)) return
  withFixture({ withResolver: true }, (dir) => {
    const r = viteBuild(dir, { VITE_EDITION: "cloud", VITE_SHARED_HEADER: "true" })
    assert.notEqual(r.status, 0)
    assert.match(r.output, /VITE_SHARED_HEADER=true on a cloud build/)
  })
})

test("flag unset: the bundle has no forced value and the stub", (t) => {
  if (!viteReady(t)) return
  withFixture({ withResolver: true }, (dir) => {
    const r = viteBuild(dir, { VITE_EDITION: "cloud" })
    assert.equal(r.status, 0, r.output)
    assert.match(r.code, /flagOn = false/)
    assert.match(r.code, /headerAvailable = false/)
    // A cloud build publishes which header it carries: here none, and none shown.
    assert.deepEqual(JSON.parse(r.files["shell-version.json"] ?? "null"), { version: null, header: false })
    // Where a build's worlds row leads is no longer the build's to say: the hosted header owns its links.
    assert.equal(r.files["shell-worlds.json"], undefined)
  })
})
