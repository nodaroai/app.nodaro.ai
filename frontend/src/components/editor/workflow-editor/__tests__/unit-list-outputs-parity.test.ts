// @test-watches tools/units/__fixtures__/unit-list-outputs.json tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** frontend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
// The canvas run once per item (list-execution.ts) runs each item through the
// real executeNode, into the fixture unit's executor (its exec.ts: the unit
// kit's runProcessingNode on its job), whose poll the batch test answers with
// one finished job per item (`canvas.poll`). Every other poll is the real one.
const canvas = vi.hoisted(() => ({ poll: undefined as undefined | ((...args: unknown[]) => Promise<string>) }))
vi.mock("../poll-job", async (importOriginal) => {
  const real = await importOriginal<typeof import("../poll-job")>()
  return { ...real, pollJobWithNodeUpdate: (...args: Parameters<typeof real.pollJobWithNodeUpdate>) => (canvas.poll ? canvas.poll(...args) : real.pollJobWithNodeUpdate(...args)) }
})
vi.mock("@/nodes/_generated/executors", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/nodes/_generated/executors")>()
  const { readFileSync: read } = await import("node:fs")
  const { resolve } = await import("node:path")
  const unit = JSON.parse(read(resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-list-outputs.json"), "utf8")).unit
  // The fixture unit's exec.ts: its job for the picture the item hands it, landed beside the take.
  const executor = { execute: (_node: unknown, kit: import("@/nodes/exec-kit").UnitExecKit) => kit.runProcessingNode(async () => ({ jobId: `job:${kit.overrideMediaUrl}` }), "generatedImageUrl", unit.label) }
  return { ...real, UNIT_EXECUTORS: Object.assign(Object.create(null), real.UNIT_EXECUTORS, { [unit.type]: executor }) }
})
// How many items run at once: no lane read in this test.
vi.mock("../list-fan-out-width", async (importOriginal) => ({ ...(await importOriginal<typeof import("../list-fan-out-width")>()), listFanOutWidth: () => 4 }))

/**
 * A worker unit whose media take carries SIDE outputs — a list of images on
 * one pip and JSON beside the take (decided 2026-11-11) — on the canvas's
 * engine, over tools/units/__fixtures__/unit-list-outputs.json: the canvas
 * run's landing and the server-run lanes (`jobs`), what each pip hands on
 * (`pips`, `saved`), what an Each wire fans out over (`lists`), the mode an
 * edge has when none is set (`defaults`) and where each wire lands in a legacy
 * target (`routes`), and a run once per upstream item (`batches`: the
 * server-run lane over the fan-out output, the canvas run once per item, and
 * the node they leave). The server's half proves the same file on the backend
 * engine. The unit is the fixture's, added through the editor's one door to
 * the unit definitions; the list-pip table of @nodaro/shared is widened by the
 * same fixture (its generated rows hold no fixture unit).
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { readFileSync: read } = await import("node:fs")
  const { resolve } = await import("node:path")
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { definition } = await import("../../../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
  const unit = JSON.parse(read(resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-list-outputs.json"), "utf8")).unit
  const layers = {
    ...definition,
    type: unit.type,
    label: unit.label,
    picker: null,
    priceRows: {},
    inputs: [],
    outputs: unit.outputs.map((o: { id: string }) => o.id),
    handles: { inputs: [], outputs: unit.outputs },
    producer: unit.contract.producer,
  }
  const units = [...real.UNIT_NODE_DEFINITIONS, layers as unknown as (typeof real.UNIT_NODE_DEFINITIONS)[number]]
  const unitDefinitionOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DEFINITIONS: units,
    unitDefinitionOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDefinitionOf(t), h),
  }
})
vi.mock("@nodaro/shared/nodes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@nodaro/shared/nodes")>()
  const { readFileSync: read } = await import("node:fs")
  const { resolve } = await import("node:path")
  const unit = JSON.parse(read(resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-list-outputs.json"), "utf8")).unit
  const pips: string[] = unit.outputs.filter((o: { list?: boolean }) => o.list === true).map((o: { id: string }) => o.id)
  const LIST_OUTPUT_HANDLES: Readonly<Record<string, readonly string[]>> = { ...real.LIST_OUTPUT_HANDLES, [unit.type]: pips }
  const isListOutputHandle = (t: string | null | undefined, h: string | null | undefined) =>
    typeof t === "string" && typeof h === "string" && Object.hasOwn(LIST_OUTPUT_HANDLES, t) && LIST_OUTPUT_HANDLES[t]!.includes(h)
  return {
    ...real,
    LIST_OUTPUT_HANDLES,
    isListOutputHandle,
    defaultEdgeOutputMode: (t: string | null | undefined, h?: string | null) => (isListOutputHandle(t, h) ? "each" : real.defaultEdgeOutputMode(t, h)),
  }
})

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { classifyPreviewValue } from "@/hooks/use-workflow-store"
import { createUnitExecKit } from "../unit-exec-kit"
import { applyRestoredJobCompletion, paintRunStates } from "../run-handlers"
import { detectPreviewItemType, extractNodeOutput } from "../execution-graph"
import { executeNode } from "../execute-node"
import { executeNodeForList } from "../list-execution"
import { getFanOutMultiplier } from "../types"
import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs, type FrontendResolvedInputs } from "../node-input-resolver"
import { isJsonRunResultType, unitBatchClearFields, unitSideJobFields, unitSideRunFields } from "@/lib/json-run-result"
import { UNIT_BATCH_FIELDS, unitPipJson, unitPipList } from "@/lib/unit-compose"
import { unitDefinitionOf } from "@/lib/unit-definitions"
import { IMAGE_SOURCE_TYPES } from "@/lib/preview-node-types"
import { IMAGE_RESULT_TYPES, resultsGalleryDeclaresMedium, resultsGalleryMediaType } from "@/components/editor/config-panels/results-gallery-media"

type Json = Record<string, unknown>
interface JobCase {
  readonly name: string
  readonly outputData: Json
  readonly nodeOutput: Json
  readonly pips: Readonly<Record<string, string | null>>
  readonly landing: Json
  readonly cleared: readonly string[]
}
interface SavedCase {
  readonly name: string
  readonly data: Json
  readonly pips: Readonly<Record<string, string | null>>
  readonly lists: Readonly<Record<string, readonly string[] | null>>
  readonly collected?: Readonly<Record<string, readonly string[]>>
}
interface RouteCase {
  readonly name: string
  readonly pip: string | null
  readonly mode?: string
  readonly iteration?: number
  readonly target: string
  readonly targetHandle: string
  readonly asUploads: readonly string[]
  /** What an Each wire (`iteration`) fans out over: the source's layers when absent. */
  readonly fanOut?: readonly string[]
}
interface BundleBranchCase {
  readonly name: string
  readonly pip: string
  readonly mode: string
  readonly target: string
  readonly targetData?: Json
  readonly targetHandle: string
  readonly inputs: Json
}
/** A node holding a batch (or after one) with a take made active: what each pip hands on, and what the node shows. */
interface BatchState {
  readonly name: string
  readonly activeResultIndex: number
  readonly pips: Readonly<Record<string, string | null>>
  readonly lists: Readonly<Record<string, readonly string[] | null>>
  readonly collected: Readonly<Record<string, readonly string[]>>
  /** What the node shows beside its active take (`read: "take"`): its own row's. */
  readonly shown: { readonly layers: readonly string[]; readonly layerData: unknown }
  readonly routes?: ReadonlyArray<RouteCase>
}
/** A run once per upstream item: its items, each row's job (or its failure), the server's fan-out output, the node every lane leaves, and a single run after it. */
interface BatchCase {
  readonly name: string
  readonly items: readonly string[]
  readonly rows: ReadonlyArray<{ readonly outputData: Json } | { readonly failed: string }>
  readonly nodeOutput: Json
  readonly data: Json
  readonly states: readonly [BatchState, ...BatchState[]]
  readonly rerun?: {
    readonly name: string
    readonly outputData: Json
    readonly nodeOutput: Json
    readonly data: Json
    readonly states: readonly [BatchState, ...BatchState[]]
    readonly staleFields: Json
  }
}
const FIXTURE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-list-outputs.json"), "utf8")) as {
  readonly unit: { readonly type: string; readonly outputs: ReadonlyArray<{ readonly id: string; readonly from: string; readonly kind: string; readonly list?: boolean }> }
  readonly jobs: ReadonlyArray<JobCase>
  readonly saved: ReadonlyArray<SavedCase>
  readonly batches: ReadonlyArray<BatchCase>
  readonly defaults: Readonly<Record<string, string>>
  readonly routes: { readonly data: Json; readonly cases: ReadonlyArray<RouteCase>; readonly bundleBranches: ReadonlyArray<BundleBranchCase> }
}
const TYPE = FIXTURE.unit.type
// A list output also lands `<id>NotSaved`: how many items its run could not store.
const SIDE_FIELDS = FIXTURE.unit.outputs.flatMap((o) => (o.list === true ? [o.from, `${o.id}NotSaved`] : o.kind === "look" ? [o.from] : []))
const pipOf = (key: string): string | undefined => (key === "" ? undefined : key)

/** The side fields of `patch` are the case's landing, and each `cleared` field is written as null (it survives a save). */
function expectSide(patch: Json | undefined, c: JobCase, where: string) {
  expect(patch, where).toBeDefined()
  const side = Object.fromEntries(SIDE_FIELDS.filter((f) => Object.hasOwn(patch!, f) && patch![f] !== undefined && patch![f] !== null).map((f) => [f, patch![f]]))
  expect(side, where).toEqual(c.landing)
  for (const f of c.cleared) expect(Object.hasOwn(patch!, f) && patch![f] === null, `${where}: ${f} cleared`).toBe(true)
}

const node = (id: string, type: string, data: Json): WorkflowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const stored = (id: string): Json => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Json
/** Earlier side outputs the lanes must replace or empty — never leave beside the new take. */
const STALE = { generatedLayerUrls: ["https://r2/stale.png"], generatedLayerData: [{ stale: true }] }
/** An earlier run once per upstream item's batch, which a single run's landing ends (unitBatchClearFields) — every batch field. */
const STALE_BATCH = {
  __listResults: ["https://r2/stale-0.png", "https://r2/stale-1.png"], __alignedListResults: ["a", "b"], __listResultStamps: [{}, {}], __listResultMeta: [null, null],
  __listInputs: ["x", "y"], __listTotal: 2, __listCompleted: 2,
}
/** Every batch field a single run's landing leaves: none. */
const expectBatchEnded = (data: Json, where: string) => {
  for (const f of UNIT_BATCH_FIELDS) expect(data[f], `${where}: ${f}`).toBeUndefined()
}
/** The run context the canvas's executors take (a list operator runs inline: none of it is called). */
const RUN_CTX = {
  userId: "u1", projectId: "p1", trackInterval: (i: unknown) => i, untrackInterval: vi.fn(), save: vi.fn(), setIsRunning: vi.fn(),
  isWorkflowStale: () => false, isStorageError: () => false, setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(), setShowInsufficientCredits: vi.fn(),
} as never

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("a unit with side outputs takes the media lanes, not the JSON-only mapping", () => {
  it("is no JSON run result type, and its type is an image source and an image result", () => {
    expect(isJsonRunResultType(TYPE)).toBe(false)
    expect(IMAGE_SOURCE_TYPES.has(TYPE)).toBe(true)
    expect(IMAGE_RESULT_TYPES.has(TYPE)).toBe(true)
    expect(resultsGalleryDeclaresMedium(TYPE)).toBe(true)
    expect(resultsGalleryMediaType(TYPE, {})).toBe("image")
  })
})

describe("jobs — every editor lane lands the same side fields", () => {
  for (const c of FIXTURE.jobs) {
    it(`${c.name}: the canvas run (runProcessingNode) empties them at its start and lands them beside the take`, async () => {
      const poll = vi.fn(async () => "https://r2/base.png")
      const updateNodeData = vi.fn()
      const ctx = { userId: "u1" } as never
      const kit = createUnitExecKit({
        node: node("L", TYPE, {}), ctx, inputs: {} as never, overrideMediaUrl: undefined,
        poll, pollJson: vi.fn(), setUserPromptTemplate: vi.fn(), getNodeData: () => undefined, updateNodeData,
      })
      const start = async () => ({ jobId: "j1" })
      await kit.runProcessingNode(start, "generatedImageUrl", "Fixture Layers")
      expect(updateNodeData).toHaveBeenCalledWith("L", Object.fromEntries(SIDE_FIELDS.map((f) => [f, undefined])))
      // The batch clear is no write of its own: it rides on the poll as node-only
      // fields of the take's own landing, and it is empty when no batch field is set.
      expect(updateNodeData).toHaveBeenCalledTimes(1)
      const nodeFields = (poll.mock.calls[0] as unknown as unknown[])[6] as (od: Json) => Json
      expect(nodeFields(c.outputData)).toEqual({})
      const call = poll.mock.calls[0] as unknown as [string, unknown, unknown, string, unknown, (od: Json) => Json]
      expect(call.slice(0, 5)).toEqual(["L", start, "generatedImageUrl", "Fixture Layers", ctx])
      expectSide(call[5](c.outputData), c, "extraOutputFields")
    })

    it(`${c.name}: the server-run lanes (node output) and the job restores (job row) land the same`, () => {
      expectSide(unitSideRunFields(TYPE, c.nodeOutput), c, "node output")
      expectSide(unitSideJobFields(TYPE, c.outputData), c, "job row")
    })

    it(`${c.name}: the live server run paints them on the node and on the take; each pip hands on its value`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { executionStatus: "running", ...STALE, ...STALE_BATCH })], edges: [] }))
      act(() => paintRunStates({ L: { status: "completed", startedAt: "2026-11-11T10:00:00.000Z", completedAt: "2026-11-11T10:01:00.000Z", jobId: "j1", output: c.nodeOutput } } as never))
      const data = stored("L")
      expect(data.generatedImageUrl).toBe(c.nodeOutput.imageUrl)
      expectSide(data, c, "node")
      expectBatchEnded(data, "node")
      const take = (data.generatedResults as Json[])[0]!
      expect(take.url).toBe(c.nodeOutput.imageUrl)
      expectSide(take, c, "take")
      for (const [pip, value] of Object.entries(c.pips)) {
        expect(extractNodeOutput(node("L", TYPE, data), pipOf(pip)), `pip "${pip}"`).toBe(value ?? undefined)
      }
    })

    it(`${c.name}: a restored poll lands them on the node and on the take; each pip hands on its value`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { executionStatus: "running", currentJobId: "j1", ...STALE, ...STALE_BATCH })], edges: [] }))
      act(() => applyRestoredJobCompletion("L", TYPE, { output_data: c.outputData }, "j1"))
      const data = stored("L")
      expect(data.generatedImageUrl).toBe(c.outputData.imageUrl)
      expectSide(data, c, "node")
      expectBatchEnded(data, "node")
      expectSide((data.generatedResults as Json[])[0], c, "take")
      for (const f of UNIT_BATCH_FIELDS) expect(Object.hasOwn((data.generatedResults as Json[])[0]!, f), `take: ${f}`).toBe(false)
      for (const [pip, value] of Object.entries(c.pips)) {
        expect(extractNodeOutput(node("L", TYPE, data), pipOf(pip)), `pip "${pip}"`).toBe(value ?? undefined)
      }
    })
  }
})

/** Each pip's plain value and what an Each wire from it fans out over, off a node's data. */
function expectPipsAndLists(data: Json, pips: SavedCase["pips"], lists: SavedCase["lists"], where = ""): void {
  const n = node("L", TYPE, data)
  for (const [pip, value] of Object.entries(pips)) {
    expect(extractNodeOutput(n, pipOf(pip)), `${where}pip "${pip}"`).toBe(value ?? undefined)
  }
  for (const [pip, items] of Object.entries(lists)) {
    expect(extractNodeOutputAsList(n, pipOf(pip)), `${where}list "${pip}"`).toEqual(items ?? undefined)
  }
}

/** The canvas's own Filter List executor (its upstream collector), per pip, off a node's data. */
async function expectCollected(data: Json, collected: Readonly<Record<string, readonly string[]>>): Promise<void> {
  for (const [pip, items] of Object.entries(collected)) {
    const op = node("F", "filter-list", { conditions: [] })
    const edges = [{ id: "e", source: "L", target: "F", ...(pip === "" ? {} : { sourceHandle: pip }), targetHandle: "in" }] as unknown as WorkflowEdge[]
    act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, data), op], edges }))
    await executeNode(op, RUN_CTX)
    expect(stored("F").listResults, `pip "${pip}"`).toEqual(items)
  }
}

describe("saved — a node's data: each pip, and what an Each wire fans out over", () => {
  for (const c of FIXTURE.saved) {
    it(c.name, () => expectPipsAndLists(c.data, c.pips, c.lists))
    const collected = c.collected
    if (collected) {
      it(`${c.name}: what a list operator (filter-list) collects from each pip`, () => expectCollected(c.data, collected))
    }
  }
})

/** The side fields and `__listResults` a lane lands on the node, and each take's side fields by its URL — the batch's `data`. */
/**
 * The side fields a lane lands on the node, `batchFields` beside them, and
 * each take's side fields by its URL — `want`'s. A batch lane is held on its
 * take pip's list; a single run's on every batch field (all gone).
 */
function expectLanded(data: Json, want: Json, where: string, batchFields: readonly string[] = ["__listResults"]): void {
  const nodeSide = (d: Json) => Object.fromEntries([...SIDE_FIELDS, ...batchFields].map((f) => [f, d[f] ?? null]))
  expect(nodeSide(data), `${where}: the node`).toEqual(nodeSide(want))
  const takes = (d: Json) => Object.fromEntries(((d.generatedResults ?? []) as Json[]).map((t) => [t.url, Object.fromEntries(SIDE_FIELDS.map((f) => [f, t[f] ?? null]))]))
  expect(takes(data), `${where}: each take`).toEqual(takes(want))
  expect(data.activeResultIndex ?? 0, `${where}: the active take`).toBe(0)
}

/** What the node shows beside its active take: that take's own row's layers and layer data, never the batch's. */
function expectShown(data: Json, shown: BatchState["shown"]): void {
  const unit = unitDefinitionOf(TYPE)!
  expect(unitPipList(unit, data, "layers", "take")?.items).toEqual(shown.layers)
  expect(unitPipJson(unit, data, "layerData", "take")?.value).toEqual(shown.layerData)
}

/** Every read of a node holding `data` with `s`'s take made active: each pip, each Each wire, what the node shows, each list operator, each route. */
function expectState(c: { readonly name: string }, data: Json, s: BatchState, label = ""): void {
  const picked = { ...data, activeResultIndex: s.activeResultIndex }
  const at = `${c.name}, ${s.name}${label}`
  it(`${at}: each pip, what an Each wire fans out over, and what the node shows`, () => {
    expectPipsAndLists(picked, s.pips, s.lists)
    expectShown(picked, s.shown)
  })
  it(`${at}: what a list operator collects`, () => expectCollected(picked, s.collected))
  for (const r of s.routes ?? []) it(`${at}: ${r.name}`, () => expectRoute(picked, r))
}

/** A job that never lands a take: a Discard or a Run-instead abandons it, or the run's signal aborts it — the poll resolves "" (poll-job.ts). */
const ABANDONED = Symbol("abandoned")

/**
 * The canvas's poll for a run of the fixture unit (pollJobWithNodeUpdate's
 * arguments, as runProcessingNode passes them): lands `outputData` as poll-job
 * lands a finished job (handleJobCompleted) — in ONE write, the take, the side
 * fields on the node and on the take (`extraOutputFields`), and the node-only
 * fields (`opts.nodeFields`). A failed job rejects; an abandoned one lands
 * nothing and resolves "".
 */
function landedPoll(outputOf: (jobId: string) => Json | Error | typeof ABANDONED) {
  return async (...args: unknown[]) => {
    const [nodeId, start, outputKey, , , extra, , opts] = args as [string, () => Promise<{ jobId: string }>, string, string, unknown, ((od: Json) => Json) | undefined, unknown, { nodeFields?: (od: Json) => Json } | undefined]
    const { jobId } = await start()
    const outputData = outputOf(jobId)
    if (outputData === ABANDONED) return ""
    if (outputData instanceof Error) throw outputData
    const fields = extra?.(outputData) ?? {}
    const nodeOnly = opts?.nodeFields?.(outputData) ?? {}
    const url = outputData.imageUrl as string
    const prev = (stored(nodeId).generatedResults as Json[] | undefined) ?? []
    useWorkflowStore.getState().updateNodeData(nodeId, {
      executionStatus: "completed", [outputKey]: url, activeResultIndex: 0, ...fields, ...nodeOnly,
      generatedResults: [{ url, jobId, timestamp: "2026-11-11T10:00:00.000Z", ...fields }, ...prev],
    })
    return url
  }
}

/**
 * What the run estimate counts for an Each wire from the Layers pip into an
 * Upscale, the source not re-run. The estimate reads the generated list-output
 * table (@nodaro/render-rules UNIT_LIST_OUTPUTS), which holds the real units
 * only, so the node is read as the real unit whose list output this fixture
 * mirrors — the same pip and field names (`layers`, `generatedLayerUrls`).
 */
function layersEstimate(data: Json): number {
  const src = node("L", "split-into-layers", data)
  const up = node("U", "upscale-image", {})
  const edge = { id: "e", source: "L", target: "U", sourceHandle: "layers", targetHandle: "image" } as unknown as WorkflowEdge
  return getFanOutMultiplier(up, [src, up], [edge], new Set(["U"]))
}

describe("batches — a run once per upstream item: every lane lands the same node; a plain wire reads the active take, a list every row's", () => {
  for (const c of FIXTURE.batches) {
    const [first] = c.states
    it(`${c.name}: the server-run lane (its fan-out output) lands the node and each row's take`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { executionStatus: "running", ...STALE })], edges: [] }))
      act(() => paintRunStates({ L: { status: "completed", startedAt: "2026-11-11T10:00:00.000Z", completedAt: "2026-11-11T10:01:00.000Z", jobId: "j2", output: c.nodeOutput } } as never))
      expectLanded(stored("L"), c.data, "server run")
      expectPipsAndLists(stored("L"), first.pips, first.lists, "server run: ")
      expectShown(stored("L"), first.shown)
    })

    it(`${c.name}: the canvas run once per item (executeNodeForList) lands the same node`, async () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { ...STALE })], edges: [] }))
      // One finished job per item: the real executeNode runs the unit's own run
      // (runProcessingNode, which empties the side fields at its start). A failed
      // row's job fails (the batch completes with the others).
      canvas.poll = landedPoll((jobId) => {
        const r = c.rows[c.items.indexOf(jobId.slice("job:".length))]!
        return "failed" in r ? new Error(r.failed) : r.outputData
      })
      try {
        await executeNodeForList(node("L", TYPE, {}), [...c.items], RUN_CTX)
      } finally {
        canvas.poll = undefined
      }
      const failed = c.rows.filter((r) => "failed" in r).length
      if (failed === 0) expect(stored("L").errorMessage, "every item ran").toBeUndefined()
      else expect(stored("L").errorMessage, "the failed items are named").toMatch(new RegExp(`^${c.items.length - failed}/${c.items.length} succeeded, ${failed} failed`))
      const landedData = stored("L")
      expectLanded(landedData, c.data, "canvas run")
      // Each layer-data entry's row is its picture's place among the items, and
      // its baseUrl that picture's own base (a failed picture's row has none).
      const takes = landedData.__listResults as string[]
      for (const e of landedData.generatedLayerData as Array<{ row: number; baseUrl?: string }>) {
        expect(takes[e.row], `row ${e.row} made a take`).toBeTruthy()
        expect(e.baseUrl, `row ${e.row}`).toBe(takes[e.row])
      }
      expectPipsAndLists(landedData, first.pips, first.lists, "canvas run: ")
      expectShown(landedData, first.shown)
    })

    for (const s of c.states) expectState(c, c.data, s)

    // A single run after the batch: every lane ends the batch.
    const rerun = c.rerun
    if (!rerun) continue
    const [now] = rerun.states
    it(`${c.name}, ${rerun.name}: the canvas run (one item, no list) lands its take and ends the batch`, async () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, c.data)], edges: [] }))
      canvas.poll = landedPoll(() => rerun.outputData)
      try {
        await executeNode(node("L", TYPE, c.data), RUN_CTX, undefined, "https://r2/in-q.png")
      } finally {
        canvas.poll = undefined
      }
      expectLanded(stored("L"), rerun.data, "canvas run", UNIT_BATCH_FIELDS)
      expectPipsAndLists(stored("L"), now.pips, now.lists, "canvas run: ")
    })
    // A run that lands no take keeps the batch whole: its take batch, every
    // row's Layers and Layer data on the node's own fields, what each wire
    // reads and what the estimate counts.
    for (const [how, outcome] of [["fails", new Error("provider down")], ["is discarded (its poll lands nothing)", ABANDONED]] as const) {
      it(`${c.name}, ${rerun.name}: a canvas run that ${how} keeps the batch`, async () => {
        act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, c.data)], edges: [] }))
        canvas.poll = landedPoll(() => outcome)
        try {
          const run = executeNode(node("L", TYPE, c.data), RUN_CTX, undefined, "https://r2/in-q.png")
          if (outcome instanceof Error) await expect(run).rejects.toThrow(outcome.message)
          else expect(await run).toBe("")
        } finally {
          canvas.poll = undefined
        }
        const data = stored("L")
        for (const f of [...SIDE_FIELDS, ...UNIT_BATCH_FIELDS]) expect(data[f], f).toEqual(c.data[f])
        expectPipsAndLists(data, first.pips, first.lists, `after a run that ${how}: `)
        expect(layersEstimate(data)).toBe((c.data.generatedLayerUrls as string[]).length)
      })
    }

    // Undo: a single canvas run never writes an invisible step. The batch fields
    // change only in the write that lands the take; with no batch, never.
    for (const [held, start] of [["holding the batch", c.data], ["holding no batch", rerun.data]] as const) {
      it(`${c.name}, ${rerun.name}: a canvas run on a node ${held} changes the batch fields only with its take`, async () => {
        act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, start)], edges: [] }))
        const writes: Array<{ readonly batch: boolean; readonly take: boolean }> = []
        const unsubscribe = useWorkflowStore.subscribe((next, prev) => {
          const a = prev.nodes.find((n) => n.id === "L")?.data as Json | undefined
          const b = next.nodes.find((n) => n.id === "L")?.data as Json | undefined
          if (!a || !b || a === b) return
          writes.push({ batch: UNIT_BATCH_FIELDS.some((f) => a[f] !== b[f]), take: a.generatedResults !== b.generatedResults })
        })
        canvas.poll = landedPoll(() => rerun.outputData)
        try {
          await executeNode(node("L", TYPE, start), RUN_CTX, undefined, "https://r2/in-q.png")
        } finally {
          canvas.poll = undefined
          unsubscribe()
        }
        expect(writes.filter((w) => w.batch && !w.take), "a write that changes only invisible batch fields").toEqual([])
        expect(writes.some((w) => w.batch)).toBe(held === "holding the batch")
        for (const f of UNIT_BATCH_FIELDS) expect(stored("L")[f], f).toBeUndefined()
      })
    }
    it(`${c.name}, ${rerun.name}: the live server run lands its take and ends the batch`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { ...c.data, executionStatus: "running" })], edges: [] }))
      act(() => paintRunStates({ L: { status: "completed", startedAt: "2026-11-12T10:00:00.000Z", completedAt: "2026-11-12T10:01:00.000Z", jobId: "jq", output: rerun.nodeOutput } } as never))
      expectLanded(stored("L"), rerun.data, "server run", UNIT_BATCH_FIELDS)
    })
    it(`${c.name}, ${rerun.name}: a restored poll lands its take and ends the batch`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { ...c.data, executionStatus: "running", currentJobId: "jq" })], edges: [] }))
      act(() => applyRestoredJobCompletion("L", TYPE, { output_data: rerun.outputData }, "jq"))
      expectLanded(stored("L"), rerun.data, "restored poll", UNIT_BATCH_FIELDS)
    })
    it(`${c.name}, ${rerun.name}: the batch-clear patch of every lane — a single run's output and a job row clear the batch; a batch's output clears nothing`, () => {
      // Every batch field, as a key holding undefined (a toEqual would pass an empty patch).
      for (const patch of [unitBatchClearFields(TYPE, rerun.nodeOutput), unitBatchClearFields(TYPE, rerun.outputData)]) {
        expect(Object.keys(patch ?? {}).sort()).toEqual([...UNIT_BATCH_FIELDS].sort())
        expect(Object.values(patch ?? {}).every((v) => v === undefined)).toBe(true)
      }
      expect(unitBatchClearFields(TYPE, c.nodeOutput)).toBeUndefined()
      expect(unitBatchClearFields("upscale-image", rerun.nodeOutput)).toBeUndefined()
    })
    for (const s of rerun.states) {
      expectState(c, rerun.data, s, ` (${rerun.name})`)
      // A node an editor before this rule saved with the batch fields still beside it reads alike.
      expectState(c, { ...rerun.data, ...rerun.staleFields }, s, ` (${rerun.name}, saved with the old batch fields)`)
    }
  }
})

/**
 * Extract Field wired from Layer data reads it as a plain wire does — the
 * picked take's own JSON — and stops there: a take that holds none extracts
 * nothing, never the pip's list of every picture's entries. The server's half
 * asserts the same off the same node.
 */
describe("Extract Field from a look pip whose picked take holds none", () => {
  const [batch] = FIXTURE.batches
  const takes = (batch.data.generatedResults as Json[]).map((t, i) => (i === 1 ? { ...t, generatedLayerData: null } : t))
  const run = async (data: Json, field: string) => {
    const ef = node("E", "extract-field", { field, outputType: "text" })
    const edges = [{ id: "e", source: "L", target: "E", sourceHandle: "layerData", targetHandle: "in" }] as unknown as WorkflowEdge[]
    act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, data), ef], edges }))
    await executeNode(ef, RUN_CTX)
    return stored("E").extractedText
  }
  it("extracts nothing", async () => {
    expect(await run({ ...batch.data, generatedResults: takes, activeResultIndex: 1 }, "")).toBe("")
  })
  it("…while the picked take that holds entries extracts them", async () => {
    expect(await run({ ...batch.data, activeResultIndex: 2 }, "name")).toBe("Owl\nMoon\nCaption")
  })
})

describe("defaults — an edge with no mode: an Each wire on the list pip only", () => {
  for (const [pip, mode] of Object.entries(FIXTURE.defaults)) {
    it(`pip "${pip}" → ${mode}`, () => {
      const src = node("L", TYPE, FIXTURE.routes.data)
      const target = node("T", "upscale-image", {})
      const edge = { id: "e", source: "L", target: "T", sourceHandle: pipOf(pip), targetHandle: "image" } as unknown as WorkflowEdge
      const fanOut = getListFanOutForNode(target, [src, target], [edge])
      if (mode === "each") expect(fanOut?.items).toEqual(FIXTURE.routes.data.generatedLayerUrls)
      else expect(fanOut).toBeUndefined()
    })
  }
})

/** The inputs with each `*WithSourceIds` row's node id dropped (asserted on its own). */
function routed(inputs: FrontendResolvedInputs): Json {
  const out: Json = { ...inputs }
  for (const k of ["imageUrlsWithSourceIds", "videoUrlsWithSourceIds", "audioUrlsWithSourceIds"] as const) {
    const rows = inputs[k]
    if (rows) out[k] = rows.map((r) => r.url)
  }
  return out
}

/** A wire from a node holding `data` into a legacy target lands exactly what Upload Image wires holding `asUploads` land there, in order. */
function expectRoute(data: Json, c: RouteCase): void {
  const target = node("T", c.target, {})
  const src = node("L", TYPE, data)
  const edge = {
    id: "e", source: "L", target: "T", ...(c.pip === null ? {} : { sourceHandle: c.pip }), targetHandle: c.targetHandle,
    ...(c.mode ? { data: { outputMode: c.mode } } : {}),
  } as unknown as WorkflowEdge
  if (c.iteration !== undefined) {
    expect(getListFanOutForNode(target, [src, target], [edge])?.items).toEqual(c.fanOut ?? data.generatedLayerUrls)
  }
  const got = resolveNodeInputs(target, [src, target], [edge], c.iteration)

  const uploads = c.asUploads.map((url, i) => node(`U${i}`, "upload-image", { url }))
  const uploadEdges = uploads.map((u, i) => ({ id: `u${i}`, source: u.id, target: "T", targetHandle: c.targetHandle }) as unknown as WorkflowEdge)
  const want = resolveNodeInputs(target, [...uploads, target], uploadEdges)

  // The Upload Image wires land every image (the comparison is never of two empty results).
  for (const url of c.asUploads) expect(JSON.stringify(want)).toContain(url)
  expect(routed(got)).toEqual(routed(want))
  // Every row a wire from the unit adds names the unit.
  for (const k of ["imageUrlsWithSourceIds", "videoUrlsWithSourceIds", "audioUrlsWithSourceIds"] as const) {
    for (const r of got[k] ?? []) expect(r.nodeId).toBe("L")
  }
}

describe("routes — a wire lands exactly what Upload Image wires holding the same images land", () => {
  for (const c of FIXTURE.routes.cases) {
    it(c.name, () => expectRoute(FIXTURE.routes.data, c))
  }
})

describe("routes — a Bundle into a target with its own Bundle branch lands exactly its inputs", () => {
  for (const c of FIXTURE.routes.bundleBranches) {
    it(c.name, () => {
      const target = node("T", c.target, c.targetData ?? {})
      const src = node("L", TYPE, FIXTURE.routes.data)
      const edge = { id: "e", source: "L", target: "T", sourceHandle: c.pip, targetHandle: c.targetHandle, data: { outputMode: c.mode } } as unknown as WorkflowEdge
      expect(resolveNodeInputs(target, [src, target], [edge])).toEqual(c.inputs)
    })
  }
})

describe("a JSON output beside the take keeps its own lane", () => {
  it("into Generate Text: never among the reference images; the image pip is one", () => {
    const src = node("L", TYPE, FIXTURE.routes.data)
    const target = node("T", "llm-chat", {})
    const json = resolveNodeInputs(target, [src, target], [{ id: "e", source: "L", target: "T", sourceHandle: "layerData", targetHandle: "in" } as unknown as WorkflowEdge])
    expect(json.referenceImageUrls).toBeUndefined()
    const image = resolveNodeInputs(target, [src, target], [{ id: "e", source: "L", target: "T", sourceHandle: "base", targetHandle: "in" } as unknown as WorkflowEdge])
    expect(image.referenceImageUrls).toEqual([FIXTURE.routes.data.generatedImageUrl])
  })
  it("a Preview types it as data (its JSON names images), the image pips as images", () => {
    const json = extractNodeOutput(node("L", TYPE, FIXTURE.routes.data), "layerData")!
    expect(detectPreviewItemType(TYPE, json, "layerData")).toBe("data")
    expect(classifyPreviewValue(TYPE, '[{"url":"https://r2/l1.png"}]', "layerData")).toBe("data")
    expect(detectPreviewItemType(TYPE, "https://r2/base.png", "base")).toBe("image")
    expect(detectPreviewItemType(TYPE, "https://r2/l1.png", "layers")).toBe("image")
  })
})
