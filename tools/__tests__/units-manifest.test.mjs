// tools/__tests__/units-manifest.test.mjs
// The unit manifest validator (G6) and loader, tools/units/manifest.mjs, on
// the fixture unit (tools/units/__fixtures__/tree) and on mutations of it.
// @test-watches tools/units/** frontend/src/lib/node-families.ts frontend/src/lib/node-options.tsx frontend/src/lib/*macro*.ts backend/src/ee/billing/credits.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { familyIdsFrom, familyTypesFrom, insertAtPositions, loadUnits, repoContext, reservedIdsFrom, validateUnits } from "../units/manifest.mjs"
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
function withManifest(root, edit, dir = UNIT) {
  const file = path.join(root, dir, "unit.json")
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
    const errs = problems(root, ctxFor(root, { live: liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id) => [id, false]))) }))
    assert.ok(errs.some((e) => /every unit needs the "definitions" seam, which is not live/.test(e)), errs.join("\n"))
    assert.ok(errs.some((e) => /exec\.ts needs the "executors" seam/.test(e)))
    assert.ok(errs.some((e) => /contract\.producer needs the "contracts" seam/.test(e)))
    // How a server-run workflow runs its execution.kind is a seam too.
    assert.ok(errs.some((e) => /execution\.kind "worker" \(a server-run workflow cannot run it: .*\) needs the "run-worker" seam/.test(e)), errs.join("\n"))
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
  ["an input kind with no connection rule", (m) => { m.handles.inputs[0].accepts = ["image"] }, /"image" has no editor connection rule for a unit input yet/],
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
  ["a unit without node.tsx", (root) => rmSync(path.join(root, UNIT, "node.tsx")), /every unit needs frontend\/src\/nodes\/fixture-echo\/node\.tsx/],
  ["a picker unit without option.tsx", (root) => rmSync(path.join(root, UNIT, "option.tsx")), /needs frontend\/src\/nodes\/fixture-echo\/option\.tsx \(its icon\)/],
  // The fixture is a worker with no "ffmpeg-media" capability: the harness characterizes ffmpeg workers only.
  ["characterize.char.ts on a unit that is not an ffmpeg worker", (root) => writeFileSync(path.join(root, BACKEND, "characterize.char.ts"), "export const characterization = 1\n"), /characterize\.char\.ts characterizes an ffmpeg worker/],
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

test("docs.index \"hand-written\": needs docs.page and a hand-written README row linking it (outside the region)", () => {
  const root = tree()
  try {
    const readme = path.join(root, "docs/nodes/README.md")
    const ctx = ctxFor(root, { readText: (p) => { try { return readFileSync(path.join(root, p), "utf8") } catch { return null } } })
    withManifest(root, (m) => { m.docs.index = "hand-written" })
    assert.ok(problems(root, ctx).some((e) => /has no hand-written row linking docs\/nodes\/utility\/fixture-echo\.md/.test(e)))
    // A link inside the generated region is not a hand-written row.
    writeFileSync(readme, readFileSync(readme, "utf8").replace("<!-- gen:units start -->", "<!-- gen:units start -->\n| [Fixture Echo](./utility/fixture-echo.md) | x | y |"))
    assert.ok(problems(root, ctx).some((e) => /has no hand-written row/.test(e)))
    writeFileSync(readme, readFileSync(readme, "utf8").replace("| Node |", "| [Fixture Echo](./utility/fixture-echo.md) | Echo | Test |\n| Node |"))
    assert.deepEqual(problems(root, ctx), [])
    withManifest(root, (m) => { m.docs.index = "generated" })
    assert.ok(problems(root, ctx).some((e) => /docs\.index: "generated" — the only value is "hand-written"/.test(e)))
    withManifest(root, (m) => { m.docs = { awaiting: "not written yet", index: "hand-written" } })
    assert.ok(problems(root, ctx).some((e) => /needs docs\.page/.test(e)))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("registry.after: a known type or null; unknown registry keys are refused", () => {
  const root = tree()
  try {
    withManifest(root, (m) => { m.registry.after = "text-prompt" })
    assert.deepEqual(problems(root), [])
    withManifest(root, (m) => { m.registry.after = null })
    assert.deepEqual(problems(root), [])
    withManifest(root, (m) => { m.registry.after = "no-such-node" })
    assert.ok(problems(root).some((e) => /registry\.after: "no-such-node" is not a node type/.test(e)))
    withManifest(root, (m) => { delete m.registry.after; m.registry.order = 3 })
    assert.ok(problems(root).some((e) => /registry\.order: unknown/.test(e)))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("insertAtPositions: each unit right after its anchor, null first, chains followed, cycles refused", () => {
  assert.deepEqual(insertAtPositions(["a", "b", "c"], [{ type: "x", after: "a" }, { type: "y", after: "x" }, { type: "w", after: null }]), ["w", "a", "x", "y", "b", "c"])
  assert.deepEqual(insertAtPositions(["a"], [{ type: "q", after: "a" }, { type: "p", after: "a" }]), ["a", "p", "q"])
  assert.throws(() => insertAtPositions(["a"], [{ type: "x", after: "y" }, { type: "y", after: "x" }]), /cycle/)
  assert.throws(() => insertAtPositions(["a"], [{ type: "x", after: "zz" }]), /not a node type/)
})

test("the real tree: its units are valid, and the context reads the legacy list and the families", () => {
  const ctx = repoContext(REPO)
  assert.ok(ctx.legacyTypes.size > 200, "legacy-nodes.json lists every hand-written node")
  assert.ok(ctx.families.size > 20, "node-families.ts family ids are found")
  assert.deepEqual(validateUnits(loadUnits(REPO), ctx), [])
})

test("a reserved id is refused: an Object.prototype name, a canvas macro, an add-node option, a credit id", () => {
  const reserved = reservedIdsFrom({
    credits: 'const OTHER = {\n  mood: 1,\n  "not-credit": 2,\n}\nexport const STATIC_CREDIT_COSTS = composeRecord("STATIC_CREDIT_COSTS", {\n  "ai-writer": 10,\n  "seedance-2:720p": 50,\n  ffmpeg: 2,\n  ...SPREAD,\n}, x)\nexport const CREDIT_COSTS = composeRecord<(d: D) => string>("CREDIT_COSTS", {\n  "beeble-switchx": (data) => {\n    inner: 1\n    return "beeble-switchx"\n  },\n}, y)\n',
    codeBuiltCreditIds: ["meta-ads-analysis"],
    options: 'const LEGACY_NODE_OPTIONS = [\n  {\n    type: "macro-like",\n  },\n]\n',
    macros: ['export const REFRAME_MACRO_ID = "reframe"\n'],
  })
  for (const id of ["constructor", "reframe", "macro-like", "ai-writer", "beeble-switchx", "ffmpeg"]) assert.ok(reserved.has(id), id)
  assert.equal(reserved.has("seedance-2"), false, "only a whole credit id is reserved, not a composite's prefix")
  for (const id of ["mood", "not-credit", "inner"]) assert.equal(reserved.has(id), false, `${id}: only the top-level keys of the two credit literals are credit ids`)
  assert.match(reserved.get("meta-ads-analysis"), /built in code: tools\/units\/reserved-credit-ids\.json/)
  for (const [type, why] of [["constructor", /Object\.prototype/], ["reframe", /canvas macro/], ["ai-writer", /credit id/], ["seedance-2", /credit id/]]) {
    const root = tree()
    try {
      cpSync(path.join(root, UNIT), path.join(root, `frontend/src/nodes/${type}`), { recursive: true })
      rmSync(path.join(root, UNIT), { recursive: true })
      cpSync(path.join(root, "backend/src/nodes/fixture-echo"), path.join(root, `backend/src/nodes/${type}`), { recursive: true })
      rmSync(path.join(root, "backend/src/nodes/fixture-echo"), { recursive: true })
      withManifest(root, (m) => { m.type = type }, `frontend/src/nodes/${type}`)
      const ctx = ctxFor(root, { reserved: new Map([...reserved, ["seedance-2", "a credit id in backend/src/ee/billing/credits.ts"]]) })
      if (type === "constructor") delete ctx.reserved // Object.prototype names are refused whatever context is built
      const errs = problems(root, ctx)
      assert.ok(errs.some((e) => e.startsWith(`${type}: "${type}" is reserved: `) && why.test(e)), `${type}: ${errs.join("\n")}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test("picker.after names a type of the unit's own family (or null)", () => {
  const root = tree()
  try {
    const ctx = ctxFor(root, { familyTypes: new Map([["fixture-family", ["upload-video"]], ["other", ["text-prompt"]]]) })
    withManifest(root, (m) => { m.picker.after = "upload-video" })
    assert.deepEqual(problems(root, ctx), [])
    withManifest(root, (m) => { m.picker.after = "text-prompt" })
    assert.ok(problems(root, ctx).some((e) => /picker\.after: "text-prompt" is not in family "fixture-family" — a unit follows a type of its own family \(upload-video\)/.test(e)))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("familyTypesFrom: each legacy family's string types", () => {
  const src = 'const LEGACY_NODE_FAMILIES: readonly F[] = [\n  {\n    id: "a",\n    types: ["x", "y"],\n  },\n  {\n    id: "b",\n    types: [MACRO_ID],\n  },\n]\n'
  assert.deepEqual([...familyTypesFrom(src)], [["a", ["x", "y"]], ["b", []]])
})

test("familyIdsFrom reads only NODE_FAMILIES", () => {
  const src = 'export const NODE_FAMILIES = [\n  { id: "a", x: [] },\n  { id: "b" },\n]\nexport const COMMON = [\n  { id: "not-a-family" },\n]\n'
  assert.deepEqual(familyIdsFrom(src), ["a", "b"])
  const composed = 'const LEGACY_NODE_FAMILIES: readonly F[] = [\n  { id: "a" },\n]\n\nexport const NODE_FAMILIES = LEGACY_NODE_FAMILIES.map((f) => ({ id: "x", ...f }))\nexport const COMMON = [\n  { id: "c" },\n]\n'
  assert.deepEqual(familyIdsFrom(composed), ["a"], "the legacy literal of a composed NODE_FAMILIES")
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
