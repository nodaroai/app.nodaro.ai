import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseNodeDefinitions, type NodeDef } from "../../../scripts/lib/gen-skills/parse-node-definitions.js"
import { renderExposableSlidersModule } from "../../../scripts/lib/gen-skills/render-exposable-sliders.js"

const NODES_TS = resolve(__dirname, "../../../../frontend/src/types/nodes.ts")
const GENERATED = resolve(__dirname, "../../lib/mcp/generated/exposable-sliders.ts")

const def = (type: string, sliders: NodeDef["sliders"]): NodeDef => ({
  type,
  label: type,
  category: "ai",
  inputs: [],
  outputs: [],
  defaultData: {},
  sliders,
})

describe("renderExposableSlidersModule", () => {
  it("emits only nodes that expose a slider, sorted by type, each slider's bounds as declared", () => {
    const source = renderExposableSlidersModule([
      def("zeta", [{ key: "b", min: 1, max: 9, step: 0.5 }]),
      def("no-sliders", []),
      def("alpha", [{ key: "a", min: -1, max: 1 }]),
    ])
    expect(source).toContain('  "alpha": { "a": { min: -1, max: 1 } },\n  "zeta": { "b": { min: 1, max: 9, step: 0.5 } },')
    expect(source).not.toContain("no-sliders")
    expect(source.indexOf('"alpha"')).toBeLessThan(source.indexOf('"zeta"'))
  })

  it("carries no timestamp, so an unchanged catalog renders byte-identical output", () => {
    const defs = [def("x", [{ key: "k", min: 0, max: 1, step: 0.1 }])]
    expect(renderExposableSlidersModule(defs)).toBe(renderExposableSlidersModule(defs))
  })

  it("the committed generated table is what NODE_DEFINITIONS renders today", () => {
    // gen:skills:check guards this in CI too; this fails it in the unit suite.
    expect(readFileSync(GENERATED, "utf-8")).toBe(renderExposableSlidersModule(parseNodeDefinitions(NODES_TS)))
  })
})
