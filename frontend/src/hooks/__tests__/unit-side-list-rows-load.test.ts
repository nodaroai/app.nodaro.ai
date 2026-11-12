// @test-watches frontend/src/nodes/**
import { describe, it, expect, vi } from "vitest"

/**
 * The two load-time lanes that build per-row takes from a server run's
 * `listResults` — a run still going when the editor reopens
 * (`applyBackendExecutionState`) and one that ended while it was closed
 * (`applyCompletedExecutionResults`) — land each row's take with THAT row's
 * side outputs, as the live lane does (workflow-editor/__tests__/
 * unit-side-list-rows-live.test.ts, the same fixture); the node's own fields
 * hold every row's, row-aligned (the output's own side outputs).
 */

vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { FIXTURE_LAYERS_UNIT } = await import("@/components/editor/workflow-editor/__tests__/unit-side-list-rows.fixture")
  const units = [...real.UNIT_NODE_DEFINITIONS, FIXTURE_LAYERS_UNIT]
  return { ...real, UNIT_NODE_DEFINITIONS: units, unitDefinitionOf: (t: string | undefined) => units.find((u) => u.type === t) }
})
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({ prefetchModelCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/api", () => ({
  getBatchJobStatus: vi.fn(),
  listWorkflowExecutions: vi.fn(),
  getCharacter: vi.fn(),
  getWorkflowAccess: () => Promise.reject(new Error("not mocked in this file")),
  isNotFoundError: () => false,
  getCurrentUserId: async () => "u1",
  getWorkflowDocument: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ from: vi.fn(), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector({ nodes: [], edges: [] }), {
    getState: () => ({ nodes: [], edges: [] }),
    setState: vi.fn(),
    subscribe: vi.fn(),
    destroy: vi.fn(),
  }),
}))

import { applyBackendExecutionState, applyCompletedExecutionResults } from "../use-workflow-persistence"
import { BATCH_SIDE, FANNED_OUT_OUTPUT, FIXTURE_LAYERS_UNIT, ROW_A, ROW_B } from "@/components/editor/workflow-editor/__tests__/unit-side-list-rows.fixture"

const nodes = () =>
  [{ id: "split", type: FIXTURE_LAYERS_UNIT.type, position: { x: 0, y: 0 }, data: { label: "Fixture Layers" } }] as unknown as Parameters<typeof applyCompletedExecutionResults>[0]
const state = { status: "completed" as const, startedAt: "2026-11-11T10:00:00.000Z", jobId: "job-b", output: FANNED_OUT_OUTPUT }

function expectRows(data: Record<string, unknown>) {
  const takes = data.generatedResults as Array<Record<string, unknown>>
  expect(takes.map((r) => r.url)).toEqual([ROW_A.url, ROW_B.url])
  expect(takes[0]).toMatchObject({ generatedLayerUrls: ROW_A.layers, generatedLayerData: ROW_A.layerData, layersNotSaved: 0 })
  expect(takes[1]).toMatchObject({ generatedLayerUrls: ROW_B.layers, generatedLayerData: ROW_B.layerData, layersNotSaved: 2 })
  expect(data).toMatchObject({ generatedImageUrl: ROW_A.url, generatedLayerUrls: BATCH_SIDE.layers, generatedLayerData: BATCH_SIDE.layerData, layersNotSaved: BATCH_SIDE.notSaved })
}

describe("a unit with side outputs run once per upstream item — both load-time lanes", () => {
  it("applyCompletedExecutionResults (a run that finished while the editor was closed)", () => {
    const [out] = applyCompletedExecutionResults(nodes(), { split: state } as never, null)
    expectRows(out!.data as Record<string, unknown>)
  })

  it("applyBackendExecutionState (a reload while the run is still active)", () => {
    const [out] = applyBackendExecutionState(nodes(), { split: state } as never)
    expectRows(out!.data as Record<string, unknown>)
  })
})
