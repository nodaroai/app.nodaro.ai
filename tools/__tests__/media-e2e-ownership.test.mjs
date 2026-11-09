// tools/__tests__/media-e2e-ownership.test.mjs
// The real-media e2e files that run in the Media E2E job instead of Backend
// Tests (decided 2026-11-08) are listed ONCE, in backend/src/test/media-e2e-files.json:
// backend/vitest.config.ts (Backend Tests) excludes exactly that list and
// backend/vitest.media-e2e.config.ts (Media E2E) includes exactly it. These
// tests hold the split: every backend test file is collected by exactly one of
// the two suites — never both, never neither — and so every *.e2e.test.ts has
// one owner. The last test asks Vitest itself when this checkout has the
// install; the Media E2E job runs this file with MEDIA_E2E_REQUIRE_VITEST=1,
// so there a missing install fails instead of skipping.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { matchesAny } from "../test-select/glob.mjs"
import { workflowJobs } from "../ci/job-inputs.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (p) => readFileSync(path.join(root, p), "utf8")
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const trackedSet = new Set(tracked)
const LIST = "backend/src/test/media-e2e-files.json"
const listed = JSON.parse(read(LIST)).files
// Every tracked backend test file, relative to backend/ (the configs' root).
const backendTests = tracked.filter((f) => f.startsWith("backend/src/") && f.endsWith(".test.ts")).map((f) => f.slice("backend/".length))
const MAIN_CONFIG = "backend/vitest.config.ts"
const MEDIA_CONFIG = "backend/vitest.media-e2e.config.ts"
const IMPORT = 'import mediaE2e from "./src/test/media-e2e-files.json"'

// What each suite collects, read from its config the way Vitest reads it: the
// main suite every src/**/*.test.ts but the list, the media suite the list.
const mainSuite = new Set(backendTests.filter((f) => matchesAny(f, ["src/**/*.test.ts"]) && !listed.includes(f)))
const mediaSuite = new Set(listed)

test("the list names real e2e test files, once each, sorted, as plain paths", () => {
  assert.ok(Array.isArray(listed) && listed.length > 0, LIST)
  assert.deepEqual(listed, [...new Set(listed)].sort(), `${LIST}: sorted, no duplicates`)
  for (const f of listed) {
    assert.ok(trackedSet.has(`backend/${f}`), `${f} is not tracked — renamed or removed? Update ${LIST}`)
    assert.match(f, /^src\/.+\.e2e\.test\.ts$/, `${f}: only a real-media *.e2e.test.ts may leave Backend Tests`)
    // Both configs read an entry as a glob: a plain path names exactly one file.
    assert.doesNotMatch(f, /[*?{}[\]!]/, `${f}: a plain path, no glob characters`)
  }
})

test("both configs read the one list: Backend Tests excludes it, Media E2E runs exactly it", () => {
  const main = read(MAIN_CONFIG)
  assert.ok(main.includes(IMPORT), `${MAIN_CONFIG} reads ${LIST}`)
  assert.match(main, /^ {4}include: \["src\/\*\*\/\*\.test\.ts"\],$/m)
  assert.match(main, /^ {4}exclude: \[\.\.\.configDefaults\.exclude, \.\.\.mediaE2e\.files\],$/m)
  const media = read(MEDIA_CONFIG)
  assert.ok(media.includes(IMPORT), `${MEDIA_CONFIG} reads ${LIST}`)
  assert.match(media, /^ {4}include: mediaE2e\.files,$/m)
  assert.doesNotMatch(media, /^ {4}exclude:/m, "the media suite runs every listed file")
  // No third suite collects backend tests: the only other config is the
  // characterization suite, whose files are *.char.ts.
  const configs = tracked.filter((f) => /^backend\/vitest(\.[\w-]+)?\.config\.ts$/.test(f)).sort()
  assert.deepEqual(configs, ["backend/vitest.characterize.config.ts", MAIN_CONFIG, MEDIA_CONFIG])
  assert.match(read("backend/vitest.characterize.config.ts"), /include: \["src\/providers\/video\/__characterization__\/\*\*\/\*\.char\.ts"\]/)
})

test("every backend test file is in exactly one suite, so every *.e2e.test.ts has one owner", () => {
  for (const f of backendTests) {
    const owners = [mainSuite.has(f) && "Backend Tests", mediaSuite.has(f) && "Media E2E"].filter(Boolean)
    assert.equal(owners.length, 1, `${f} is in ${owners.length ? owners.join(" and ") : "neither suite"}`)
  }
  assert.ok(backendTests.some((f) => f.endsWith(".e2e.test.ts") && mainSuite.has(f)), "the fast e2e files stay in Backend Tests")
})

test("each suite runs where it should: Backend Tests on the default config, Media E2E on its own, nightly too", () => {
  const jobs = workflowJobs(read(".github/workflows/ci.yml"))
  const scripts = JSON.parse(read("backend/package.json")).scripts
  assert.equal(scripts["test:media-e2e"], "vitest run --config vitest.media-e2e.config.ts")
  assert.match(jobs["media-e2e"], /- name: Run the media e2e suite\n(?: {8}.*\n)*? {8}working-directory: backend\n {8}run: npm run test:media-e2e\n/)
  // The Backend Tests shards run the suite through run-suite.sh: the default config, whatever the mode.
  assert.match(jobs["backend-test-shards"], /run: bash \.\.\/tools\/test-select\/run-suite\.sh/)
  assert.doesNotMatch(read("tools/test-select/run-suite.sh"), /--config/)
  // Nightly, on dev, in this repository only, and never red: a scheduled run
  // reports on main's HEAD, and a red check there skips the production deploy.
  const nightly = read(".github/workflows/nightly-media-e2e.yml")
  assert.match(nightly, /^ {2}schedule:\n {4}- cron: "[^"]+"$/m)
  assert.match(nightly, /^ {4}if: github\.repository == 'nodaroai\/app\.nodaro\.ai-internal'$/m)
  assert.match(nightly, /^ {4}continue-on-error: true$/m)
  assert.match(nightly, /^ {10}ref: dev$/m)
  assert.match(nightly, /^ {8}working-directory: backend\n {8}run: npm run test:media-e2e$/m)
  assert.match(nightly, /sudo bash tools\/install-pinned-ffmpeg\.sh --from-dockerfile Dockerfile --arch amd64/)
  assert.ok(jobs["media-e2e"].includes("node --test tools/__tests__/media-e2e-ownership.test.mjs"), "the Media E2E job runs this file with the install")
  // One file at a time: the config's fileParallelism loses to a VITEST_MAX_WORKERS
  // in the environment (the CI pool's image sets 2), so each suite step pins it.
  assert.match(read(MEDIA_CONFIG), /^ {4}fileParallelism: false,$/m)
  const suiteStep = (text) => text.match(/- name: Run the media e2e suite\n((?: {8}.*\n)+)/)?.[1] ?? ""
  for (const [where, text] of [["ci.yml", jobs["media-e2e"]], ["nightly-media-e2e.yml", nightly]]) {
    assert.match(suiteStep(text), /^ {8}env:\n(?: {10}.*\n)*? {10}VITEST_MAX_WORKERS: "1"\n/m, `${where}: the suite step sets VITEST_MAX_WORKERS to 1`)
  }
})

// ── Vitest's own collection (when this checkout has the install) ─────────

const requireVitest = process.env.MEDIA_E2E_REQUIRE_VITEST === "1"
const canAsk = existsSync(path.join(root, "node_modules/vitest/package.json"))
test("Vitest itself collects each file in exactly one suite", { skip: canAsk || requireVitest ? false : "needs npm ci — the Media E2E job runs this with the install" }, async () => {
  assert.ok(canAsk, "MEDIA_E2E_REQUIRE_VITEST=1 but vitest is not installed")
  const { createVitest } = await import("vitest/node")
  const backend = path.join(root, "backend")
  const collected = async (config) => {
    const cwd = process.cwd()
    let vitest
    process.chdir(backend)
    try {
      vitest = await createVitest("test", { watch: false, run: true, root: backend, config: path.join(backend, config) }, {}, {})
      const specs = await vitest.globTestSpecifications([])
      return new Set(specs.map((s) => path.relative(backend, s.moduleId).split(path.sep).join("/")).filter((f) => trackedSet.has(`backend/${f}`)))
    } finally {
      try {
        await vitest?.close()
      } finally {
        process.chdir(cwd)
      }
    }
  }
  const main = await collected("vitest.config.ts")
  const media = await collected("vitest.media-e2e.config.ts")
  assert.deepEqual([...media].sort(), [...listed].sort(), "the media suite collects exactly the list")
  assert.deepEqual([...main].filter((f) => media.has(f)), [], "no file in both suites")
  assert.deepEqual(backendTests.filter((f) => !main.has(f) && !media.has(f)), [], "no file in neither suite")
  assert.deepEqual([...main].sort(), [...mainSuite].sort(), "the static reading above is Vitest's")
})
