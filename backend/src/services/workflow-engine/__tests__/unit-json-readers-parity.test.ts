// @test-watches tools/units/__fixtures__/unit-json-readers.json tools/units/__fixtures__/unit-json-outputs.json tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionState, NodeOutput, SimpleEdge, SimpleNode } from "../types.js"

/**
 * Extract Field, JSON Process and the list operators read the JSON output of
 * the pip a wire leaves from (decided 2026-10-18), on the server's engine, over
 * tools/units/__fixtures__/unit-json-readers.json. The editor's half is
 * frontend/src/components/editor/workflow-editor/__tests__/unit-json-readers-parity.test.ts.
 * The source is the JSON-only worker of unit-json-outputs.json, added through
 * the server's one door to the unit descriptors.
 */
vi.mock("../../../lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/unit-descriptors.js")>()
  const { readFileSync: read } = await import("node:fs")
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { descriptor } = await import("../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const unit = JSON.parse(read(new URL("../../../../../tools/units/__fixtures__/unit-json-outputs.json", import.meta.url), "utf8")).unit
  const map = { ...descriptor, type: unit.type, label: unit.label, outputType: unit.outputType, outputs: unit.outputs.map((o: { id: string }) => o.id), handles: { inputs: [], outputs: unit.outputs } }
  // fixture-echo itself too: its JSON input (`plan`) is the per-wire reads' consumer.
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number], map as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]]
  const unitDescriptorOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DESCRIPTORS: units,
    unitDescriptorOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDescriptorOf(t), h),
  }
})

const { buildNodeOutputFromJobData, extractSavedNodeOutput } = await import("../output-extractor.js")
const { executeExtractField, executeFilterList, executeJsonProcess } = await import("../inline-executor.js")
const { getListFanOutForNode, resolveNodeInputs } = await import("../input-resolver.js")
const { seededFromSavedData } = await import("../saved-data.js")

interface Case {
  readonly name: string
  readonly source: string
  readonly pip: string
  readonly consumer: "extract-field" | "json-process" | "filter-list"
  readonly data: Record<string, unknown>
  readonly text?: string
  readonly processedResult?: unknown
  readonly items?: readonly string[]
}
const READERS = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/unit-json-readers.json"), "utf8")) as {
  readonly sources: Record<string, { readonly data: Record<string, unknown>; readonly outputData?: Record<string, unknown> }>
  readonly cases: ReadonlyArray<Case>
  readonly fanOut: ReadonlyArray<{ readonly name: string; readonly source: string; readonly pip: string; readonly items: readonly string[] | null }>
  readonly edgeModes: ReadonlyArray<{ readonly name: string; readonly source: string; readonly pip: string; readonly mode: string; readonly plan: string }>
}
const TYPE = (JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")) as { unit: { type: string } }).unit.type

/** The source's states on the server: seeded from its data, and — for a job — the live row. */
function statesOf(source: (typeof READERS.sources)[string]): Array<[string, NodeOutput | undefined]> {
  const out: Array<[string, NodeOutput | undefined]> = [["seeded", extractSavedNodeOutput({ id: "m", type: TYPE, data: { label: "Map", ...source.data } })]]
  if (source.outputData) out.push(["live", buildNodeOutputFromJobData(source.outputData, TYPE)])
  return out
}

describe("pip-aware JSON readers — the server's engine", () => {
  for (const c of READERS.cases) {
    for (const [lane, output] of statesOf(READERS.sources[c.source]!)) {
      it(`${c.name} (${lane})`, () => {
        const src: SimpleNode = { id: "m", type: TYPE, data: { label: "Map", ...READERS.sources[c.source]!.data } }
        const node: SimpleNode = { id: "c", type: c.consumer, data: { label: c.consumer, ...c.data } }
        const edges: SimpleEdge[] = [{ id: "e", source: "m", target: "c", sourceHandle: c.pip, targetHandle: "in" }]
        const states: Record<string, NodeExecutionState> = output ? { m: { status: "completed", output } as NodeExecutionState } : {}
        if (c.consumer === "extract-field") expect(executeExtractField(node, edges, [src, node], states).extractedText).toBe(c.text)
        else if (c.consumer === "json-process") expect(executeJsonProcess(node, edges, [src, node], states).processedResult).toEqual(c.processedResult)
        else expect(executeFilterList(node, edges, [src, node], states).listResults).toEqual(c.items)
      })
    }
  }
})

describe("pip-aware fan-out — the server's engine", () => {
  for (const c of READERS.fanOut) {
    const data = { label: "Map", ...READERS.sources[c.source]!.data }
    const src: SimpleNode = { id: "m", type: TYPE, data }
    const seeded = extractSavedNodeOutput(src)
    // This run ran it, the saved data stands in with nothing seeded, and the saved data seeded.
    const lanes: Array<[string, Record<string, NodeExecutionState>]> = [
      ["this run", seeded ? { m: { status: "completed", output: seeded } as NodeExecutionState } : {}],
      ["saved", {}],
      ["seeded", { m: seededFromSavedData(seeded) }],
    ]
    for (const [lane, states] of lanes) {
      it(`${c.name} (${lane})`, () => {
        const node: SimpleNode = { id: "c", type: "text-prompt", data: { label: "Prompt" } }
        const edges: SimpleEdge[] = [{ id: "e", source: "m", target: "c", sourceHandle: c.pip, targetHandle: "in", data: { outputMode: "each" } } as SimpleEdge]
        expect(getListFanOutForNode(node, edges, states, [src, node])?.items ?? null).toEqual(c.items)
      })
    }
  }
})

describe("pip-aware per-wire list reads (item, item:N, Bundle, Selected) — the server's engine", () => {
  for (const c of READERS.edgeModes) {
    const data = { label: "Map", ...READERS.sources[c.source]!.data }
    const src: SimpleNode = { id: "m", type: TYPE, data }
    const seeded = extractSavedNodeOutput(src)
    // This run ran it, or the saved data seeded it (the orchestrator seeds every node it does not run).
    const lanes: Array<[string, Record<string, NodeExecutionState>]> = [
      ["this run", seeded ? { m: { status: "completed", output: seeded } as NodeExecutionState } : {}],
      ["seeded", { m: seededFromSavedData(seeded) }],
    ]
    for (const [lane, states] of lanes) {
      it(`${c.name} (${lane})`, () => {
        const node: SimpleNode = { id: "c", type: "fixture-echo", data: { label: "Echo" } }
        const edges: SimpleEdge[] = [{ id: "e", source: "m", target: "c", sourceHandle: c.pip, targetHandle: "plan", data: { outputMode: c.mode } } as SimpleEdge]
        expect(resolveNodeInputs(node, edges, states, [src, node]).unitInputs?.plan).toBe(c.plan)
      })
    }
  }
})
