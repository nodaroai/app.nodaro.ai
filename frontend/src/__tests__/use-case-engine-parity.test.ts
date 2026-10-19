// @test-watches tools/units/__fixtures__/use-case-engine-parity.json tools/units/__fixtures__/use-case-output-shapes.json frontend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { executeNode } from "@/components/editor/workflow-editor/execute-node"
import { getListFanOutForNode, resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"

/**
 * What a use-case node hands on from what it holds, on the canvas's engine —
 * its real readers and executors, over
 * tools/units/__fixtures__/use-case-engine-parity.json. The server's half,
 * held to the same values, is
 * backend/src/services/workflow-engine/__tests__/use-case-engine-parity.test.ts.
 */
const FIXTURES = path.resolve(__dirname, "../../../tools/units/__fixtures__")
const SHAPES = JSON.parse(readFileSync(path.join(FIXTURES, "use-case-output-shapes.json"), "utf8")) as Record<string, Record<string, unknown>>
const PARITY = JSON.parse(readFileSync(path.join(FIXTURES, "use-case-engine-parity.json"), "utf8")) as {
  readonly handOn: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly pip: string | null; readonly value: string | null }>
  readonly prompt: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly target: string; readonly handle: string; readonly prompt: string | null }>
  readonly jsonReaders: ReadonlyArray<{
    readonly type: string
    readonly shape: string
    readonly consumer: "extract-field" | "json-process" | "filter-list"
    readonly data: Record<string, unknown>
    readonly text?: string
    readonly processedResult?: unknown
    readonly items?: readonly string[]
  }>
  readonly fanOut: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly items: readonly string[] | null }>
  readonly listModes: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly mode: string; readonly prompt: string | null }>
}

function source(type: string, shape: string): WorkflowNode {
  const data = SHAPES[shape]
  if (!data) throw new Error(`no shape ${shape} in use-case-output-shapes.json`)
  return { id: "s", type, position: { x: 0, y: 0 }, data: { label: type, ...data } } as unknown as WorkflowNode
}
const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode

const ctx = {
  userId: "u1", projectId: "p1", trackInterval: (i: unknown) => i, untrackInterval: vi.fn(), save: vi.fn(), setIsRunning: vi.fn(),
  isWorkflowStale: () => false, isStorageError: () => false, setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(), setShowInsufficientCredits: vi.fn(),
} as never

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("a use-case node's hand-on — the canvas's engine", () => {
  for (const r of PARITY.handOn) {
    it(`${r.type} ${r.shape} → ${r.pip ?? "(no pip)"}`, () => {
      expect(extractNodeOutput(source(r.type, r.shape), r.pip ?? undefined) ?? null).toBe(r.value)
    })
  }
})

describe("a use-case node's json pip into a text or prompt input — the canvas's engine", () => {
  for (const r of PARITY.prompt) {
    it(`${r.type} ${r.shape} json → ${r.target}.${r.handle}`, () => {
      const src = source(r.type, r.shape)
      const target = node("t", r.target)
      const connection = { source: "s", target: "t", sourceHandle: "json", targetHandle: r.handle }
      // The canvas accepts the wire, so what it carries must be what the server hands on.
      expect(isValidWorkflowConnection(connection, (id) => (id === "s" ? r.type : id === "t" ? r.target : undefined))).toBe(true)
      const inputs = resolveNodeInputs(target, [src, target], [{ id: "e", ...connection }] as WorkflowEdge[])
      expect(inputs.prompt ?? null).toBe(r.prompt)
      expect(inputs.videoUrl).toBeUndefined()
    })
  }
})

describe("the JSON consumers on a use-case node's json pip — the canvas's engine", () => {
  for (const c of PARITY.jsonReaders) {
    it(`${c.type} ${c.shape} json → ${c.consumer}`, async () => {
      const src = source(c.type, c.shape)
      const consumer = node("c", c.consumer, c.data)
      const edges = [{ id: "e", source: "s", target: "c", sourceHandle: "json", targetHandle: "in" }] as WorkflowEdge[]
      act(() => useWorkflowStore.setState({ nodes: [src, consumer], edges }))
      await executeNode(consumer, ctx)
      const data = useWorkflowStore.getState().nodes.find((n) => n.id === "c")!.data as Record<string, unknown>
      if (c.consumer === "extract-field") expect(data.extractedText).toBe(c.text)
      else if (c.consumer === "json-process") expect(data.processedResult ?? null).toEqual(c.processedResult)
      else expect(data.listResults).toEqual(c.items)
    })
  }
})

describe("an Each wire from a use-case node's json pip — the canvas's engine", () => {
  for (const c of PARITY.fanOut) {
    it(`${c.type} ${c.shape}`, () => {
      const src = source(c.type, c.shape)
      const prompt = node("c", "text-prompt")
      const edges = [{ id: "e", source: "s", target: "c", sourceHandle: "json", targetHandle: "in", data: { outputMode: "each" } }] as WorkflowEdge[]
      expect(getListFanOutForNode(prompt, [src, prompt], edges)?.items ?? null).toEqual(c.items)
    })
  }
})

describe("an item wire from a use-case node's json pip — the canvas's engine", () => {
  for (const c of PARITY.listModes) {
    it(`${c.type} ${c.shape} ${c.mode}`, () => {
      const src = source(c.type, c.shape)
      const prompt = node("c", "text-prompt")
      const edges = [{ id: "e", source: "s", target: "c", sourceHandle: "json", targetHandle: "in", data: { outputMode: c.mode } }] as WorkflowEdge[]
      expect(resolveNodeInputs(prompt, [src, prompt], edges).prompt ?? null).toBe(c.prompt)
    })
  }
})
