// @test-watches tools/units/__fixtures__/unit-list-outputs.json tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** frontend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

/**
 * A worker unit whose media take carries SIDE outputs — a list of images on
 * one pip and JSON beside the take (decided 2026-11-11) — on the canvas's
 * engine, over tools/units/__fixtures__/unit-list-outputs.json: the canvas
 * run's landing and the server-run lanes (`jobs`), what each pip hands on
 * (`pips`, `saved`), what an Each wire fans out over (`lists`), the mode an
 * edge has when none is set (`defaults`) and where each wire lands in a legacy
 * target (`routes`). The server's half proves the same file on the backend
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
import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs, type FrontendResolvedInputs } from "../node-input-resolver"
import { isJsonRunResultType, unitSideJobFields, unitSideRunFields } from "@/lib/json-run-result"
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
const FIXTURE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../../tools/units/__fixtures__/unit-list-outputs.json"), "utf8")) as {
  readonly unit: { readonly type: string; readonly outputs: ReadonlyArray<{ readonly id: string; readonly from: string; readonly kind: string; readonly list?: boolean }> }
  readonly jobs: ReadonlyArray<JobCase>
  readonly saved: ReadonlyArray<SavedCase>
  readonly defaults: Readonly<Record<string, string>>
  readonly routes: { readonly data: Json; readonly cases: ReadonlyArray<RouteCase>; readonly bundleBranches: ReadonlyArray<BundleBranchCase> }
}
const TYPE = FIXTURE.unit.type
const SIDE_FIELDS = FIXTURE.unit.outputs.filter((o) => o.list === true || o.kind === "look").map((o) => o.from)
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
      const call = poll.mock.calls[0] as unknown as [string, unknown, unknown, string, unknown, (od: Json) => Json]
      expect(call.slice(0, 5)).toEqual(["L", start, "generatedImageUrl", "Fixture Layers", ctx])
      expectSide(call[5](c.outputData), c, "extraOutputFields")
    })

    it(`${c.name}: the server-run lanes (node output) and the job restores (job row) land the same`, () => {
      expectSide(unitSideRunFields(TYPE, c.nodeOutput), c, "node output")
      expectSide(unitSideJobFields(TYPE, c.outputData), c, "job row")
    })

    it(`${c.name}: the live server run paints them on the node and on the take; each pip hands on its value`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { executionStatus: "running", ...STALE })], edges: [] }))
      act(() => paintRunStates({ L: { status: "completed", startedAt: "2026-11-11T10:00:00.000Z", completedAt: "2026-11-11T10:01:00.000Z", jobId: "j1", output: c.nodeOutput } } as never))
      const data = stored("L")
      expect(data.generatedImageUrl).toBe(c.nodeOutput.imageUrl)
      expectSide(data, c, "node")
      const take = (data.generatedResults as Json[])[0]!
      expect(take.url).toBe(c.nodeOutput.imageUrl)
      expectSide(take, c, "take")
      for (const [pip, value] of Object.entries(c.pips)) {
        expect(extractNodeOutput(node("L", TYPE, data), pipOf(pip)), `pip "${pip}"`).toBe(value ?? undefined)
      }
    })

    it(`${c.name}: a restored poll lands them on the node and on the take; each pip hands on its value`, () => {
      act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, { executionStatus: "running", currentJobId: "j1", ...STALE })], edges: [] }))
      act(() => applyRestoredJobCompletion("L", TYPE, { output_data: c.outputData }, "j1"))
      const data = stored("L")
      expect(data.generatedImageUrl).toBe(c.outputData.imageUrl)
      expectSide(data, c, "node")
      expectSide((data.generatedResults as Json[])[0], c, "take")
      for (const [pip, value] of Object.entries(c.pips)) {
        expect(extractNodeOutput(node("L", TYPE, data), pipOf(pip)), `pip "${pip}"`).toBe(value ?? undefined)
      }
    })
  }
})

describe("saved — a node's data: each pip, and what an Each wire fans out over", () => {
  for (const c of FIXTURE.saved) {
    it(c.name, () => {
      const n = node("L", TYPE, c.data)
      for (const [pip, value] of Object.entries(c.pips)) {
        expect(extractNodeOutput(n, pipOf(pip)), `pip "${pip}"`).toBe(value ?? undefined)
      }
      for (const [pip, items] of Object.entries(c.lists)) {
        expect(extractNodeOutputAsList(n, pipOf(pip)), `list "${pip}"`).toEqual(items ?? undefined)
      }
    })
    // The canvas's own Filter List executor (its upstream collector), per pip.
    const collected = c.collected
    if (collected) {
      it(`${c.name}: what a list operator (filter-list) collects from each pip`, async () => {
        for (const [pip, items] of Object.entries(collected)) {
          const op = node("F", "filter-list", { conditions: [] })
          const edges = [{ id: "e", source: "L", target: "F", ...(pip === "" ? {} : { sourceHandle: pip }), targetHandle: "in" }] as unknown as WorkflowEdge[]
          act(() => useWorkflowStore.setState({ nodes: [node("L", TYPE, c.data), op], edges }))
          await executeNode(op, RUN_CTX)
          expect(stored("F").listResults, `pip "${pip}"`).toEqual(items)
        }
      })
    }
  }
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

describe("routes — a wire lands exactly what Upload Image wires holding the same images land", () => {
  for (const c of FIXTURE.routes.cases) {
    it(c.name, () => {
      const target = node("T", c.target, {})
      const src = node("L", TYPE, FIXTURE.routes.data)
      const edge = {
        id: "e", source: "L", target: "T", ...(c.pip === null ? {} : { sourceHandle: c.pip }), targetHandle: c.targetHandle,
        ...(c.mode ? { data: { outputMode: c.mode } } : {}),
      } as unknown as WorkflowEdge
      if (c.iteration !== undefined) {
        expect(getListFanOutForNode(target, [src, target], [edge])?.items).toEqual(FIXTURE.routes.data.generatedLayerUrls)
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
    })
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
