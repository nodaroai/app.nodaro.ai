/**
 * An `auto` framing source follows faces only for a viewer who may use
 * Speaker Frames (decided 2026-10-20). The canvas's run downgrades it to the
 * even split only once the viewer is KNOWN to be withheld (while loading the
 * route decides it for the real caller); its estimate quotes the even split
 * only then too; the panel shows nothing until the answer lands.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const avail = vi.hoisted(() => ({ loaded: true, unavailable: [] as string[] }))
vi.mock("@/lib/surface-availability", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-availability")>()),
  surfaceAvailabilityLoaded: () => avail.loaded,
  isNodeUnavailable: (type: string) => avail.unavailable.includes(type),
}))

import { usecaseFramesOffered, usecaseFramesViewer, usecaseFramesWithheld } from "../use-case-frames-viewer"
import { estimateWholeRun } from "@/components/editor/workflow-editor/estimate-run-credits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

beforeEach(() => {
  avail.loaded = true
  avail.unavailable = []
})

describe("the canvas's run and estimate", () => {
  it("available: auto is sent as is, and quoted following faces", () => {
    expect(usecaseFramesOffered()).toBe(true)
    expect(usecaseFramesWithheld()).toBe(false)
  })
  it("withheld: auto is sent, and quoted, as the even split", () => {
    avail.unavailable = ["speaker-frames"]
    expect(usecaseFramesOffered()).toBe(false)
    expect(usecaseFramesWithheld()).toBe(true)
  })
  it("still loading: auto is sent as is (the route decides) and quoted following faces (never under the hold)", () => {
    avail.loaded = false
    avail.unavailable = ["speaker-frames"]
    expect(usecaseFramesOffered()).toBe(true)
    expect(usecaseFramesWithheld()).toBe(false)
  })
})

describe("usecaseFramesViewer: the three states the panel shows", () => {
  it("loading until the answer lands, then offered or withheld", () => {
    avail.loaded = false
    expect(usecaseFramesViewer()).toBe("loading")
    avail.loaded = true
    expect(usecaseFramesViewer()).toBe("offered")
    avail.unavailable = ["speaker-frames"]
    expect(usecaseFramesViewer()).toBe("withheld")
  })
})

describe("the canvas's estimate of a framed, automatic Tighten", () => {
  const rec = { id: "rec", type: "upload-video", position: { x: 0, y: 0 }, data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: 3600 } } } as unknown as WorkflowNode
  const t = (framingSource?: string) =>
    ({ id: "t", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", captions: false, framing: { aspect: "9:16", layout: "stacked" }, ...(framingSource ? { framingSource } : {}) } }) as unknown as WorkflowNode
  const edges = [{ id: "e", source: "rec", target: "t", sourceHandle: "video", targetHandle: "media" }] as unknown as WorkflowEdge[]
  const total = (framingSource?: string) => estimateWholeRun([rec, t(framingSource)], edges, () => 10).total
  it("follows faces for a viewer who may; the even split's quote for one Speaker Frames is withheld from", () => {
    expect(total("auto")).toEqual(total("tracking"))
    expect(total("auto")).toBeGreaterThan(total())
    avail.unavailable = ["speaker-frames"]
    expect(total("auto")).toEqual(total())
  })
})
