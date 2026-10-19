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
import { createRequire } from "node:module"
import { GEN_UNITS_OUTPUTS, generate, main, staleFiles, writeOutputs } from "../units/gen.mjs"
import { GEN_UNITS_PRUNES, NODE_HANDLES_TABLE, pruneUnitRows } from "../units/handle-prune.mjs"
import { ALL_SEAM_IDS, AGGREGATES, DATA_FILES, SPLICES, liveSeams } from "../units/seams.mjs"
import { loadUnits } from "../units/manifest.mjs"
import { aggregateSource, contractsSource, importSpecifier, inPositionOrder, useCaseRowsSource } from "../units/templates.mjs"
import { memberLineTypes } from "../test-select/registry.mjs"
import { USE_CASE_INPUT_HANDLES } from "../units/vocabulary.mjs"

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
const PRICES = { "fixture-case": { "use-case-fee:fixture-case": 1 }, "fixture-echo": { "fixture-echo": 3 } }
const stubPrice = (rel) => PRICES[rel.split("/").at(-2)]
const run = (root, ctx = ctxFor(root), readPrice = stubPrice) => generate({ root, ctx, readPrice })

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
    assert.match(r.outputs.get("frontend/src/nodes/fixture-echo/definition.generated.ts"), /"priceRows": \{\n {4}"fixture-echo": 3\n {2}\}/)
    assert.match(r.outputs.get("frontend/src/nodes/fixture-case/definition.generated.ts"), /"priceRows": \{\n {4}"use-case-fee:fixture-case": 1\n {2}\}/)
    assert.doesNotMatch(r.outputs.get("backend/src/nodes/fixture-echo/descriptor.generated.ts"), /price|credit/i, "no price in the descriptor")
    assert.match(r.outputs.get("frontend/src/lib/i18n/he.ts"), /\/\/ gen:units start\n {2}"fixtureEcho\.help": "[^"]+",\n {2}"node\.fixtureEcho": "הד בדיקה",\n {2}\/\/ gen:units end/)
    assert.match(r.outputs.get("docs/nodes/README.md"), /\| \[Fixture Echo\]\(\.\/utility\/fixture-echo\.md\) \| Echo the input video back unchanged/)
    assert.match(r.outputs.get("packages/shared/src/generated/unit-contracts.ts"), /^ {2}\["fixture-echo", "video"\], \/\/ unit:fixture-echo$/m)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a many-wire media input and a JSON input reach both projections as declared", async () => {
  const root = tree()
  try {
    const r = await run(root)
    assert.deepEqual(r.errors, [])
    for (const p of ["frontend/src/nodes/fixture-echo/definition.generated.ts", "backend/src/nodes/fixture-echo/descriptor.generated.ts"]) {
      const src = r.outputs.get(p)
      assert.match(src, /"id": "sources",\n {8}"label": "Sources",\n {8}"accepts": \[\n {10}"video",\n {10}"audio"\n {8}\],\n {8}"many": true\n/, p)
      assert.match(src, /"id": "plan",\n {8}"label": "Plan",\n {8}"accepts": \[\n {10}"look"\n {8}\]\n/, p)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the contract rows hold only a type id and a producer kind", async () => {
  const root = tree()
  try {
    const all = (await run(root)).outputs.get("packages/shared/src/generated/unit-contracts.ts")
    // The UNIT_CONTRACTS block (the declarations after it hold other closed vocabularies).
    const src = all.slice(0, all.indexOf("\n]\n") + 3)
    const rows = src.split("\n").filter((l) => l.includes("// unit:"))
    assert.equal(rows.length, 1)
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
    for (const t of ["fixture-echo", "fixture-case"]) rmSync(path.join(root, `frontend/src/nodes/${t}/config.tsx`))
    r = await run(root, off)
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.orphans, ["frontend/src/nodes/_generated/configs.ts"])
    assert.deepEqual(staleFiles(root, r), ["frontend/src/nodes/_generated/configs.ts"])
    writeOutputs(root, r)
    assert.equal(existsSync(path.join(root, "frontend/src/nodes/_generated/configs.ts")), false)
    assert.deepEqual(staleFiles(root, await run(root, off)), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// A real unit with a price.ee.ts is read through the TypeScript price reader, and
// this job runs with no npm install. The same check runs with dependencies as
// `npm run gen:units -- --check` in the Type Check job, so here it skips cleanly.
let ts = null
try { ts = createRequire(new URL("../../package.json", import.meta.url))("typescript") } catch { /* no npm install here */ }
const realTreeNeedsTs = loadUnits(REPO).length > 0

test("the real tree: gen:units --check is clean, and writes exactly the live seams' outputs", { skip: realTreeNeedsTs && !ts && "typescript is not installed (the Type Check job runs gen:units --check)" }, async () => {
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

test("docs.index \"hand-written\" keeps the unit out of the generated README region; registry.after reaches the descriptor", async () => {
  const root = tree()
  try {
    const file = path.join(root, "frontend/src/nodes/fixture-echo/unit.json")
    const m = JSON.parse(readFileSync(file, "utf8"))
    m.docs.index = "hand-written"
    m.registry.after = "text-prompt"
    writeFileSync(file, JSON.stringify(m))
    const result = await run(root)
    assert.deepEqual(result.errors, [])
    const readme = result.outputs.get("docs/nodes/README.md")
    assert.ok(!readme.includes("Fixture Echo"), "no generated row (and no header) for a hand-written one")
    assert.match(readme, /<!-- gen:units start -->\n<!-- gen:units end -->/)
    assert.match(result.outputs.get("backend/src/nodes/fixture-echo/descriptor.generated.ts"), /"registryPosition": \{\n\s+"after": "text-prompt"\n\s+\}/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("mcp.widgetModelFor reaches the descriptor only when declared", async () => {
  const root = tree()
  const DESC = "backend/src/nodes/fixture-echo/descriptor.generated.ts"
  try {
    assert.doesNotMatch((await run(root)).outputs.get(DESC), /"mcp"/, "no mcp key on a unit that declares none")
    const file = path.join(root, "frontend/src/nodes/fixture-echo/unit.json")
    const m = JSON.parse(readFileSync(file, "utf8"))
    m.mcp = { widgetModelFor: ["fixture_echo"] }
    writeFileSync(file, JSON.stringify(m))
    const result = await run(root)
    assert.deepEqual(result.errors, [])
    assert.match(result.outputs.get(DESC), /"mcp": \{\n\s+"widgetModelFor": \[\n\s+"fixture_echo"\n\s+\]\n\s+\}/)
    assert.doesNotMatch(result.outputs.get("frontend/src/nodes/fixture-echo/definition.generated.ts"), /widgetModelFor/, "server-only: the editor's definition does not carry it")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a worker's budget.ts: the budgets aggregate binds it, and the editor's definition says the node runs long", async () => {
  const root = tree()
  try {
    const r = await run(root)
    assert.deepEqual(r.errors, [])
    const budgets = r.outputs.get("backend/src/nodes/_generated/budgets.ts")
    assert.match(budgets, /^\/\/ @registry backend\/src\/nodes\/\*\/budget\.ts$/m)
    assert.match(budgets, /^import type \{ UnitBudget \} from "\.\.\/kit\.js"$/m)
    assert.match(budgets, /^import \{ budget as unit_fixture_echo \} from "\.\.\/fixture-echo\/budget\.js" \/\/ unit:fixture-echo$/m)
    assert.match(budgets, /^export const UNIT_BUDGETS: Readonly<Record<string, UnitBudget>> = /m)
    assert.match(budgets, /^ {2}"fixture-echo": unit_fixture_echo, \/\/ unit:fixture-echo$/m)
    assert.match(r.outputs.get("frontend/src/nodes/fixture-echo/definition.generated.ts"), /\n {2}"longRunning": true\n/)
    assert.doesNotMatch(r.outputs.get("frontend/src/nodes/fixture-case/definition.generated.ts"), /longRunning/, "no flag without a budget.ts")
    assert.doesNotMatch(r.outputs.get("backend/src/nodes/fixture-echo/descriptor.generated.ts"), /longRunning/, "the server reads the budget itself")
    // Without budget.ts the flag goes and the aggregate has no member.
    rmSync(path.join(root, "backend/src/nodes/fixture-echo/budget.ts"))
    const bare = await run(root)
    assert.doesNotMatch(bare.outputs.get("frontend/src/nodes/fixture-echo/definition.generated.ts"), /longRunning/)
    assert.doesNotMatch(bare.outputs.get("backend/src/nodes/_generated/budgets.ts"), /unit:fixture-echo/)
  } finally { rmSync(root, { recursive: true, force: true }) }
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

test("use-case: the shared contract and the render-rules rows, in position order", async () => {
  const root = tree()
  try {
    const r = await run(root)
    assert.deepEqual(r.errors, [])
    const contracts = r.outputs.get("packages/shared/src/generated/unit-contracts.ts")
    assert.match(contracts, /^export const UNIT_USE_CASE_TYPES = \[\n {2}"fixture-case", \/\/ unit:fixture-case\n\] as const$/m)
    assert.match(contracts, /^ {2}\["fixture-case", \{ "json": "other" \}\], \/\/ unit:fixture-case$/m)
    assert.match(contracts, /^ {2}\["fixture-case", "text"\], \/\/ unit:fixture-case$/m)
    // contract.fanOutEach: each pips first, then the primary — the shape of a FAN_OUT_EACH_HANDLES row.
    assert.match(contracts, /^export const UNIT_FAN_OUT_EACH: ReadonlyArray<readonly \[type: string, handles: \{ readonly each: ReadonlyArray<string>; readonly primary: string \}\]> = \[\n {2}\["fixture-case", \{ "each": \["text"\], "primary": "text" \}\], \/\/ unit:fixture-case\n\]$/m)
    assert.doesNotMatch(contracts, /\/\*\*/, "line comments only: unit-contracts.test.ts holds every other line to a declaration or a row")
    assert.match(r.outputs.get("packages/render-rules/src/unit-use-cases.generated.ts"), /^ {2}\{ type: "fixture-case", builder: "fixture", label: "Fixture Case", inputs: \["media"\] \}, \/\/ unit:fixture-case$/m)
    assert.match(r.outputs.get("backend/src/nodes/_generated/use-cases.ts"), /^import \{ useCase as unit_fixture_case \} from "\.\.\/fixture-case\/use-case\.js" \/\/ unit:fixture-case$/m)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("use-case: its price.ee.ts holds exactly its use-case-fee row", async () => {
  const root = tree()
  try {
    const extra = (rel) => (rel.includes("fixture-case") ? { "use-case-fee:fixture-case": 1, "fixture-case": 2 } : stubPrice(rel))
    assert.deepEqual((await run(root, ctxFor(root), extra)).errors, ['fixture-case: a use-case unit\'s price.ee.ts holds exactly its "use-case-fee:fixture-case" row'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("inPositionOrder: units by position.after over the (alphabetical) legacy list — a unit may follow a unit, so a use-case chain reads as the editor shows it", () => {
  const u = (type, after, kind = "use-case") => ({ type, manifest: { type, label: type, position: { after }, execution: { kind, builder: type }, handles: { inputs: [{ id: "media" }], outputs: [] } } })
  const units = [u("a-chapters", "z-tighten"), u("b-other", "legacy-a", "worker"), u("z-tighten", "legacy-b")]
  assert.deepEqual(inPositionOrder(units, new Set(["legacy-a", "legacy-b"])).map((x) => x.type), ["b-other", "z-tighten", "a-chapters"])
  assert.match(useCaseRowsSource(units, new Set(["legacy-a", "legacy-b"])), /"z-tighten".*\n.*"a-chapters"/)
  assert.match(contractsSource(units, new Set(["legacy-a", "legacy-b"])), /UNIT_USE_CASE_TYPES = \[\n {2}"z-tighten", \/\/ unit:z-tighten\n {2}"a-chapters", \/\/ unit:a-chapters\n\] as const/)
})

test("useCaseRowsSource: a row's inputs are typed by the vocabulary's use-case input handles (one list, no second literal)", () => {
  const src = useCaseRowsSource([])
  assert.deepEqual(USE_CASE_INPUT_HANDLES, ["media", "music", "introCard", "masterAudio"])
  assert.match(src, new RegExp(`readonly inputs: ReadonlyArray<${USE_CASE_INPUT_HANDLES.map((h) => JSON.stringify(h)).join(" \\| ")}>`))
})

// A node converted into a unit leaves its row in gen:skills' legacy handle table, and
// backend/src/lib/node-handles.ts throws on a type in both places — before gen:skills could
// re-render the table. gen:units (first in `npm run gen`) prunes it (decided 2026-10-18).
const HANDLES_HEAD = "export const NODE_HANDLES: Readonly<Record<string, NodeHandleSpec>> = {\n"
const handlesTable = (...types) => `${HANDLES_HEAD}${types.map((t) => `  "${t}": { inputs: ["in"], outputs: ["out", "json"] },\n`).join("")}}\n`

test("pruneUnitRows: drops only the rows of unit types, every other byte kept", () => {
  const src = handlesTable("era", "fixture-echo", "upload-video")
  assert.equal(pruneUnitRows(src, new Set(["fixture-echo", "not-a-row"])), handlesTable("era", "upload-video"))
  assert.equal(pruneUnitRows(src, new Set()), src)
  // A line that merely mentions a unit type is not a row.
  const prose = `// "fixture-echo" is a unit\n${src}`
  assert.ok(pruneUnitRows(prose, new Set(["fixture-echo"])).startsWith('// "fixture-echo" is a unit\n'))
})

test("a stale unit row in the handle table: --check flags it, a write prunes it, then no drift", async () => {
  const root = tree()
  try {
    const abs = path.join(root, NODE_HANDLES_TABLE)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, handlesTable("fixture-echo", "upload-video"))
    const opts = { ctx: ctxFor(root), readPrice: stubPrice }
    const err = { text: "", write(x) { this.text += x } }
    const out = { text: "", write(x) { this.text += x } }
    assert.equal(await main(["--check"], root, out, err, opts), 1)
    assert.match(err.text, new RegExp(`^ {2}- ${NODE_HANDLES_TABLE.replaceAll("/", "\\/").replaceAll(".", "\\.")}$`, "m"))
    assert.equal(await main([], root, out, err, opts), 0)
    assert.equal(readFileSync(abs, "utf8"), handlesTable("upload-video"))
    assert.equal(await main(["--check"], root, out, { write() {} }, opts), 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the handle table is pruned, never rendered: it is not one of GEN_UNITS_OUTPUTS, and a tree without it prunes nothing", async () => {
  const { matchesAny } = await import("../test-select/glob.mjs")
  assert.deepEqual(GEN_UNITS_PRUNES, [NODE_HANDLES_TABLE])
  assert.equal(matchesAny(NODE_HANDLES_TABLE, GEN_UNITS_OUTPUTS), false)
  const root = tree()
  try {
    assert.equal((await run(root)).prunes.size, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
