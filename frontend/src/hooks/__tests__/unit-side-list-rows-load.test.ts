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

import { applyBackendExecutionState, applyCompletedExecutionResults, syncNodeResultsFromDB } from "../use-workflow-persistence"
import { buildCompletedResultPatch } from "@/lib/reconcile-completed-jobs"
import { getBatchJobStatus } from "@/lib/api"
import { BATCH_SIDE, FANNED_OUT_OUTPUT, FIXTURE_LAYERS_UNIT, ROW_A, ROW_B } from "@/components/editor/workflow-editor/__tests__/unit-side-list-rows.fixture"
import { UNIT_BATCH_FIELDS } from "@/lib/unit-compose"

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

/**
 * A single run that lands after the batch (decided 2026-11-12) ends it on both
 * load-time lanes: every batch field emptied on the node (never on a take), and
 * the single run's take first, carrying its own side outputs.
 */
describe("a single run after a run once per upstream item — both load-time lanes end the batch", () => {
  const Q = "https://r2/q-base.png"
  const single = { imageUrl: Q, unitLists: { layers: ["https://r2/q-l1.png"] }, unitOutputs: { layerData: '[{"name":"Cat","zIndex":1}]' }, unitListsNotSaved: { layers: 0 } }
  const batchHolding = (extra: Record<string, unknown>) =>
    [{
      id: "split", type: FIXTURE_LAYERS_UNIT.type, position: { x: 0, y: 0 },
      data: {
        label: "Fixture Layers", __listResults: [ROW_A.url, ROW_B.url], __listTotal: 2, __listCompleted: 2, __listInputs: ["a", "b"],
        generatedResults: [{ url: ROW_A.url, jobId: "job-a" }, { url: ROW_B.url, jobId: "job-b" }], ...extra,
      },
    }] as unknown as Parameters<typeof applyCompletedExecutionResults>[0]
  const singleState = { status: "completed" as const, startedAt: "2026-11-12T10:00:00.000Z", jobId: "job-q", output: single }

  function expectEnded(data: Record<string, unknown>) {
    for (const f of UNIT_BATCH_FIELDS) expect(data[f], f).toBeUndefined()
    expect(data).toMatchObject({ generatedLayerUrls: ["https://r2/q-l1.png"], generatedLayerData: [{ name: "Cat", zIndex: 1 }], layersNotSaved: 0 })
    const takes = data.generatedResults as Array<Record<string, unknown>>
    expect(takes[0]).toMatchObject({ url: Q, generatedLayerUrls: ["https://r2/q-l1.png"] })
    for (const f of UNIT_BATCH_FIELDS) expect(Object.hasOwn(takes[0]!, f), `take: ${f}`).toBe(false)
  }

  it("applyBackendExecutionState (a reload while the run is still active)", () => {
    const [out] = applyBackendExecutionState(batchHolding({ generatedImageUrl: ROW_A.url }), { split: singleState } as never)
    expectEnded(out!.data as Record<string, unknown>)
  })

  it("applyCompletedExecutionResults (a run that finished while the editor was closed, on a node it lands on)", () => {
    const [out] = applyCompletedExecutionResults(batchHolding({ executionStatus: "running" }), { split: singleState } as never, null)
    expectEnded(out!.data as Record<string, unknown>)
  })
})

/**
 * The two job lanes a reload lands a single run's job by (decided 2026-11-12):
 * the persisted-run-state sync of a node still running (syncNodeResultsFromDB)
 * and the recovery of a single-node job that ended while the editor was closed
 * (buildCompletedResultPatch) — each ends the batch, on the node only.
 */
describe("a single run's job after a run once per upstream item — both job lanes end the batch", () => {
  const JOB = "11111111-1111-4111-8111-111111111111"
  const Q = "https://r2/q-base.png"
  const outputData = { imageUrl: Q, layers: ["https://r2/q-l1.png"], layerData: [{ name: "Cat", zIndex: 1 }], layersNotSaved: 0 }
  const batchFields = { __listResults: [ROW_A.url, ROW_B.url], __listTotal: 2, __listCompleted: 2, __listInputs: ["a", "b"] }

  it("syncNodeResultsFromDB (a node a reload finds running, its job done)", async () => {
    vi.mocked(getBatchJobStatus).mockResolvedValueOnce([{ id: JOB, status: "completed", output_data: outputData }] as never)
    const nodes = [{
      id: "split", type: FIXTURE_LAYERS_UNIT.type, position: { x: 0, y: 0 },
      data: { label: "Fixture Layers", executionStatus: "running", currentJobId: JOB, ...batchFields, generatedResults: [{ url: ROW_A.url, jobId: "job-a" }, { url: ROW_B.url, jobId: "job-b" }] },
    }] as unknown as Parameters<typeof syncNodeResultsFromDB>[0]
    const { nodes: [out] } = await syncNodeResultsFromDB(nodes)
    const data = out!.data as Record<string, unknown>
    for (const f of UNIT_BATCH_FIELDS) expect(data[f], f).toBeUndefined()
    expect(data).toMatchObject({ generatedLayerUrls: ["https://r2/q-l1.png"], generatedLayerData: [{ name: "Cat", zIndex: 1 }], layersNotSaved: 0 })
    const take = (data.generatedResults as Array<Record<string, unknown>>)[0]!
    expect(take).toMatchObject({ url: Q, jobId: JOB, generatedLayerUrls: ["https://r2/q-l1.png"] })
    for (const f of UNIT_BATCH_FIELDS) expect(Object.hasOwn(take, f), `take: ${f}`).toBe(false)
  })

  it("buildCompletedResultPatch (a single-node job that ended while the editor was closed)", () => {
    const patch = buildCompletedResultPatch(FIXTURE_LAYERS_UNIT.type, outputData, JOB, "2026-11-12T10:00:00.000Z", { ...batchFields })!
    expect(patch).not.toBeNull()
    for (const f of UNIT_BATCH_FIELDS) {
      expect(Object.hasOwn(patch, f), f).toBe(true)
      expect(patch[f], f).toBeUndefined()
    }
    expect(patch).toMatchObject({ generatedLayerUrls: ["https://r2/q-l1.png"], generatedImageUrl: Q })
    for (const f of UNIT_BATCH_FIELDS) expect(Object.hasOwn((patch.generatedResults as Array<Record<string, unknown>>)[0]!, f), `take: ${f}`).toBe(false)
  })
})
