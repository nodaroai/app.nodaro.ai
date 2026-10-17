// tools/__tests__/units-emit.test.mjs
// gen:units emitters and the generate/check/write cycle (tools/units/gen.mjs,
// templates.mjs) on the fixture unit, with every seam live. The byte-exact
// goldens (and the real TypeScript price reader) are in
// frontend/src/__tests__/units-generator.test.ts; this file needs no npm install.
// @test-watches tools/units/**
import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GEN_UNITS_OUTPUTS, generate, main, staleFiles, writeOutputs } from "../units/gen.mjs"
import { ALL_SEAM_IDS, AGGREGATES, DATA_FILES, SPLICES, liveSeams } from "../units/seams.mjs"
import { loadUnits } from "../units/manifest.mjs"
import { aggregateSource, importSpecifier } from "../units/templates.mjs"
import { memberLineTypes } from "../test-select/registry.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, "../units/__fixtures__/tree")
const REPO = path.join(here, "../..")

function tree() {
  const dir = mkdtempSync(path.join(tmpdir(), "units-emit-"))
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}
const ctxFor = (root, live = liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id) => [id, true])))) => ({
  legacyTypes: new Set(["text-prompt", "upload-video"]),
  families: new Set(["fixture-family"]),
  live,
  capabilities: {},
  exists: (p) => existsSync(path.join(root, p)),
})
const stubPrice = () => ({ "fixture-echo": 3 })
const run = (root, ctx = ctxFor(root)) => generate({ root, ctx, readPrice: stubPrice })

test("every live seam produces its output; each unit line is tagged // unit:<type>", async () => {
  const root = tree()
  try {
    const r = await run(root)
    assert.deepEqual(r.errors, [])
    const paths = [...r.outputs.keys()].sort()
    for (const a of AGGREGATES) assert.ok(paths.includes(a.out), `${a.out} is emitted`)
    for (const p of [
      "frontend/src/nodes/fixture-echo/definition.generated.ts",
      "frontend/src/nodes/fixture-echo/labels.generated.ts",
      "backend/src/nodes/fixture-echo/descriptor.generated.ts",
      "packages/shared/src/generated/unit-contracts.ts",
      "frontend/src/lib/i18n/he.ts",
      "docs/nodes/README.md",
    ]) assert.ok(paths.includes(p), `${p} is emitted`)
    const executors = r.outputs.get("frontend/src/nodes/_generated/executors.ts")
    assert.match(executors, /^\/\/ @registry frontend\/src\/nodes\/\*\/exec\.ts$/m)
    assert.match(executors, /^\/\/ @registry-exports executors: UNIT_EXECUTORS$/m)
    assert.match(executors, /^import \{ executor as unit_fixture_echo \} from "\.\.\/fixture-echo\/exec" \/\/ unit:fixture-echo$/m)
    const prices = r.outputs.get("backend/src/ee/nodes/_generated/prices.ts")
    assert.match(prices, /from "\.\.\/\.\.\/\.\.\/nodes\/fixture-echo\/price\.ee\.js" \/\/ unit:fixture-echo$/m, "backend imports end in .js")
    assert.match(r.outputs.get("frontend/src/nodes/fixture-echo/definition.generated.ts"), /"priceFallback": 3/)
    assert.doesNotMatch(r.outputs.get("backend/src/nodes/fixture-echo/descriptor.generated.ts"), /price|credit/i, "no price in the descriptor")
    assert.match(r.outputs.get("frontend/src/lib/i18n/he.ts"), /\/\/ gen:units start\n {2}"fixtureEcho\.help": "[^"]+",\n {2}"node\.fixtureEcho": "הד בדיקה",\n {2}\/\/ gen:units end/)
    assert.match(r.outputs.get("docs/nodes/README.md"), /\| \[Fixture Echo\]\(\.\/utility\/fixture-echo\.md\) \| Echo the input video back unchanged/)
    assert.match(r.outputs.get("packages/shared/src/generated/unit-contracts.ts"), /^ {2}\["fixture-echo", "video"\], \/\/ unit:fixture-echo$/m)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the contract rows hold only a type id and a producer kind", async () => {
  const root = tree()
  try {
    const src = (await run(root)).outputs.get("packages/shared/src/generated/unit-contracts.ts")
    const rows = src.split("\n").filter((l) => l.includes("// unit:"))
    for (const l of rows) assert.match(l, /^ {2}\["[a-z0-9-]+", "(?:audio|video|image|dynamic)"\], \/\/ unit:[a-z0-9-]+$/)
    const code = src.split("\n").filter((l) => !l.startsWith("//")).join("\n").replace(/\["[a-z0-9-]+", /g, "")
    assert.doesNotMatch(code, /\d/, "no number (price, credit) outside the type ids")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("deterministic: the same tree generates the same bytes", async () => {
  const root = tree()
  try {
    const a = await run(root)
    const b = await run(root)
    assert.deepEqual([...a.outputs], [...b.outputs])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("check → write → check: stale, then clean; orphans are listed and removed", async () => {
  const root = tree()
  try {
    let r = await run(root)
    assert.ok(staleFiles(root, r).length > 0)
    writeOutputs(root, r)
    r = await run(root)
    assert.deepEqual(staleFiles(root, r), [])
    // An aggregate whose seam is switched off is an orphan: --check lists it, a write removes it.
    const off = ctxFor(root, liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id) => [id, id !== "configs"]))))
    rmSync(path.join(root, "frontend/src/nodes/fixture-echo/config.tsx"))
    r = await run(root, off)
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.orphans, ["frontend/src/nodes/_generated/configs.ts"])
    assert.deepEqual(staleFiles(root, r), ["frontend/src/nodes/_generated/configs.ts"])
    writeOutputs(root, r)
    assert.equal(existsSync(path.join(root, "frontend/src/nodes/_generated/configs.ts")), false)
    assert.deepEqual(staleFiles(root, await run(root, off)), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the real tree: gen:units --check is clean, and writes exactly the live seams' outputs", async () => {
  const out = []
  const err = []
  const rc = await main(["--check"], REPO, { write: (s) => out.push(s) }, { write: (s) => err.push(s) })
  assert.equal(rc, 0, err.join(""))
  const live = liveSeams()
  const units = loadUnits(REPO).length
  const expected = AGGREGATES.filter((a) => live.has(a.id)).length + SPLICES.filter((x) => live.has(x.id)).reduce((n, x) => n + x.files.length, 0) + DATA_FILES.filter((d) => live.has(d.id)).length
  // With no unit, every output is a live seam's (an empty aggregate, a spliced region, the contracts file).
  if (units === 0) assert.match(out.join(""), new RegExp(`no drift \\(${expected} generated file\\(s\\)\\)`))
})

test("an unknown argument is a usage error", async () => {
  const err = []
  assert.equal(await main(["--wat"], REPO, { write() {} }, { write: (s) => err.push(s) }), 2)
})

test("every keyed aggregate is a null-prototype object: a lookup by \"constructor\" / \"__proto__\" / \"toString\" finds nothing", () => {
  for (const agg of AGGREGATES.filter((a) => a.id !== "definitions")) {
    const src = aggregateSource(agg, [])
    assert.match(src, /= Object\.assign\(Object\.create\(null\), \{\n\}\)\n$/, agg.id)
    // The object the module evaluates to, with its import lines and types stripped.
    const body = src.slice(src.indexOf("Object.assign(")).replace(/\n/g, " ")
    const value = new Function(`return ${body}`)()
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) assert.equal(value[key], undefined, `${agg.id}[${key}]`)
  }
})

test("adding a member to an aggregate changes only `// unit:` lines (what the engine narrows)", async () => {
  const agg = AGGREGATES.find((a) => a.id === "executors")
  const unit = (type) => ({ type, dirs: { frontend: `frontend/src/nodes/${type}`, backend: `backend/src/nodes/${type}` }, typesSource: null })
  const before = aggregateSource(agg, [unit("a-node")])
  const after = aggregateSource(agg, [unit("a-node"), unit("b-node")])
  assert.deepEqual(memberLineTypes(before, after), ["b-node"])
  assert.deepEqual(memberLineTypes(aggregateSource(agg, []), aggregateSource(agg, [unit("a-node")])), ["a-node"], "the first member too")
  const defs = AGGREGATES.find((a) => a.id === "definitions")
  assert.deepEqual(memberLineTypes(aggregateSource(defs, []), aggregateSource(defs, [{ ...unit("c-node"), typesSource: "export interface CNodeData {}" }])), ["c-node"])
})

test("import specifiers: frontend without extension, backend with .js", () => {
  assert.equal(importSpecifier("frontend/src/nodes/_generated/x.ts", "frontend/src/nodes/a/node.tsx"), "../a/node")
  assert.equal(importSpecifier("backend/src/nodes/_generated/x.ts", "backend/src/nodes/a/route.ts"), "../a/route.js")
  assert.equal(importSpecifier("backend/src/ee/nodes/_generated/x.ts", "backend/src/nodes/a/price.ee.ts"), "../../../nodes/a/price.ee.js")
})

test("GEN_UNITS_OUTPUTS names every path it can write", async () => {
  const { matchesAny } = await import("../test-select/glob.mjs")
  const root = tree()
  try {
    for (const p of (await run(root)).outputs.keys()) assert.ok(matchesAny(p, GEN_UNITS_OUTPUTS), p)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a live splice seam whose region is missing fails loudly", async () => {
  const root = tree()
  try {
    writeFileSync(path.join(root, "frontend/src/lib/i18n/ko.ts"), "export const ko = {\n}\n")
    await assert.rejects(run(root), /frontend\/src\/lib\/i18n\/ko\.ts: needs exactly one "\/\/ gen:units start" line/)
    assert.ok(readFileSync(path.join(root, "frontend/src/lib/i18n/en.ts"), "utf8").includes("gen:units start"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
