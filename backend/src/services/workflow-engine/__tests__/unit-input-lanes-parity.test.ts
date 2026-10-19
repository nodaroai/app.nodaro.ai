// @test-watches tools/units/__fixtures__/unit-input-lanes-parity.json tools/units/__fixtures__/unit-json-outputs.json tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { SimpleEdge, SimpleNode, NodeExecutionState } from "../types.js"

/**
 * A node unit's JSON and many-wire inputs on the server's engine (decided
 * 2026-10-18): the fixture unit fixture-echo (and the JSON-only worker
 * fixture-map, a source), added through the server's one
 * door to the unit descriptors, resolved by the real resolver over every case
 * of tools/units/__fixtures__/unit-input-lanes-parity.json. The editor's half
 * (frontend/src/components/editor/workflow-editor/__tests__/unit-input-lanes-parity.test.ts)
 * reads the same fixture and must produce the same inputs.
 */
vi.mock("../../../lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/unit-descriptors.js")>()
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { readFileSync: read } = await import("node:fs")
  const { descriptor } = await import("../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  // The JSON-only worker of unit-json-outputs.json, a source of JSON.
  const json = JSON.parse(read(new URL("../../../../../tools/units/__fixtures__/unit-json-outputs.json", import.meta.url), "utf8")).unit
  const map = { ...descriptor, type: json.type, label: json.label, outputType: json.outputType, outputs: json.outputs.map((o: { id: string }) => o.id), handles: { inputs: [], outputs: json.outputs } }
  type Unit = (typeof real.UNIT_NODE_DESCRIPTORS)[number]
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as Unit, map as unknown as Unit]
  const unitDescriptorOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DESCRIPTORS: units,
    unitDescriptorOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDescriptorOf(t), h),
  }
})

const { resolveNodeInputs } = await import("../input-resolver.js")
const { extractSavedNodeOutput } = await import("../output-extractor.js")

interface Fixture {
  readonly nodes: ReadonlyArray<SimpleNode & { readonly saved?: false }>
  readonly target: SimpleNode
  readonly cases: ReadonlyArray<{
    readonly name: string
    readonly target?: SimpleNode
    readonly edges: ReadonlyArray<readonly [string, string, string]>
    readonly unitInputs: Record<string, unknown> | null
    readonly alsoExpect?: Record<string, unknown>
  }>
}
const FIXTURE = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/unit-input-lanes-parity.json"), "utf8"),
) as Fixture

/** Every upstream node that ran holds its saved output as a completed state — what the orchestrator seeds for a node it does not re-run. */
function statesOf(nodes: Fixture["nodes"]): Record<string, NodeExecutionState> {
  const out: Record<string, NodeExecutionState> = {}
  for (const n of nodes) {
    if (n.saved === false) continue
    const output = extractSavedNodeOutput(n)
    if (output) out[n.id] = { status: "completed", output } as NodeExecutionState
  }
  return out
}

describe("unit input lanes — the server's engine", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      const target = c.target ?? FIXTURE.target
      const edges: SimpleEdge[] = c.edges.map(([source, sourceHandle, targetHandle], i) => ({ id: `e${i}`, source, target: target.id, sourceHandle, targetHandle }))
      const nodes: SimpleNode[] = [...FIXTURE.nodes, target]
      const inputs = resolveNodeInputs(target, edges, statesOf(FIXTURE.nodes), nodes)
      expect(inputs.unitInputs).toEqual(c.unitInputs ?? undefined)
      for (const [key, value] of Object.entries(c.alsoExpect ?? {})) expect((inputs as Record<string, unknown>)[key], key).toEqual(value)
    })
  }
})
