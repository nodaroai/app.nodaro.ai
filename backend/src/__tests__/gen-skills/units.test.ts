// @test-watches tools/units/** frontend/src/types/nodes.ts frontend/src/nodes/*/unit.json
import { afterAll, describe, expect, it } from "vitest"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseDataInterface, parseNodeDefinitions } from "../../../scripts/lib/gen-skills/parse-node-definitions.js"
import { renderNodeDataShapeBlock, renderWorkflowEditorCatalog } from "../../../scripts/lib/gen-skills/render-skill.js"
import { renderNodeDataFieldsModule } from "../../../scripts/lib/gen-skills/render-node-data-fields.js"
import { renderNodeHandlesModule } from "../../../scripts/lib/gen-skills/render-node-handles.js"
import { GEN_SKILLS_OUTPUTS } from "../../../scripts/lib/gen-skills/outputs.js"
import { GEN_UNITS_OUTPUTS } from "../../../../tools/units/gen.mjs"
import { pruneUnitRows } from "../../../../tools/units/handle-prune.mjs"
import { insertAtPositions, loadUnits } from "../../../../tools/units/manifest.mjs"

/**
 * gen:skills loads node units (tools/units/README.md) through the same loader
 * as gen:units: proven on the fixture unit `fixture-echo` in a temporary tree
 * and on the real tree, where each unit is parsed at its position.after.
 */

const REPO = resolve(__dirname, "../../../..")
const tree = mkdtempSync(join(tmpdir(), "gen-skills-units-"))
cpSync(join(REPO, "tools/units/__fixtures__/tree"), tree, { recursive: true })
mkdirSync(join(tree, "frontend/src/types"), { recursive: true })
const NODES_TS = join(tree, "frontend/src/types/nodes.ts")
writeFileSync(NODES_TS, `export const NODE_DEFINITIONS = [
  { type: "text-prompt", label: "Text", category: "input", inputs: ["in"], outputs: ["prompt"], defaultData: { label: "Text", text: "" } },
  { type: "upload-video", label: "Upload Video", category: "input", inputs: ["in"], outputs: ["video"], defaultData: { label: "Upload Video", url: "" } },
  { type: "list", label: "List", category: "input", inputs: [], outputs: [], defaultData: { label: "List" } },
]
`)
afterAll(() => rmSync(tree, { recursive: true, force: true }))

describe("gen:skills sees node units", () => {
  const defs = parseNodeDefinitions(NODES_TS)

  it("inserts the unit right after its position.after, from its manifest", () => {
    // fixture-case (the use-case fixture) follows fixture-echo: a unit may follow a unit.
    expect(defs.map((d) => d.type)).toEqual(["text-prompt", "upload-video", "fixture-echo", "fixture-case", "list"])
    const echo = defs.find((d) => d.type === "fixture-echo")!
    expect(echo).toMatchObject({ label: "Fixture Echo", category: "utility", inputs: ["in"], outputs: ["video-out"], defaultDataKeys: ["label", "fieldMappings"] })
    expect(echo.unit?.typesFile).toBe(join(tree, "frontend/src/nodes/fixture-echo/types.ts"))
    expect(defs.find((d) => d.type === "list")!.unit).toBeUndefined()
  })

  it("appears in the workflow-editor catalog, in its node skill and in node-data-fields", () => {
    const echo = defs.find((d) => d.type === "fixture-echo")!
    expect(renderWorkflowEditorCatalog(defs)).toContain("fixture-echo")
    const shape = parseDataInterface(echo.unit!.typesFile!, "FixtureEchoData")
    expect(shape?.fields.map((f) => f.name)).toEqual(["label", "videoUrl", "generatedVideoUrl"])
    expect(renderNodeDataShapeBlock(echo, shape)).toContain("videoUrl")
    expect(renderNodeDataFieldsModule(defs, new Map([["fixture-echo", shape]]))).toContain("\"fixture-echo\"")
  })

  it("node-handles.ts stays legacy-only: the renderer gen-skills.ts calls drops units itself", () => {
    const rendered = renderNodeHandlesModule(defs)
    expect(rendered).not.toContain("fixture-echo")
    expect(rendered).toContain('"upload-video"')
  })

  it("the real tree: the literal plus every unit, each at its position.after", () => {
    const real = parseNodeDefinitions(join(REPO, "frontend/src/types/nodes.ts"))
    const units = loadUnits(REPO)
    expect(real.filter((d) => d.unit).map((d) => d.type).sort()).toEqual(units.map((u) => u.type))
    const legacy = real.filter((d) => !d.unit).map((d) => d.type)
    expect(real.map((d) => d.type)).toEqual(insertAtPositions(legacy, units.map((u) => ({ type: u.type, after: u.manifest.position.after }))))
  })
})

describe("gen:units and gen:skills never write the same file", () => {
  it("their output lists are disjoint", () => {
    const prefix = (g: string) => g.replace(/[*{].*$/, "")
    const clashes = GEN_UNITS_OUTPUTS.flatMap((u: string) => GEN_SKILLS_OUTPUTS
      .filter((s) => prefix(u).startsWith(s) || s.startsWith(prefix(u)))
      .map((s) => `${u} ∩ ${s}`))
    expect(clashes).toEqual([])
  })
})

describe("gen:units prunes a converted node's row from the handle table, so gen:skills can run", () => {
  // A conversion leaves the node's row in mcp/generated/node-handles.ts; lib/node-handles.ts
  // throws on a type that is both a row and a unit, and gen:skills reaches it through its
  // static imports before it could re-render the table. gen:units runs first and prunes.
  const real = parseNodeDefinitions(join(REPO, "frontend/src/types/nodes.ts"))
  const unitTypes = new Set(real.filter((d) => d.unit).map((d) => d.type))

  it("the pruned stale table is exactly what gen:skills renders, so it then writes nothing", () => {
    expect(unitTypes.size).toBeGreaterThan(0)
    const stale = renderNodeHandlesModule(real.map((d) => ({ ...d, unit: undefined })))
    for (const t of unitTypes) expect(stale).toContain(`  ${JSON.stringify(t)}: {`)
    expect(pruneUnitRows(stale, unitTypes)).toBe(renderNodeHandlesModule(real))
  })
})
