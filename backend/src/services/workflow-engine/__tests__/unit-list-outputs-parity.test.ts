// @test-watches tools/units/__fixtures__/unit-list-outputs.json tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionState, NodeOutput, ResolvedInputs, SimpleEdge, SimpleNode } from "../types.js"

/**
 * A worker unit whose media take carries SIDE outputs (decided 2026-11-11) on
 * the server's engine, over every section of
 * tools/units/__fixtures__/unit-list-outputs.json: a LIST of files on one pip
 * (`list: true`) and a JSON (look) output beside the image take. The editor's
 * half reads the same fixture. The unit is the fixture's `unit`, derived from
 * fixture-echo's expected descriptor (its type, label, outputType, outputs and
 * producer replaced), added through the server's one door to the unit
 * descriptors; fixture-echo itself is added too — its JSON input `plan` is the
 * consumer a look pip's value is read off.
 */
vi.mock("../../../lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/unit-descriptors.js")>()
  const { readFileSync: read } = await import("node:fs")
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { unitProviderOf } = await import("../../../lib/unit-compose.js")
  const { descriptor } = await import("../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const unit = JSON.parse(read(new URL("../../../../../tools/units/__fixtures__/unit-list-outputs.json", import.meta.url), "utf8")).unit
  const layers = {
    ...descriptor,
    type: unit.type,
    label: unit.label,
    outputType: unit.outputType,
    producer: unit.contract.producer,
    outputs: unit.outputs.map((o: { id: string }) => o.id),
    handles: { ...descriptor.handles, outputs: unit.outputs },
  }
  type Unit = (typeof real.UNIT_NODE_DESCRIPTORS)[number]
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as Unit, layers as unknown as Unit]
  const unitDescriptorOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DESCRIPTORS: units,
    unitDescriptorOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDescriptorOf(t), h),
    providerOf: (t: string | undefined) => unitProviderOf(unitDescriptorOf(t)),
  }
})

/**
 * The published list-pip table (`LIST_OUTPUT_HANDLES`, composed from the
 * generated unit contracts when @nodaro/shared is built) cannot hold an
 * in-memory fixture unit, so the fixture's list pips are composed into it
 * here exactly as unitListPips() composes a real unit's — `defaultEdgeOutputMode`
 * answers "each" on a list pip (producer-types.ts), every other answer is the
 * package's own. The `defaults` section below proves the resolver READS that
 * rule (an edge with no mode fans out over a list pip and nowhere else).
 */
vi.mock("@nodaro/shared/nodes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@nodaro/shared/nodes")>()
  const { readFileSync: read } = await import("node:fs")
  const unit = JSON.parse(read(new URL("../../../../../tools/units/__fixtures__/unit-list-outputs.json", import.meta.url), "utf8")).unit
  const LIST_OUTPUT_HANDLES: Readonly<Record<string, readonly string[]>> = { ...real.LIST_OUTPUT_HANDLES, [unit.type]: unit.outputs.filter((o: { list?: true }) => o.list === true).map((o: { id: string }) => o.id) as string[] }
  const isListOutputHandle = (t: string | null | undefined, h: string | null | undefined): boolean =>
    typeof t === "string" && typeof h === "string" && Object.hasOwn(LIST_OUTPUT_HANDLES, t) && LIST_OUTPUT_HANDLES[t]!.includes(h)
  return {
    ...real,
    LIST_OUTPUT_HANDLES,
    isListOutputHandle,
    defaultEdgeOutputMode: (t: string | null | undefined, h: string | null | undefined) => (isListOutputHandle(t, h) ? "each" : real.defaultEdgeOutputMode(t, h)),
  }
})

const { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput, structuredJsonOf } = await import("../output-extractor.js")
const { getListFanOutForNode, resolveNodeInputs } = await import("../input-resolver.js")
const { executeFilterList } = await import("../inline-executor.js")
const { seededFromSavedData } = await import("../saved-data.js")
const { defaultEdgeOutputMode } = await import("@nodaro/shared/nodes")

type Pips = Record<string, string | null>
interface Fixture {
  readonly unit: { readonly type: string; readonly outputs: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly list?: true }> }
  readonly jobs: ReadonlyArray<{ readonly name: string; readonly outputData: Record<string, unknown>; readonly nodeOutput: NodeOutput; readonly pips: Pips }>
  readonly saved: ReadonlyArray<{ readonly name: string; readonly data: Record<string, unknown>; readonly nodeOutput: NodeOutput; readonly pips: Pips; readonly lists: Record<string, readonly string[] | null>; readonly collected?: Record<string, readonly string[]> }>
  readonly defaults: Record<string, "each" | "last">
  readonly routes: {
    readonly data: Record<string, unknown>
    readonly cases: ReadonlyArray<{ readonly name: string; readonly pip: string | null; readonly mode?: string; readonly iteration?: number; readonly target: string; readonly targetHandle: string; readonly asUploads: readonly string[] }>
    readonly bundleBranches: ReadonlyArray<{ readonly name: string; readonly pip: string; readonly mode: string; readonly target: string; readonly targetData?: Record<string, unknown>; readonly targetHandle: string; readonly inputs: ResolvedInputs }>
  }
}
const FIXTURE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/unit-list-outputs.json"), "utf8")) as Fixture
const TYPE = FIXTURE.unit.type
const handleOf = (key: string): string | null => (key === "" ? null : key)
const kindOf = (pip: string): string => FIXTURE.unit.outputs.find((o) => o.id === pip)!.kind

const sourceOf = (data: Record<string, unknown>): SimpleNode => ({ id: "src", type: TYPE, data: { label: "Layers", ...data } })

/** The source's states: this run ran it (its output is the seeded one), its saved data stands in with no state, and its saved data seeded. */
function lanesOf(src: SimpleNode): Array<[string, Record<string, NodeExecutionState>]> {
  const seeded = extractSavedNodeOutput(src)
  return [
    ["this run", seeded ? { src: { status: "completed", output: seeded } as NodeExecutionState } : {}],
    ["saved", {}],
    ["seeded", { src: seededFromSavedData(seeded) }],
  ]
}

/** The consumer a value of `pip`'s kind is read off: an image input (Upscale Image) or a JSON input (fixture-echo's `plan`). */
function consumerOf(pip: string): { readonly node: SimpleNode; readonly handle: string; readonly read: (inputs: ResolvedInputs) => unknown } {
  return kindOf(pip) === "look"
    ? { node: { id: "c", type: "fixture-echo", data: { label: "Echo" } }, handle: "plan", read: (i) => i.unitInputs?.plan }
    : { node: { id: "c", type: "upscale-image", data: { label: "Upscale" } }, handle: "image", read: (i) => i.imageUrl }
}

describe("a unit's side outputs — jobs (buildNodeOutputFromJobData), the server's engine", () => {
  for (const c of FIXTURE.jobs) {
    it(`${c.name}: the node output`, () => {
      expect(buildNodeOutputFromJobData(c.outputData, TYPE)).toEqual(c.nodeOutput)
    })
    it(`${c.name}: what a plain wire from each pip carries`, () => {
      const output = buildNodeOutputFromJobData(c.outputData, TYPE)
      for (const [key, value] of Object.entries(c.pips)) expect(getPrimaryOutput(output, TYPE, handleOf(key)), `pip "${key}"`).toBe(value ?? undefined)
    })
  }
})

describe("a unit's side outputs — saved data (extractSavedNodeOutput), the server's engine", () => {
  for (const c of FIXTURE.saved) {
    const src = sourceOf(c.data)
    it(`${c.name}: the seeded output`, () => {
      expect(extractSavedNodeOutput(src)).toEqual(c.nodeOutput)
    })
    it(`${c.name}: what a plain wire from each pip carries`, () => {
      const output = extractSavedNodeOutput(src)!
      for (const [key, value] of Object.entries(c.pips)) expect(getPrimaryOutput(output, TYPE, handleOf(key)), `pip "${key}"`).toBe(value ?? undefined)
    })
    // The take pip (`base`) lists only this run's takes: a node with several
    // saved takes (the second case) does not fan out over them on any lane.
    for (const [lane, states] of lanesOf(src)) {
      it(`${c.name}: what an Each wire from each pip fans out over (${lane})`, () => {
        for (const [pip, list] of Object.entries(c.lists)) {
          const { node, handle, read } = consumerOf(pip)
          const edges: SimpleEdge[] = [{ id: "e", source: "src", target: "c", sourceHandle: pip, targetHandle: handle, data: { outputMode: "each" } } as SimpleEdge]
          const fanOut = getListFanOutForNode(node, edges, states, [src, node])
          // Both engines fan a node out over a list holding MORE than one value;
          // a list of one runs it once, on that item (each row read below).
          expect(fanOut?.items ?? null, `pip "${pip}" fan-out`).toEqual(list && list.length > 1 ? list : null)
          for (const [row, item] of (list ?? []).entries()) {
            expect(read(resolveNodeInputs(node, edges, states, [src, node], undefined, row)), `pip "${pip}" row ${row}`).toBe(item)
          }
          // A media pip that lists nothing reads its one value on any row (a node
          // with a state; with none at all a plain read finds no value on any
          // node). A JSON input wired to an empty look pip holds "" by its own
          // lane rule (unit-inputs.ts), so look pips are left out here.
          if (list === null && lane !== "saved" && kindOf(pip) !== "look") {
            expect(read(resolveNodeInputs(node, edges, states, [src, node], undefined, 1)), `pip "${pip}" row 1`).toBe(c.pips[pip] ?? undefined)
          }
        }
      })
    }
    // A list operator reads its source's state: the source ran this run, or the
    // orchestrator seeded it from its saved data (it seeds every node it does not run).
    const collected = c.collected
    if (collected) {
      for (const [lane, states] of lanesOf(src).filter(([l]) => l !== "saved")) {
        it(`${c.name}: what a list operator (filter-list) collects from each pip (${lane})`, () => {
          const node: SimpleNode = { id: "c", type: "filter-list", data: { label: "Filter", conditions: [] } }
          for (const [key, items] of Object.entries(collected)) {
            const edges: SimpleEdge[] = [{ id: "e", source: "src", target: "c", sourceHandle: handleOf(key), targetHandle: "in" }]
            expect(executeFilterList(node, edges, [src, node], states).listResults ?? [], `pip "${key}"`).toEqual(items)
          }
        })
      }
    }
  }
})

describe("a unit's side outputs — the mode of an edge with no outputMode, the server's engine", () => {
  const src = sourceOf(FIXTURE.routes.data)
  const states: Record<string, NodeExecutionState> = { src: { status: "completed", output: extractSavedNodeOutput(src) } as NodeExecutionState }
  for (const [key, mode] of Object.entries(FIXTURE.defaults)) {
    it(`pip "${key}" defaults to ${mode}`, () => {
      expect(defaultEdgeOutputMode(TYPE, handleOf(key))).toBe(mode)
      // The resolver reads it: a modeless wire fans out exactly when the mode is "each".
      const { node, handle } = consumerOf(key === "" ? FIXTURE.unit.outputs[0]!.id : key)
      const edges: SimpleEdge[] = [{ id: "e", source: "src", target: "c", sourceHandle: handleOf(key), targetHandle: handle }]
      expect(getListFanOutForNode(node, edges, states, [src, node]) !== undefined).toBe(mode === "each")
    })
  }
})

/**
 * A routed input with what names the SOURCE NODE removed: `imageUrlsWithSourceIds`
 * (Image Collage's per-source size alignment) carries each wire's source id, and
 * the two graphs compared below differ in exactly that — one source vs N
 * Upload Image nodes. Its URLs, in order, are compared.
 */
function withoutSourceIds(inputs: ResolvedInputs): ResolvedInputs {
  const { imageUrlsWithSourceIds, ...rest } = inputs
  return imageUrlsWithSourceIds ? { ...rest, imageUrlsWithSourceIds: imageUrlsWithSourceIds.map(({ url }) => ({ url })) as typeof imageUrlsWithSourceIds } : rest
}

/** A routed source's states: this run ran it, or the saved data seeded it (the orchestrator seeds every node it does not run). */
function routeLanesOf(src: SimpleNode): Array<[string, Record<string, NodeExecutionState>]> {
  const seeded = extractSavedNodeOutput(src)
  return [
    ["this run", { src: { status: "completed", output: seeded } as NodeExecutionState }],
    ["seeded", { src: seededFromSavedData(seeded) }],
  ]
}

describe("a unit's side outputs — what a wire lands in a legacy target, the server's engine", () => {
  const src = sourceOf(FIXTURE.routes.data)
  for (const c of FIXTURE.routes.cases) {
    for (const [lane, states] of routeLanesOf(src)) {
      it(`${c.name} (${lane})`, () => {
        const target: SimpleNode = { id: "t", type: c.target, data: { label: "Target" } }
        const edge = { id: "e", source: "src", target: "t", sourceHandle: c.pip, targetHandle: c.targetHandle, ...(c.mode ? { data: { outputMode: c.mode } } : {}) } as SimpleEdge
        const actual = resolveNodeInputs(target, [edge], states, [src, target], undefined, c.iteration)
        // The same target, wired from Upload Image nodes holding those files, in order.
        const uploads: SimpleNode[] = c.asUploads.map((url, i) => ({ id: `u${i}`, type: "upload-image", data: { label: `Upload ${i}`, url } }))
        const uploadEdges: SimpleEdge[] = uploads.map((u, i) => ({ id: `ue${i}`, source: u.id, target: "t", sourceHandle: null, targetHandle: c.targetHandle }))
        const expected = resolveNodeInputs(target, uploadEdges, {}, [...uploads, target])
        // Every file lands somewhere (never two empty input sets compared).
        expect(JSON.stringify(expected)).toContain(c.asUploads.at(-1)!)
        expect(withoutSourceIds(actual)).toEqual(withoutSourceIds(expected))
      })
    }
  }
})

describe("a unit's side outputs — a Bundle into a target with its own Bundle branch, the server's engine", () => {
  const src = sourceOf(FIXTURE.routes.data)
  for (const c of FIXTURE.routes.bundleBranches) {
    for (const [lane, states] of routeLanesOf(src)) {
      it(`${c.name} (${lane})`, () => {
        const target: SimpleNode = { id: "t", type: c.target, data: { label: "Target", ...c.targetData } }
        const edge: SimpleEdge = { id: "e", source: "src", target: "t", sourceHandle: c.pip, targetHandle: c.targetHandle, data: { outputMode: c.mode } }
        expect(resolveNodeInputs(target, [edge], states, [src, target])).toEqual(c.inputs)
      })
    }
  }
})

/**
 * The fixture's targets route their handles (`image`, `references`) by the
 * handle, ahead of any source type. A wire naming no target handle is routed
 * by its source type alone: an image pip lands as an Upload Image's file would
 * (a reference of Generate Image, the image of the others), never the prompt
 * an unknown source type falls back to. Server-only cases beside the fixture.
 */
describe("a unit's image pip routes as an image source where only the source type decides, the server's engine", () => {
  const src = sourceOf(FIXTURE.routes.data)
  const states: Record<string, NodeExecutionState> = { src: { status: "completed", output: extractSavedNodeOutput(src) } as NodeExecutionState }
  const cases: ReadonlyArray<readonly [string | null, string | undefined, number | undefined, string, readonly string[]]> = [
    ["base", undefined, undefined, "generate-image", ["https://r2/base.png"]],
    [null, undefined, undefined, "upscale-image", ["https://r2/base.png"]],
    ["base", undefined, undefined, "edit-image", ["https://r2/base.png"]],
    ["layers", "last", undefined, "edit-image", ["https://r2/l1.png"]],
    ["layers", undefined, 2, "image-to-video", ["https://r2/l3.png"]],
    ["layers", "all", undefined, "generate-image", ["https://r2/l1.png", "https://r2/l2.png", "https://r2/l3.png"]],
  ]
  for (const [pip, mode, iteration, targetType, files] of cases) {
    it(`${pip ?? "(no pip)"} ${mode ?? "default"} → ${targetType}`, () => {
      const target: SimpleNode = { id: "t", type: targetType, data: { label: "Target" } }
      const edge = { id: "e", source: "src", target: "t", sourceHandle: pip, targetHandle: null, ...(mode ? { data: { outputMode: mode } } : {}) } as SimpleEdge
      const actual = resolveNodeInputs(target, [edge], states, [src, target], undefined, iteration)
      const uploads: SimpleNode[] = files.map((url, i) => ({ id: `u${i}`, type: "upload-image", data: { label: `Upload ${i}`, url } }))
      const expected = resolveNodeInputs(target, uploads.map((u, i) => ({ id: `ue${i}`, source: u.id, target: "t", sourceHandle: null, targetHandle: null })), {}, [...uploads, target])
      expect(actual.prompt).toBeUndefined()
      expect(JSON.stringify(expected)).toContain(files.at(-1)!)
      expect(withoutSourceIds(actual)).toEqual(withoutSourceIds(expected))
    })
  }
})

describe("a unit's side outputs — a JSON or list consumer reads the pip its wire leaves, the server's engine", () => {
  const src = sourceOf(FIXTURE.routes.data)
  const output = extractSavedNodeOutput(src)
  it("the look pip hands on its own JSON; the base pip (or an edge naming no pip) never the layer data", () => {
    expect(structuredJsonOf(output, TYPE, "layerData")).toEqual(FIXTURE.routes.data.generatedLayerData)
    expect(structuredJsonOf(output, TYPE, "base")).toBeUndefined()
    expect(structuredJsonOf(output, TYPE, null)).toBeUndefined()
    expect(structuredJsonOf(output, TYPE, "layers")).toBeUndefined()
  })
  it("a list operator (filter-list) takes every file of the list pip — the list an Each wire fans out over — and the take alone from the base pip", () => {
    const states: Record<string, NodeExecutionState> = { src: { status: "completed", output } as NodeExecutionState }
    const node: SimpleNode = { id: "c", type: "filter-list", data: { label: "Filter", conditions: [] } }
    const listed = (pip: string | null) =>
      executeFilterList(node, [{ id: "e", source: "src", target: "c", sourceHandle: pip, targetHandle: "in" }], [src, node], states).listResults
    expect(listed("layers")).toEqual(FIXTURE.routes.data.generatedLayerUrls)
    expect(listed("base")).toEqual([FIXTURE.routes.data.generatedImageUrl])
    expect(listed("layerData")).toEqual((FIXTURE.routes.data.generatedLayerData as unknown[]).map((x) => JSON.stringify(x)))
    // A run that made no layers lists none — never the take in their place.
    const bare = { src: { status: "completed", output: { imageUrl: "https://r2/base.png" } } as NodeExecutionState }
    expect(executeFilterList(node, [{ id: "e", source: "src", target: "c", sourceHandle: "layers", targetHandle: "in" }], [src, node], bare).listResults ?? []).toEqual([])
  })
})
