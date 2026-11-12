import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"
import { seedanceTaskTypeAsRun, seedanceTaskTypeRunDuration, wiredReferenceVideoSec } from "../seedance-task-type"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The length a Generate Video node's run is priced at once the server resolves
 * its Seedance reference task type (the shared `resolveSeedanceTaskType`): the
 * editor's price id must name that length's row. A clip whose length the
 * editor does not know counts as the model's longest accepted clip, as the
 * server counts it, so the quote is never below the reservation.
 */

const CLIP = "https://cdn.example/clip.mp4"
const upload = (id: string, sec?: number): WorkflowNode => ({
  id, type: "upload-video", position: { x: 0, y: 0 },
  data: { label: id, url: CLIP, ...(sec !== undefined ? { generatedResults: [{ url: CLIP, duration: sec }] } : {}) },
}) as WorkflowNode
const wire = (source: string, targetHandle = "videoReferences"): WorkflowEdge =>
  ({ id: `${source}->gv:${targetHandle}`, source, target: "gv", sourceHandle: "video", targetHandle }) as WorkflowEdge

const DEFAULT_LENGTH = MODEL_CATALOG["seedance-2-5"]!.defaultDuration
const runDuration = (
  data: Record<string, unknown>,
  duration: number | string | undefined,
  clips: Array<number | undefined>,
  opts: { provider?: string; rerunIds?: ReadonlySet<string> } = {},
) => {
  const nodes = clips.map((sec, i) => upload(`clip${i}`, sec))
  return seedanceTaskTypeRunDuration({
    nodeId: "gv",
    provider: opts.provider ?? "seedance-2-5",
    duration,
    data,
    nodes,
    edges: nodes.map((n) => wire(n.id)),
    rerunIds: opts.rerunIds,
  })
}

describe("seedanceTaskTypeRunDuration", () => {
  it("a node without the setting keeps its duration exactly as given, without reading the graph", () => {
    const unreadable = new Proxy([], { get: () => { throw new Error("read the graph") } }) as unknown as WorkflowNode[]
    for (const duration of [5, "5", undefined, VIDEO_DURATION_AUTO]) {
      for (const requested of [undefined, "auto", "Edit", 3]) {
        expect(seedanceTaskTypeRunDuration({
          nodeId: "gv", provider: "seedance-2-5", duration, data: { referenceTaskType: requested }, nodes: unreadable, edges: [],
        })).toBe(duration)
      }
    }
  })

  it("Edit with every clip 4–30 s runs at Auto length", () => {
    expect(runDuration({ referenceTaskType: "edit" }, 5, [6])).toBe(VIDEO_DURATION_AUTO)
    expect(runDuration({ referenceTaskType: "edit" }, 5, [6, 12])).toBe(VIDEO_DURATION_AUTO)
  })

  it("Edit with a clip outside 4–30 s keeps the stored length", () => {
    expect(runDuration({ referenceTaskType: "edit" }, 5, [3])).toBe(5)
    expect(runDuration({ referenceTaskType: "edit" }, "5", [6, 3])).toBe("5")
  })

  it("Edit with a clip whose length is not known counts it at the model's longest clip (Auto length)", () => {
    expect(runDuration({ referenceTaskType: "edit" }, 5, [undefined])).toBe(VIDEO_DURATION_AUTO)
  })

  it("a clip whose source re-runs is not known yet, whatever it measured last time", () => {
    expect(runDuration({ referenceTaskType: "edit" }, 5, [3], { rerunIds: new Set(["clip0", "gv"]) })).toBe(VIDEO_DURATION_AUTO)
  })

  it("Extend at Auto or no length runs at the model's default; a set length is kept", () => {
    expect(runDuration({ referenceTaskType: "extend" }, VIDEO_DURATION_AUTO, [6])).toBe(DEFAULT_LENGTH)
    expect(runDuration({ referenceTaskType: "extend" }, undefined, [6])).toBe(DEFAULT_LENGTH)
    expect(runDuration({ referenceTaskType: "extend" }, 5, [6])).toBe(5)
  })

  it("A reference moves nothing", () => {
    expect(runDuration({ referenceTaskType: "reference" }, VIDEO_DURATION_AUTO, [6])).toBe(VIDEO_DURATION_AUTO)
  })

  it("Edit or Extend without a reference video, on a draft, or on another model moves nothing", () => {
    expect(runDuration({ referenceTaskType: "edit" }, 5, [])).toBe(5)
    expect(runDuration({ referenceTaskType: "extend" }, VIDEO_DURATION_AUTO, [])).toBe(VIDEO_DURATION_AUTO)
    expect(runDuration({ referenceTaskType: "edit", draft: true }, 5, [6])).toBe(5)
    expect(runDuration({ referenceTaskType: "edit" }, 5, [6], { provider: "seedance-2" })).toBe(5)
  })
})

describe("seedanceTaskTypeAsRun — what the run declares and the length it runs at", () => {
  // The one answer the pill, the run estimate and the panel all read: the
  // panel locks only when this says the declaration holds.
  const asRun = (data: Record<string, unknown>, duration: number | string | undefined, referenceVideoSec: Array<number | undefined>, provider = "seedance-2-5") =>
    seedanceTaskTypeAsRun({ provider, duration, data, referenceVideoSec })

  it("Edit with every clip 4–30 s is declared and runs at Auto length", () => {
    expect(asRun({ referenceTaskType: "edit" }, 5, [6])).toStrictEqual({ taskType: "edit", duration: VIDEO_DURATION_AUTO })
  })

  it("Edit with a clip the editor knows is outside 4–30 s is not declared; the length is the node's own", () => {
    expect(asRun({ referenceTaskType: "edit" }, 5, [3])).toStrictEqual({ taskType: undefined, duration: 5 })
    expect(asRun({ referenceTaskType: "edit" }, "5", [6, 31])).toStrictEqual({ taskType: undefined, duration: "5" })
  })

  it("Edit with a clip of unknown length is declared (the price makes the same assumption)", () => {
    expect(asRun({ referenceTaskType: "edit" }, 5, [undefined])).toStrictEqual({ taskType: "edit", duration: VIDEO_DURATION_AUTO })
  })

  it("Extend is declared; at Auto it runs at the model's default length", () => {
    expect(asRun({ referenceTaskType: "extend" }, VIDEO_DURATION_AUTO, [6])).toStrictEqual({ taskType: "extend", duration: DEFAULT_LENGTH })
    expect(asRun({ referenceTaskType: "extend" }, 5, [6])).toStrictEqual({ taskType: "extend", duration: 5 })
  })

  it("A reference is declared and moves nothing", () => {
    expect(asRun({ referenceTaskType: "reference" }, VIDEO_DURATION_AUTO, [6])).toStrictEqual({ taskType: "reference", duration: VIDEO_DURATION_AUTO })
  })

  it("nothing is declared without the setting, without a clip, on a draft or on another model", () => {
    expect(asRun({}, 5, [6])).toStrictEqual({ taskType: undefined, duration: 5 })
    expect(asRun({ referenceTaskType: "auto" }, 5, [6])).toStrictEqual({ taskType: undefined, duration: 5 })
    expect(asRun({ referenceTaskType: "edit" }, 5, [])).toStrictEqual({ taskType: undefined, duration: 5 })
    expect(asRun({ referenceTaskType: "edit", draft: true }, 5, [6])).toStrictEqual({ taskType: undefined, duration: 5 })
    expect(asRun({ referenceTaskType: "edit" }, 5, [6], "seedance-2")).toStrictEqual({ taskType: undefined, duration: 5 })
  })

  it("seedanceTaskTypeRunDuration is its length, for the clips wired in the graph", () => {
    const cases: Array<[Record<string, unknown>, number | string | undefined, Array<number | undefined>]> = [
      [{ referenceTaskType: "edit" }, 5, [6]],
      [{ referenceTaskType: "edit" }, 5, [3]],
      [{ referenceTaskType: "edit" }, 5, [undefined]],
      [{ referenceTaskType: "extend" }, VIDEO_DURATION_AUTO, [6]],
      [{ referenceTaskType: "extend" }, undefined, [6]],
      [{ referenceTaskType: "reference" }, "5", [6]],
      [{}, 5, [6]],
    ]
    for (const [data, duration, clips] of cases) {
      expect(runDuration(data, duration, clips), JSON.stringify([data, duration, clips])).toBe(asRun(data, duration, clips).duration)
    }
  })
})

describe("wiredReferenceVideoSec", () => {
  it("one entry per reference-video wire, in wire order; other handles are not reference videos", () => {
    const nodes = [upload("a", 6), upload("b"), upload("c", 9)]
    const edges = [wire("a"), wire("b"), wire("c", "startFrame")]
    expect(wiredReferenceVideoSec("gv", nodes, edges)).toEqual([6, undefined])
  })
})

describe("every model that takes a reference task type declares its longest reference clip", () => {
  // The helper counts a clip it cannot measure at that length, as the server
  // does; a model without one would be quoted below its reservation.
  it.each(Object.entries(MODEL_CATALOG).filter(([, m]) => (m.referenceTaskTypes?.length ?? 0) > 0).map(([id]) => id))("%s", (id) => {
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS[id]?.maxSec).toBeGreaterThan(0)
  })
})
