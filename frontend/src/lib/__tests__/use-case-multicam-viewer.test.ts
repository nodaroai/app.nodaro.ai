/**
 * Several recordings are read — and quoted — only for a viewer who may use
 * Speaker Map (decided 2026-10-19): the canvas's estimate follows the same
 * answer its run does, so the quote is the run.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const avail = vi.hoisted(() => ({ loaded: true, unavailable: [] as string[] }))
vi.mock("@/lib/surface-availability", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-availability")>()),
  surfaceAvailabilityLoaded: () => avail.loaded,
  isNodeUnavailable: (type: string) => avail.unavailable.includes(type),
}))

import { usecaseMulticamOffered, usecaseMulticamViewer } from "../use-case-multicam-viewer"
import { estimateWholeRun } from "@/components/editor/workflow-editor/estimate-run-credits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

beforeEach(() => {
  avail.loaded = true
  avail.unavailable = []
})

describe("usecaseMulticamOffered", () => {
  it("yes while Speaker Map is available to the viewer", () => {
    expect(usecaseMulticamOffered()).toBe(true)
  })
  it("no while it is withheld from them, and until their availability has landed", () => {
    avail.unavailable = ["speaker-map"]
    expect(usecaseMulticamOffered()).toBe(false)
    avail.unavailable = []
    avail.loaded = false
    expect(usecaseMulticamOffered()).toBe(false)
  })
})

describe("usecaseMulticamViewer: the three states the editor shows (decided 2026-10-19)", () => {
  it("loading until the answer lands, then offered or withheld", () => {
    avail.loaded = false
    expect(usecaseMulticamViewer()).toBe("loading")
    avail.loaded = true
    expect(usecaseMulticamViewer()).toBe("offered")
    avail.unavailable = ["speaker-map"]
    expect(usecaseMulticamViewer()).toBe("withheld")
  })
})

describe("the canvas's estimate of Tighten on two camera wires", () => {
  const cam = (id: string): WorkflowNode => ({ id, type: "upload-video", position: { x: 0, y: 0 }, data: { url: `https://r2/${id}.mp4`, metadata: { durationSeconds: 3600 } } }) as unknown as WorkflowNode
  const t = { id: "t", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", captions: false } } as unknown as WorkflowNode
  const wire = (source: string) => ({ id: `${source}-t`, source, target: "t", sourceHandle: "video", targetHandle: "media" }) as unknown as WorkflowEdge
  const price = () => 10
  const total = (nodes: WorkflowNode[], edges: WorkflowEdge[]) => estimateWholeRun(nodes, edges, price).total

  it("a viewer who may not use Speaker Map: the one-recording run's figure, the second wire not read", () => {
    avail.unavailable = ["speaker-map"]
    expect(total([cam("a"), cam("b"), t], [wire("a"), wire("b")])).toBe(total([cam("a"), t], [wire("a")]))
  })
  it("a viewer who may: the run on both cameras, above the one-recording figure", () => {
    expect(total([cam("a"), cam("b"), t], [wire("a"), wire("b")])).toBeGreaterThan(total([cam("a"), t], [wire("a")]))
  })
})
