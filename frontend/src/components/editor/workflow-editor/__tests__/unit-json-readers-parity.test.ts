// @test-watches tools/units/__fixtures__/unit-json-readers.json tools/units/__fixtures__/unit-json-outputs.json tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** frontend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

/**
 * Extract Field, JSON Process and the list operators read the JSON output of
 * the pip a wire leaves from (decided 2026-10-18), on the canvas's engine —
 * the real executors — over tools/units/__fixtures__/unit-json-readers.json.
 * The server's half is
 * backend/src/services/workflow-engine/__tests__/unit-json-readers-parity.test.ts.
 * The source is the JSON-only worker of unit-json-outputs.json, added through
 * the editor's one door to the unit definitions.
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { readFileSync: read } = await import("node:fs")
  const { resolve } = await import("node:path")
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { definition } = await import("../../../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
  const json = JSON.parse(read(resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")).unit
  const map = { ...definition, type: json.type, label: json.label, picker: null, priceRows: {}, outputs: json.outputs.map((o: { id: string }) => o.id), handles: { inputs: [], outputs: json.outputs } }
  // fixture-echo itself too: its JSON input (`plan`) is the per-wire reads' consumer.
  const units = [...real.UNIT_NODE_DEFINITIONS, definition as unknown as (typeof real.UNIT_NODE_DEFINITIONS)[number], map as unknown as (typeof real.UNIT_NODE_DEFINITIONS)[number]]
  const unitDefinitionOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DEFINITIONS: units,
    unitDefinitionOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDefinitionOf(t), h),
  }
})

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { executeNode } from "../execute-node"
import { getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"

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
const READERS = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-json-readers.json"), "utf8")) as {
  readonly sources: Record<string, { readonly data: Record<string, unknown> }>
  readonly cases: ReadonlyArray<Case>
  readonly fanOut: ReadonlyArray<{ readonly name: string; readonly source: string; readonly pip: string; readonly items: readonly string[] | null }>
  readonly edgeModes: ReadonlyArray<{ readonly name: string; readonly source: string; readonly pip: string; readonly mode: string; readonly plan: string }>
}
const TYPE = (JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")) as { unit: { type: string } }).unit.type

const ctx = {
  userId: "u1", projectId: "p1", trackInterval: (i: unknown) => i, untrackInterval: vi.fn(), save: vi.fn(), setIsRunning: vi.fn(),
  isWorkflowStale: () => false, isStorageError: () => false, setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(), setShowInsufficientCredits: vi.fn(),
} as never

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("pip-aware JSON readers — the canvas's engine", () => {
  for (const c of READERS.cases) {
    it(c.name, async () => {
      const src = { id: "m", type: TYPE, position: { x: 0, y: 0 }, data: { label: "Map", ...READERS.sources[c.source]!.data } } as unknown as WorkflowNode
      const node = { id: "c", type: c.consumer, position: { x: 0, y: 0 }, data: { label: c.consumer, ...c.data } } as unknown as WorkflowNode
      const edges = [{ id: "e", source: "m", target: "c", sourceHandle: c.pip, targetHandle: "in" }] as WorkflowEdge[]
      act(() => useWorkflowStore.setState({ nodes: [src, node], edges }))
      await executeNode(node, ctx)
      const data = useWorkflowStore.getState().nodes.find((n) => n.id === "c")!.data as Record<string, unknown>
      if (c.consumer === "extract-field") expect(data.extractedText).toBe(c.text)
      else if (c.consumer === "json-process") expect(data.processedResult).toEqual(c.processedResult)
      else expect(data.listResults).toEqual(c.items)
    })
  }
})

describe("pip-aware fan-out — the canvas's engine", () => {
  for (const c of READERS.fanOut) {
    it(c.name, () => {
      const src = { id: "m", type: TYPE, position: { x: 0, y: 0 }, data: { label: "Map", ...READERS.sources[c.source]!.data } } as unknown as WorkflowNode
      const node = { id: "c", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Prompt" } } as unknown as WorkflowNode
      const edges = [{ id: "e", source: "m", target: "c", sourceHandle: c.pip, targetHandle: "in", data: { outputMode: "each" } }] as WorkflowEdge[]
      expect(getListFanOutForNode(node, [src, node], edges)?.items ?? null).toEqual(c.items)
    })
  }
})

describe("pip-aware per-wire list reads (item, item:N, Bundle, Selected) — the canvas's engine", () => {
  for (const c of READERS.edgeModes) {
    it(c.name, () => {
      const src = { id: "m", type: TYPE, position: { x: 0, y: 0 }, data: { label: "Map", ...READERS.sources[c.source]!.data } } as unknown as WorkflowNode
      const node = { id: "c", type: "fixture-echo", position: { x: 0, y: 0 }, data: { label: "Echo" } } as unknown as WorkflowNode
      const edges = [{ id: "e", source: "m", target: "c", sourceHandle: c.pip, targetHandle: "plan", data: { outputMode: c.mode } }] as WorkflowEdge[]
      act(() => useWorkflowStore.setState({ nodes: [src, node], edges }))
      expect((resolveNodeInputs(node, [src, node], edges) as { unitInputs?: Record<string, unknown> }).unitInputs?.plan).toBe(c.plan)
    })
  }
})
