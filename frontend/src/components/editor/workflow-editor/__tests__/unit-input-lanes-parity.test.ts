// @test-watches tools/units/__fixtures__/unit-input-lanes-parity.json tools/units/__fixtures__/unit-json-outputs.json tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** frontend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

/**
 * A node unit's JSON and many-wire inputs on the canvas's engine (decided
 * 2026-10-18): the fixture unit fixture-echo (and the JSON-only worker
 * fixture-map, a source), added through the editor's one
 * door to the unit definitions, resolved by the real resolver over every case
 * of tools/units/__fixtures__/unit-input-lanes-parity.json. The server's half
 * (backend/src/services/workflow-engine/__tests__/unit-input-lanes-parity.test.ts)
 * reads the same fixture and must produce the same inputs.
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { readFileSync: read } = await import("node:fs")
  const { resolve } = await import("node:path")
  const { definition } = await import("../../../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
  // The JSON-only worker of unit-json-outputs.json, a source of JSON.
  const json = JSON.parse(read(resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")).unit
  const map = { ...definition, type: json.type, label: json.label, outputs: json.outputs.map((o: { id: string }) => o.id), handles: { inputs: [], outputs: json.outputs } }
  type Unit = (typeof real.UNIT_NODE_DEFINITIONS)[number]
  const units = [...real.UNIT_NODE_DEFINITIONS, definition as unknown as Unit, map as unknown as Unit]
  const unitDefinitionOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DEFINITIONS: units,
    unitDefinitionOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDefinitionOf(t), h),
  }
})

import { resolveNodeInputs } from "../node-input-resolver"

interface FixtureNode { readonly id: string; readonly type: string; readonly data: Record<string, unknown>; readonly saved?: false }
interface Fixture {
  readonly nodes: ReadonlyArray<FixtureNode>
  readonly target: FixtureNode
  readonly cases: ReadonlyArray<{
    readonly name: string
    readonly target?: FixtureNode
    readonly edges: ReadonlyArray<readonly [string, string, string]>
    readonly unitInputs: Record<string, unknown> | null
    readonly alsoExpect?: Record<string, unknown>
  }>
}
const FIXTURE = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-input-lanes-parity.json"), "utf8"),
) as Fixture

// The canvas reads every node's output from its data (a node that never ran holds none).
const canvasNode = (n: FixtureNode) => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n.data }) as never

describe("unit input lanes — the canvas's engine", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      const target = c.target ?? FIXTURE.target
      const edges = c.edges.map(([source, sourceHandle, targetHandle], i) => ({ id: `e${i}`, source, target: target.id, sourceHandle, targetHandle }))
      const nodes = [...FIXTURE.nodes, target].map(canvasNode)
      const inputs = resolveNodeInputs(canvasNode(target), nodes, edges as never)
      expect(inputs.unitInputs).toEqual(c.unitInputs ?? undefined)
      for (const [key, value] of Object.entries(c.alsoExpect ?? {})) expect((inputs as Record<string, unknown>)[key], key).toEqual(value)
    })
  }
})
