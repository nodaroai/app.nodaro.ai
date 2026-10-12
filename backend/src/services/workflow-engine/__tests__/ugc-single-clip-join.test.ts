/**
 * A UGC video of ONE clip, on the server engine: a UGC Clip this run did not run (Run from here
 * after it) is read from its saved data, and a Bundle edge into the join reads exactly the take it
 * shows — never its earlier takes. The twin of the editor's ugc-single-clip-join.test.ts.
 */
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleEdge, SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const JOIN_EDGE: SimpleEdge = { id: "e", source: "clip", target: "join", sourceHandle: "video-out", targetHandle: "in", data: { outputMode: "all" } }
const join = node("join", "combine-videos", { transition: "cut" })
const videoUrlsFrom = (clipData: Record<string, unknown>) => resolveNodeInputs(join, [JOIN_EDGE], {}, [node("clip", "ugc-clip", clipData), join]).videoUrls

describe("a single-clip UGC video joins exactly one take (server engine)", () => {
  it("a clip holding two takes, not run this run: the join reads the one it shows", () => {
    expect(videoUrlsFrom({ rerender: {}, generatedVideoUrl: "https://cdn.example/new.mp4", activeResultIndex: 0, generatedResults: [{ url: "https://cdn.example/new.mp4" }, { url: "https://cdn.example/old.mp4" }] }))
      .toEqual(["https://cdn.example/new.mp4"])
  })
  it("the take picked in the carousel is the one joined", () => {
    expect(videoUrlsFrom({ rerender: {}, activeResultIndex: 1, generatedResults: [{ url: "https://cdn.example/new.mp4" }, { url: "https://cdn.example/old.mp4" }] }))
      .toEqual(["https://cdn.example/old.mp4"])
  })
  it("a fanned-out clip still joins its whole batch, in clip order", () => {
    expect(videoUrlsFrom({ rerender: {}, generatedResults: [{ url: "https://cdn.example/2.mp4" }], __listResults: ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"] }))
      .toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })
})
