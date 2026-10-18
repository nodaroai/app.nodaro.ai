// tools/__tests__/test-select-triggers.test.mjs
// The three selection changes decided 2026-10-18, from the shadow week:
//   1. a range moved on one of our own workspace members is version-only;
//   2. the tools/test-select/ trigger covers the engine's code and the data
//      its code reads, not its README; a vitest/vite config inside a
//      test-data directory is a fixture, not a global trigger;
// with the negative cases that must still run everything.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isVersionOnlyChange, satisfies, workspaceMembers } from "../test-select/changes.mjs"
import { parseAnnotations } from "../test-select/annotations.mjs"
import { matchesAny } from "../test-select/glob.mjs"
import { GLOBAL_TRIGGERS, NOT_VERSION_ONLY, isGlobalTrigger, selectTests } from "../test-select/select.mjs"
import { environmentFiles } from "../test-select/pass-cache.mjs"

const root = new URL("../../", import.meta.url)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const read = (f) => readFileSync(new URL(f, root), "utf8")

const T = (file, deps = [], extra = {}) => ({ file, deps, watches: [], always: null, scanner: false, reads: [], undeclaredReader: null, ...extra })
const M = (path, extra = {}) => ({ status: "M", path, ...extra })
const files = (sel) => sel.files.map((f) => f.file)

// ── 1. workspace ranges ──────────────────────────────────────────────────

// A tree shaped like ours: the member's NAME is not its directory
// (packages/client is @nodaro/sdk), and one workspace is a literal path.
const ROOT = JSON.stringify({ name: "root", private: true, workspaces: ["packages/*", "backend", "frontend", "tools/typescript-native"] })
const TREE = ["package.json", "packages/shared/package.json", "packages/client/package.json", "packages/cli/package.json",
  "packages/shared/src/x.ts", "backend/package.json", "frontend/package.json", "tools/typescript-native/package.json",
  "backend/src/providers/apify/site-capture-actor-src/package.json"]
const membersOf = (versions) => workspaceMembers(ROOT, TREE, (p) => JSON.stringify({
  "packages/shared/package.json": { name: "@nodaro/shared", version: versions.shared },
  "packages/client/package.json": { name: "@nodaro/sdk", version: versions.sdk },
  "packages/cli/package.json": { name: "@nodaro/cli", version: versions.cli },
  "backend/package.json": { name: "nodaro-backend", version: "1.23.0" },
  "frontend/package.json": { name: "frontend", version: "1.23.0" },
  "tools/typescript-native/package.json": { name: "@nodaro/typescript-native" },
  "backend/src/providers/apify/site-capture-actor-src/package.json": { name: "site-capture-actor", version: "0.0.1" },
}[p]))
const BEFORE = membersOf({ shared: "3.33.0", sdk: "2.29.0", cli: "1.32.0" })
const AFTER = membersOf({ shared: "3.34.0", sdk: "2.30.0", cli: "1.33.0" })
const members = { before: BEFORE, after: AFTER }

// packages/cli/package.json, as release PR #2283 changed it
const cli = ({ version = "1.32.0", sdk = "^2.29.0", shared = "^3.33.0", commander = "^12.0.0", extra = {} } = {}) => JSON.stringify({
  name: "@nodaro/cli", version, scripts: { build: "tsup" },
  dependencies: { "@nodaro/sdk": sdk, "@nodaro/shared": shared, commander },
  peerDependencies: { "@nodaro/prompts": "*" }, ...extra,
}, null, 2)
const RELEASE_BEFORE = cli()
const RELEASE_AFTER = cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.34.0" })

test("workspace members come from the root `workspaces` and each member's `name` — not its directory, not a hand list", () => {
  assert.deepEqual([...AFTER.keys()].sort(), ["@nodaro/cli", "@nodaro/sdk", "@nodaro/shared", "@nodaro/typescript-native", "frontend", "nodaro-backend"])
  assert.deepEqual(AFTER.get("@nodaro/sdk"), { version: "2.30.0", manifest: "packages/client/package.json" })
  assert.equal(AFTER.get("@nodaro/typescript-native").version, "") // no version: only `*` is satisfied
  // a manifest outside the workspaces (the Apify actor) is no member
  assert.ok(!AFTER.has("site-capture-actor"))
  // anything it cannot be sure of → null (no range counts as version-only)
  assert.equal(workspaceMembers("{", TREE, () => "{}"), null)
  assert.equal(workspaceMembers(JSON.stringify({ workspaces: ["packages/*", "!packages/cli"] }), TREE, () => "{}"), null)
  assert.equal(workspaceMembers(ROOT, TREE, () => "not json"), null)
  // the real tree
  const real = workspaceMembers(read("package.json"), tracked, read)
  assert.ok(real.has("@nodaro/sdk") && real.has("@nodaro/shared") && real.has("@nodaro/prompts"))
})

test("satisfies: npm's rules for the plain forms; anything else is no", () => {
  const yes = [["3.34.0", "^3.34.0"], ["3.34.0", "^3.33.0"], ["0.2.5", "^0.2.1"], ["0.0.3", "^0.0.3"], ["1.2.9", "~1.2.3"],
    ["1.0.0", "1.0.0"], ["1.0.0", "=1.0.0"], ["2.0.0", ">=1.0.0"], ["1.0.0", "*"], ["", "*"], ["1.0.0", ""]]
  const no = [["4.0.0", "^3.34.0"], ["3.32.0", "^3.33.0"], ["0.3.0", "^0.2.1"], ["0.0.4", "^0.0.3"], ["1.3.0", "~1.2.3"],
    ["1.0.1", "1.0.0"], ["1.0.0", "^1"], ["1.0.0", "1.x"], ["1.0.0-rc.1", "^1.0.0"], ["1.0.0", "^1.0.0-rc.1"],
    ["1.0.0", "npm:@nodaro/shared@^1.0.0"], ["1.0.0", "file:../shared"], ["1.0.0", "github:nodaroai/x"], ["1.0.0", "^1.0.0 || ^2.0.0"], ["", "^1.0.0"]]
  for (const [v, r] of yes) assert.equal(satisfies(v, r), true, `${v} ${r}`)
  for (const [v, r] of no) assert.equal(satisfies(v, r), false, `${v} ${r}`)
})

test("a release that moves only our own workspace ranges (#2283) is version-only", () => {
  assert.equal(isVersionOnlyChange("packages/cli/package.json", RELEASE_BEFORE, RELEASE_AFTER, members), true)
  // a range on a member that has no version, `*` on both sides
  const ts = (v) => JSON.stringify({ name: "x", version: v, devDependencies: { "@nodaro/typescript-native": "*" } })
  assert.equal(isVersionOnlyChange("packages/cli/package.json", ts("1.0.0"), ts("1.0.1"), members), true)
})

test("NEGATIVE: a third-party range, a moved, added or removed dependency, or any other edit still is not version-only", () => {
  const no = (after, why, m = members) => assert.equal(isVersionOnlyChange("packages/cli/package.json", RELEASE_BEFORE, after, m), false, why)
  no(cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.34.0", commander: "^12.1.0" }), "a third-party range moved")
  no(cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.34.0", extra: { scripts: { build: "tsup --minify" } } }), "a real edit beside the bump")
  no(cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.35.0" }), "a range the local member (3.34.0) does not satisfy — npm installs it from the registry")
  no(cli({ version: "1.33.0", sdk: "^2.30.0", shared: "npm:@nodaro/shared@^3.34.0" }), "an npm: alias")
  no(cli({ version: "1.33.0", sdk: "^2.30.0", shared: "file:../shared" }), "a file: spec")
  no(RELEASE_AFTER, "no members known (the old rule: only `version`)", {})
  // a standalone project inside the tree (not a workspace member) is installed on its own — its ranges are judged as written
  const actor = "backend/src/providers/apify/site-capture-actor-src/package.json"
  assert.equal(isVersionOnlyChange(actor, RELEASE_BEFORE, RELEASE_AFTER, members), false, "a non-workspace manifest")
  assert.equal(isVersionOnlyChange("packages/cli/package-lock.json", lock(), lock({ cliRange: "^3.34.0", cliVersion: "1.33.0" }), members), false, "a lockfile other than the root one")
  // its plain version bump stays version-only, as before
  assert.equal(isVersionOnlyChange(actor, cli(), cli({ version: "1.33.0" }), members), true)
  // a third-party range is never normalized, even one every version satisfies
  no(cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.34.0", commander: "*" }), "a third-party range moved to *")
  assert.equal(isVersionOnlyChange("packages/cli/package.json", cli({ commander: "*" }), cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.34.0", commander: "" }), members), false, "a third-party * → empty")
  // a name that is a directory, not a member's `name`
  const byDir = (v, r) => JSON.stringify({ name: "x", version: v, dependencies: { "@nodaro/client": r } })
  assert.equal(isVersionOnlyChange("packages/cli/package.json", byDir("1.0.0", "^2.29.0"), byDir("1.0.1", "^2.30.0"), members), false)
  // added, removed, or moved to another field — the key is kept as a sentinel, never deleted
  const deps = (d, dev = {}) => JSON.stringify({ name: "x", version: "1.0.0", dependencies: d, devDependencies: dev })
  const pair = (a, b) => isVersionOnlyChange("frontend/package.json", a, b, members)
  assert.equal(pair(deps({}), deps({ "@nodaro/shared": "*" })), false, "added")
  assert.equal(pair(deps({ "@nodaro/shared": "*" }), deps({})), false, "removed")
  assert.equal(pair(deps({ "@nodaro/shared": "*" }), deps({}, { "@nodaro/shared": "*" })), false, "moved to devDependencies")
  assert.equal(pair(deps({ "@nodaro/shared": "^3.33.0" }), deps({ "@nodaro/shared": "^3.34.0" })), true, "moved range")
})

// package-lock.json, workspace entries and the installed tree
const lock = ({ cliRange = "^3.33.0", cliVersion = "1.32.0", commander = "12.0.0", extra = {} } = {}) => JSON.stringify({
  name: "root", lockfileVersion: 3, requires: true,
  packages: {
    "": { name: "root", workspaces: ["packages/*"] },
    "packages/cli": { name: "@nodaro/cli", version: cliVersion, dependencies: { "@nodaro/shared": cliRange, commander: "^12.0.0" } },
    "packages/shared": { name: "@nodaro/shared", version: cliVersion === "1.32.0" ? "3.33.0" : "3.34.0" },
    "node_modules/@nodaro/shared": { resolved: "packages/shared", link: true },
    "node_modules/commander": { version: commander, resolved: `https://registry.npmjs.org/commander/-/commander-${commander}.tgz` },
    ...extra,
  },
}, null, 2)

test("the lockfile counterpart: a moved workspace range in a workspace entry is version-only", () => {
  assert.equal(isVersionOnlyChange("package-lock.json", lock(), lock({ cliRange: "^3.34.0", cliVersion: "1.33.0" }), members), true)
})

test("NEGATIVE (lockfile): a third-party bump, or a member now installed from the registry, still is not", () => {
  const after = (o) => lock({ cliRange: "^3.34.0", cliVersion: "1.33.0", ...o })
  assert.equal(isVersionOnlyChange("package-lock.json", lock(), after({ commander: "12.1.0" }), members), false, "an installed version moved")
  // an installed entry's version alone is never ignored (only workspace entries' are)
  const onlyVersion = (v) => lock({ cliRange: "^3.34.0", cliVersion: "1.33.0", extra: { "node_modules/left-pad": { version: v } } })
  assert.equal(isVersionOnlyChange("package-lock.json", onlyVersion("1.0.0"), onlyVersion("1.0.1"), { before: AFTER, after: AFTER }), false, "an installed entry's version")
  // a range the local member no longer satisfies: npm nests a registry copy
  const nested = { "packages/cli/node_modules/@nodaro/shared": { version: "3.35.0", resolved: "https://registry.npmjs.org/@nodaro/shared/-/shared-3.35.0.tgz" } }
  assert.equal(isVersionOnlyChange("package-lock.json", lock(), after({ extra: nested }), members), false, "a nested install appeared")
  assert.equal(isVersionOnlyChange("package-lock.json", lock(), lock({ cliRange: "^3.35.0", cliVersion: "1.33.0" }), members), false, "unsatisfied range")
})

test("selection: the version-only release narrows; a third-party bump still runs everything", () => {
  const tests = [
    T("frontend/src/cli.test.ts", ["packages/cli/dist/index.js"]),
    T("frontend/src/gallery.test.tsx", ["frontend/src/gallery.tsx"]),
  ]
  // as cli.mjs marks a checked manifest
  const mark = (path, before, after) => M(path, { versionOnly: isVersionOnlyChange(path, before, after, members) })
  const release = selectTests({ project: "frontend", tests, changes: [mark("packages/cli/package.json", RELEASE_BEFORE, RELEASE_AFTER)] })
  assert.equal(release.mode, "affected")
  // the bumped manifest still selects the package's consumers (its build may inline the version)
  assert.deepEqual(files(release), ["frontend/src/cli.test.ts"])
  const thirdParty = selectTests({ project: "frontend", tests,
    changes: [mark("packages/cli/package.json", RELEASE_BEFORE, cli({ version: "1.33.0", sdk: "^2.30.0", shared: "^3.34.0", commander: "^13.0.0" }))] })
  assert.equal(thirdParty.mode, "full")
  assert.equal(thirdParty.reason, `packages/cli/package.json can affect every test — ${NOT_VERSION_ONLY}`)
  // an unchecked manifest (a local run) is not said to be more than a bump
  assert.equal(selectTests({ project: "frontend", tests, changes: [M("packages/cli/package.json")] }).reason, "packages/cli/package.json can affect every test")
})

// ── 2a. tools/test-select/ ───────────────────────────────────────────────

// Every tracked file under tools/test-select/ that is NOT a global trigger,
// and why. A new file fails the classification test until it is either
// matched by a trigger or listed here.
const NOT_GLOBAL_INPUTS = {
  "tools/test-select/README.md": "documentation; nothing reads it",
  "tools/test-select/annotations.d.mts": "types for the TypeScript tests that import annotations.mjs; Vitest strips types and Type Check covers them",
  "tools/test-select/glob.d.mts": "types for glob.mjs (as above)",
  "tools/test-select/test-node.d.mts": "types for test-node.mjs (as above)",
  "tools/test-select/registry-users-product.json": "burn-down list read only by tools/__tests__/node-units-guard.test.mjs, which the tool self-tests run on every PR",
  "tools/test-select/registry-users-tests.json": "burn-down list read only by tools/__tests__/node-units-guard.test.mjs",
  "tools/test-select/undeclared-readers.json": "burn-down list read only by tools/__tests__/reads-guard.test.mjs",
  "tools/test-select/untagged-scanners.json": "burn-down list read only by tools/__tests__/test-watches-guard.test.mjs",
}
const ENGINE = tracked.filter((f) => f.startsWith("tools/test-select/"))

test("every file of tools/test-select/ is either a global trigger or a listed non-input — never both, never neither", () => {
  const unclassified = ENGINE.filter((f) => !isGlobalTrigger(f) && !NOT_GLOBAL_INPUTS[f])
  assert.deepEqual(unclassified, [], "classify these: a trigger glob in select.mjs GLOBAL_TRIGGERS, or NOT_GLOBAL_INPUTS here with the reason")
  assert.deepEqual(Object.keys(NOT_GLOBAL_INPUTS).filter((f) => isGlobalTrigger(f)), [])
  assert.deepEqual(Object.keys(NOT_GLOBAL_INPUTS).filter((f) => !ENGINE.includes(f)), [], "listed but gone — remove it")
  // the engine's code is all in
  for (const f of ENGINE.filter((p) => /\.(?:mjs|js|ts|sh)$/.test(p))) assert.ok(isGlobalTrigger(f), f)
})

// The engine's runtime inputs, derived from its code rather than listed by
// hand: every module reachable from tools/test-select/ by relative import,
// and every tracked data file (not a JS/TS module — the product modules the
// engine parses are judged by the import graph) a path literal in that code
// can name. A template literal's `${…}` counts as any one path segment; a
// literal is tried as repo-relative, relative to the module, and — when it
// has a directory part — under any directory (project-relative paths). Each
// must be a global trigger, unless it is a product file one of the engine's
// own rules judges (ENGINE_PRODUCT_READS).
const ENGINE_PRODUCT_READS = {
  "**/src/nodes/*/unit.json": "a unit's manifest (and the units tool's fixture tree): the registry rule reads its type id, and judges a change inside a unit folder itself",
  "**/__snapshots__/*.snap": "a test's snapshot: the snapshot rule selects its own test",
  "tools/ci-runner/runner.Dockerfile": "the pass cache's environment key only (ENVIRONMENT_EXTRA), never a selection input",
}
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
function pathLiterals(code) {
  const out = []
  for (const m of stripComments(code).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, "*")
    // a `**` literal is a rule's glob (NEVER_READ_BY_TESTS, ENVIRONMENT_EXTRA), not a read
    if (/^[\w.*/@-]+\.[a-z]+$/i.test(text) && !/\.[cm]?[jt]sx?$/.test(text) && !text.includes("**")) out.push(text)
  }
  return out
}
function resolveRel(dir, rel) {
  const parts = []
  for (const seg of `${dir}/${rel}`.split("/")) {
    if (seg === "..") parts.pop()
    else if (seg !== "." && seg !== "") parts.push(seg)
  }
  return parts.join("/")
}
function engineModules() {
  const seen = new Set()
  const queue = ENGINE.filter((f) => /\.(?:mjs|js|ts)$/.test(f))
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f) || !tracked.includes(f)) continue
    seen.add(f)
    const dir = f.slice(0, f.lastIndexOf("/"))
    for (const m of read(f).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) queue.push(resolveRel(dir, m[1]))
  }
  return [...seen].sort()
}
function namedFiles(module) {
  const dir = module.slice(0, module.lastIndexOf("/"))
  const hits = new Set()
  for (const lit of pathLiterals(read(module))) {
    const bare = lit.replace(/^\.\//, "")
    const globs = [lit.startsWith(".") ? resolveRel(dir, lit) : lit, resolveRel(dir, lit), ...(bare.includes("/") && !bare.startsWith("..") ? [`**/${bare}`] : [])]
    for (const f of tracked) if (matchesAny(f, globs)) hits.add(f)
  }
  return hits
}

test("path literals: a template's interpolation counts as one path segment", () => {
  assert.deepEqual(pathLiterals('readFileSync(new URL(`./registry-users-${kind}.json`, import.meta.url)) // "x/y.json"\nconst a = "tools/units/registry-composers.json"'),
    ["./registry-users-*.json", "tools/units/registry-composers.json"])
  // a computed sibling name reaches the sibling files it can build
  assert.ok(matchesAny("tools/test-select/registry-users-tests.json", [resolveRel("tools/test-select", "./registry-users-*.json")]))
})

test("everything the engine loads or names at run time is a global trigger (derived from its code)", () => {
  const modules = engineModules()
  assert.ok(modules.includes("tools/units/structure.mjs") && modules.includes("tools/test-select/graph.mjs"))
  assert.deepEqual(modules.filter((m) => !isGlobalTrigger(m)), [], "modules the engine imports")
  const missing = []
  for (const m of modules) {
    for (const f of namedFiles(m)) {
      if (!isGlobalTrigger(f) && !matchesAny(f, Object.keys(ENGINE_PRODUCT_READS))) missing.push(`${m} → ${f}`)
    }
  }
  assert.deepEqual(missing, [], "files the engine's code names: add a trigger in select.mjs, or a product read with its reason")
  const allNamed = modules.flatMap((m) => [...namedFiles(m)])
  assert.deepEqual(Object.keys(ENGINE_PRODUCT_READS).filter((g) => !allNamed.some((f) => matchesAny(f, [g]))), [], "a product read the engine no longer names — remove it")
  // the ones found this way today
  const named = new Set(modules.flatMap((m) => [...namedFiles(m)]))
  for (const f of ["tools/units/registry-composers.json", "tools/test-select/declared-test-data.json"]) assert.ok(named.has(f) && isGlobalTrigger(f), f)
})

test("the engine's README no longer runs everything; its code still does", () => {
  const tests = [
    T("frontend/src/gallery.test.tsx", ["frontend/src/gallery.tsx"]),
    T("frontend/src/readme-reader.test.ts", [], { watches: ["tools/test-select/*.md"] }),
    T("frontend/src/undeclared.test.ts", [], { undeclaredReader: "frontend/src/lib/docs.ts" }),
  ]
  const sel = selectTests({ project: "frontend", tests, changes: [M("tools/test-select/README.md")] })
  assert.notEqual(sel.mode, "full")
  // its readers are still selected: a watcher, and a test reaching an undeclared reader (any non-code change)
  assert.deepEqual(files(sel), ["frontend/src/readme-reader.test.ts", "frontend/src/undeclared.test.ts"])
  assert.notEqual(selectTests({ project: "frontend", tests, changes: [M("tools/test-select/undeclared-readers.json")] }).mode, "full")
  // NEGATIVE: the engine's code, the suite runner and the data its code reads
  for (const p of ["tools/test-select/select.mjs", "tools/test-select/run-suite.sh", "tools/test-select/declared-test-data.json",
    "tools/test-select/lib/new-rule.ts", "tools/test-select/new.js"]) {
    const full = selectTests({ project: "frontend", tests, changes: [M(p)] })
    assert.equal(full.mode, "full", p)
  }
})

// ── 2b. fixture configs ─────────────────────────────────────────────────

const DEDUP_VITEST = "tools/__tests__/test-dedup-equivalence-vitest.test.mjs"

test("a vitest/vite config inside a test-data directory is no global trigger; every real config still is", () => {
  const configs = tracked.filter((f) => /(?:^|\/)(?:vitest(?:\.[^/]+)?\.config|vite\.config)\.[^/]+$/.test(f))
  const fixtures = configs.filter((f) => /\/(?:__tests__|__fixtures__|__goldens__|fixtures)\//.test(f))
  assert.ok(fixtures.length >= 3, "the test-dedup fixtures exist")
  for (const f of fixtures) assert.equal(isGlobalTrigger(f), false, f)
  // only under tools/__tests__/fixtures/: a config in any other test directory stays a trigger
  for (const f of ["packages/shared/src/__tests__/vitest.config.ts", "frontend/src/__tests__/fixtures/vite.config.ts", "backend/src/x/__fixtures__/vitest.config.mjs"]) assert.ok(isGlobalTrigger(f), f)
  for (const f of configs.filter((c) => !fixtures.includes(c))) assert.equal(isGlobalTrigger(f), true, f)
  for (const f of ["frontend/vitest.config.ts", "backend/vitest.config.ts", "backend/vitest.characterize.config.ts", "frontend/vite.config.ts", "packages/shared/vitest.config.ts"]) {
    assert.ok(isGlobalTrigger(f), f)
  }
  // the exemption is for configs only: a fixture's tsconfig or manifest changes how the files beside it load
  for (const f of ["tools/__tests__/fixtures/x/tsconfig.json", "tools/__tests__/fixtures/x/package.json"]) assert.ok(isGlobalTrigger(f), f)
  // and the pass cache's environment key follows the same predicate
  assert.deepEqual(environmentFiles(fixtures).filter((f) => !/\.json$/.test(f)), [])
})

test("a fixture config still selects its own tests: the ones that import or watch it", () => {
  const fixture = "tools/__tests__/fixtures/test-dedup/vitest/guard/vitest.config.mjs"
  const dedup = parseAnnotations(read(DEDUP_VITEST))
  const tests = [
    T("frontend/src/gallery.test.tsx", ["frontend/src/gallery.tsx"]),
    T("frontend/src/loads-fixture.test.ts", [fixture]),
    T(DEDUP_VITEST, [], { watches: dedup.watches }),
  ]
  const sel = selectTests({ project: "frontend", tests, changes: [M(fixture)] })
  assert.equal(sel.mode, "affected")
  assert.deepEqual(files(sel), ["frontend/src/loads-fixture.test.ts", DEDUP_VITEST])
  // …and in CI the test-dedup job still runs for it: the Diff Gate's testdedup case covers the fixtures
  const gate = read(".github/workflows/ci.yml").split("\n").find((l) => l.includes("testdedup=true ;;"))
  assert.ok(gate?.includes("tools/__tests__/fixtures/test-dedup/*"), "the Diff Gate's testdedup case lists the fixtures")
  // NEGATIVE: a real config still runs everything
  assert.equal(selectTests({ project: "frontend", tests, changes: [M("frontend/vitest.config.ts")] }).mode, "full")
})

test("every global trigger glob still matches a tracked file it applies to", () => {
  for (const g of GLOBAL_TRIGGERS) assert.ok(tracked.some((f) => matchesAny(f, [g]) && isGlobalTrigger(f)), g)
})
