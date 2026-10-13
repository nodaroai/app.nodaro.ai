/**
 * A UGC video of ONE clip: UGC Clips hands on one ticket, so UGC Clip runs once (no fan-out) and
 * keeps its earlier takes. A Bundle edge from it into the join reads exactly the take it shows —
 * never an earlier take, never a batch an earlier run left. The editor-engine side; the server's is
 * backend …/ugc-single-clip-join.test.ts. The URLs are placeholders.
 */
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import { ugcJobResultPatch } from "@/lib/ugc-run-patch"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const JOIN_EDGE = { id: "e", source: "clip", sourceHandle: "video-out", target: "join", targetHandle: "in", data: { outputMode: "all" } } as unknown as WorkflowEdge
const join = node("join", "combine-videos", { transition: "cut" })
const videoUrlsFrom = (clipData: Record<string, unknown>) => resolveNodeInputs(join, [node("clip", "ugc-clip", clipData), join], [JOIN_EDGE]).videoUrls

describe("a single-clip UGC video joins exactly one take (editor engine)", () => {
  it("a clip re-rendered once holds two takes: the join reads the one it shows", () => {
    expect(videoUrlsFrom({ rerender: {}, generatedVideoUrl: "https://cdn.example/new.mp4", activeResultIndex: 0, generatedResults: [{ url: "https://cdn.example/new.mp4" }, { url: "https://cdn.example/old.mp4" }] }))
      .toEqual(["https://cdn.example/new.mp4"])
  })
  it("the take the person picked in the carousel is the one joined", () => {
    expect(videoUrlsFrom({ rerender: {}, generatedVideoUrl: "https://cdn.example/old.mp4", activeResultIndex: 1, generatedResults: [{ url: "https://cdn.example/new.mp4" }, { url: "https://cdn.example/old.mp4" }] }))
      .toEqual(["https://cdn.example/old.mp4"])
  })
  it("a single run after a fanned-out one leaves no batch behind: the join reads the new take alone", () => {
    const before = { rerender: {}, __listResults: ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"], __listResultMeta: [{ warnings: [], durationSec: 7 }, { warnings: [], durationSec: 7 }] }
    const patch = ugcJobResultPatch("ugc-clip", { videoUrl: "https://cdn.example/single.mp4", durationSec: 12, clipWarnings: [] }, { id: "job-1", endedAt: "2026-10-12T00:00:00Z" })!
    expect(videoUrlsFrom({ ...before, ...patch })).toEqual(["https://cdn.example/single.mp4"])
  })
  it("a fanned-out clip still joins its whole batch, in clip order", () => {
    expect(videoUrlsFrom({ rerender: {}, generatedVideoUrl: "https://cdn.example/2.mp4", generatedResults: [{ url: "https://cdn.example/2.mp4" }, { url: "https://cdn.example/1.mp4" }], __listResults: ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"] }))
      .toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })
})
