// tools/__tests__/units-manifest.test.mjs
// The unit manifest validator (G6) and loader, tools/units/manifest.mjs, on
// the fixture unit (tools/units/__fixtures__/tree) and on mutations of it.
// @test-watches tools/units/**
import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { familyIdsFrom, insertAtPositions, loadUnits, repoContext, validateUnits } from "../units/manifest.mjs"
import { ALL_SEAM_IDS, liveSeams } from "../units/seams.mjs"
import * as vocabulary from "../units/vocabulary.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, "../units/__fixtures__/tree")
const REPO = path.join(here, "../..")
const UNIT = "frontend/src/nodes/fixture-echo"
const BACKEND = "backend/src/nodes/fixture-echo"

function tree() {
  const dir = mkdtempSync(path.join(tmpdir(), "units-manifest-"))
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}
const allLive = () => liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id) => [id, true])))
const ctxFor = (root, over = {}) => ({
  legacyTypes: new Set(["text-prompt", "upload-video"]),
  families: new Set(["fixture-family"]),
  live: allLive(),
  capabilities: {},
  exists: (p) => { try { readFileSync(path.join(root, p)); return true } catch { return false } },
  ...over,
})
function withManifest(root, edit) {
  const file = path.join(root, UNIT, "unit.json")
  const m = JSON.parse(readFileSync(file, "utf8"))
  edit(m)
  writeFileSync(file, JSON.stringify(m))
}
const problems = (root, ctx = ctxFor(root)) => validateUnits(loadUnits(root), ctx)

test("the fixture unit is valid with every seam live", () => {
  const root = tree()
  try {
    const units = loadUnits(root)
    assert.deepEqual(units.map((u) => u.type), ["fixture-echo"])
    assert.deepEqual(problems(root), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("no unit folders is zero units, never an error", () => {
  const root = mkdtempSync(path.join(tmpdir(), "units-empty-"))
  try {
    assert.deepEqual(loadUnits(root), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a unit whose seams are not live fails: a node builds the seam it needs in its own PR", () => {
  const root = tree()
  try {
    const errs = problems(root, ctxFor(root, { live: liveSeams() }))
    assert.ok(errs.some((e) => /every unit needs the "definitions" seam, which is not live/.test(e)), errs.join("\n"))
    assert.ok(errs.some((e) => /exec\.ts needs the "executors" seam/.test(e)))
    assert.ok(errs.some((e) => /contract\.producer needs the "contracts" seam/.test(e)))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const cases = [
  ["type differs from its folder", (m) => { m.type = "other-echo" }, /must equal its folder name/],
  ["a legacy type", null, /also a legacy node/, { legacyTypes: new Set(["fixture-echo", "upload-video"]) }],
  ["parameter pickers are not units", (m) => { m.kind = "parameter-picker" }, /parameter pickers/],
  ["macros are not units", (m) => { m.kind = "macro" }, /canvas macros/],
  ["unknown top-level key", (m) => { m.extra = 1 }, /unknown key "extra"/],
  ["position.after missing", (m) => { delete m.position.after }, /position\.after is required/],
  ["position.after unknown type", (m) => { m.position.after = "no-such-node" }, /"no-such-node" is not a node type/],
  ["picker missing", (m) => { delete m.picker }, /picker is required/],
  ["picker.after missing", (m) => { delete m.picker.after }, /picker\.after is required/],
  ["unknown family", (m) => { m.picker.family = "nope" }, /picker\.family "nope"/],
  ["duplicate handle ids", (m) => { m.handles.outputs[0].id = "in" }, /handle ids must be unique/],
  ["unknown handle kind", (m) => { m.handles.inputs[0].accepts = ["smell"] }, /"smell" is not a handle kind/],
  ["media output without producer", (m) => { delete m.contract }, /declares no contract\.producer/],
  ["producer disagrees with outputs", (m) => { m.contract.producer = "audio" }, /contract\.producer is "audio"/],
  ["contract is a whitelist", (m) => { m.contract.creditId = "x" }, /the contract is a whitelist/],
  ["no price in a manifest", (m) => { m.defaultData.creditCost = 20 }, /no price or credit field/],
  ["no prompt text in a manifest", (m) => { m.defaultData.prompt = "Write a poem" }, /no prompt text/],
  ["unknown capability", (m) => { m.capabilities = ["teleport"] }, /capability "teleport" is not in tools\/units\/capabilities\.mjs/],
  ["bad execution kind", (m) => { m.execution.kind = "magic" }, /execution\.kind must be one of/],
  ["worker needs a queue", (m) => { delete m.execution.queue }, /execution\.queue/],
  ["registry needs a description", (m) => { m.registry.description = "" }, /registry needs a description/],
  ["docs needs a page or a reason", (m) => { delete m.docs.page }, /docs needs exactly one of page/],
  ["docs page must exist", (m) => { m.docs.page = "docs/nodes/utility/missing.md" }, /does not exist/],
  ["inline runs no route", (m) => { m.execution = { kind: "inline" }; m.contract = { producer: "video" } }, /runs no route/],
]
for (const [name, edit, re, over] of cases) {
  test(`G6 rejects: ${name}`, () => {
    const root = tree()
    try {
      if (edit) withManifest(root, edit)
      const errs = problems(root, ctxFor(root, over))
      assert.ok(errs.some((e) => re.test(e)), `expected ${re} in:\n${errs.join("\n")}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

const fileCases = [
  ["a worker without worker.ts", (root) => rmSync(path.join(root, BACKEND, "worker.ts")), /needs backend\/src\/nodes\/fixture-echo\/worker\.ts/],
  ["a route without price.ee.ts", (root) => rmSync(path.join(root, BACKEND, "price.ee.ts")), /needs backend\/src\/nodes\/fixture-echo\/price\.ee\.ts/],
  ["route.ts and route.ee.ts together", (root) => writeFileSync(path.join(root, BACKEND, "route.ee.ts"), "export const route = 1\n"), /exclusive/],
  ["an unknown unit file", (root) => writeFileSync(path.join(root, UNIT, "helpers.ts"), "export const x = 1\n"), /not a unit file/],
  ["types.ts without the <Pascal>Data interface", (root) => writeFileSync(path.join(root, UNIT, "types.ts"), "export interface Other { a: 1 }\n"), /must export FixtureEchoData/],
  ["a backend folder with no manifest", (root) => cpSync(path.join(root, BACKEND), path.join(root, "backend/src/nodes/orphan-node"), { recursive: true }), /orphan-node: frontend\/src\/nodes\/orphan-node\/unit\.json is missing/],
  ["a strings key missing a locale", (root) => {
    const f = path.join(root, UNIT, "strings.json")
    const s = JSON.parse(readFileSync(f, "utf8"))
    delete s.keys["node.fixtureEcho"].ko
    writeFileSync(f, JSON.stringify(s))
  }, /needs a non-empty "ko"/],
]
for (const [name, mutate, re] of fileCases) {
  test(`G6 rejects: ${name}`, () => {
    const root = tree()
    try {
      mutate(root)
      const errs = problems(root)
      assert.ok(errs.some((e) => re.test(e)), `expected ${re} in:\n${errs.join("\n")}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("insertAtPositions: each unit right after its anchor, null first, chains followed, cycles refused", () => {
  assert.deepEqual(insertAtPositions(["a", "b", "c"], [{ type: "x", after: "a" }, { type: "y", after: "x" }, { type: "w", after: null }]), ["w", "a", "x", "y", "b", "c"])
  assert.deepEqual(insertAtPositions(["a"], [{ type: "q", after: "a" }, { type: "p", after: "a" }]), ["a", "p", "q"])
  assert.throws(() => insertAtPositions(["a"], [{ type: "x", after: "y" }, { type: "y", after: "x" }]), /cycle/)
  assert.throws(() => insertAtPositions(["a"], [{ type: "x", after: "zz" }]), /not a node type/)
})

test("the real tree: zero units today, and the context reads the legacy list and the families", () => {
  const ctx = repoContext(REPO)
  assert.ok(ctx.legacyTypes.size > 200, "legacy-nodes.json lists every hand-written node")
  assert.ok(ctx.families.size > 20, "node-families.ts family ids are found")
  assert.deepEqual(validateUnits(loadUnits(REPO), ctx), [])
})

test("familyIdsFrom reads only NODE_FAMILIES", () => {
  const src = 'export const NODE_FAMILIES = [\n  { id: "a", x: [] },\n  { id: "b" },\n]\nexport const COMMON = [\n  { id: "not-a-family" },\n]\n'
  assert.deepEqual(familyIdsFrom(src), ["a", "b"])
})

test("unit.schema.json's enums are the validator's vocabularies", () => {
  const schema = JSON.parse(readFileSync(path.join(here, "../units/unit.schema.json"), "utf8"))
  assert.deepEqual(schema.properties.category.enum, vocabulary.CATEGORIES)
  assert.deepEqual(schema.properties.handles.properties.outputs.items.properties.kind.enum, vocabulary.HANDLE_KINDS)
  assert.deepEqual(schema.properties.execution.properties.kind.enum, vocabulary.EXECUTION_KINDS)
  assert.deepEqual(schema.properties.execution.properties.queue.enum, vocabulary.QUEUES)
  assert.deepEqual(schema.properties.registry.properties.outputType.enum, vocabulary.OUTPUT_TYPES)
  assert.deepEqual(schema.properties.contract.properties.producer.enum, vocabulary.PRODUCER_KINDS)
})
