import { describe, it, expect } from "vitest"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared"
import {
  seedanceRefQuoteRequest,
  seedanceRefQuoteKey,
  seedanceRefQuoteKeyFor,
  parseSeedanceRefQuoteKey,
  isSeedanceRefQuoteKey,
} from "../seedance-ref-quote"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The request a Seedance reference-video quote prices: the levers the run sends
 * and the clips the run will send, read through the run's own input resolver.
 * A clip not produced yet — no URL, or its source re-runs in this run — is
 * counted as unknown (the server quotes it at the worst case).
 */

const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: "video", targetHandle }) as WorkflowEdge

const CLIP = "https://cdn.example/clip.mp4"
const upload = node("clip", "upload-video", { url: CLIP })
const empty = node("empty", "upload-video", {})

describe("seedanceRefQuoteRequest — Generate Video", () => {
  const gv = (data: Record<string, unknown>) => node("gv", "generate-video", { provider: "seedance-2-5", duration: 8, ...data })

  it("names the wired clip and the levers the run sends", () => {
    const g = gv({ resolution: "720p", draft: true })
    expect(seedanceRefQuoteRequest(g, [upload, g], [edge("clip", "gv", "videoReferences")])).toEqual({
      provider: "seedance-2-5", resolution: "720p", duration: 8, draft: true, referenceVideoUrls: [CLIP],
    })
  })

  it("counts a wired clip with no output yet as unknown", () => {
    const g = gv({})
    expect(seedanceRefQuoteRequest(g, [empty, g], [edge("empty", "gv", "videoReferences")])).toEqual({
      provider: "seedance-2-5", duration: 8, referenceVideoUrls: [], unknownReferenceVideos: 1,
    })
  })

  it("counts a clip whose source re-runs in this run as unknown", () => {
    const g = gv({})
    const req = seedanceRefQuoteRequest(g, [upload, g], [edge("clip", "gv", "videoReferences")], new Set(["clip", "gv"]))
    expect(req?.referenceVideoUrls).toEqual([])
    expect(req?.unknownReferenceVideos).toBe(1)
  })

  it("is undefined without a reference video, or for a model whose price does not follow the clips", () => {
    const g = gv({})
    expect(seedanceRefQuoteRequest(g, [upload, g], [])).toBeUndefined()
    const k = node("gv", "generate-video", { provider: "kling-3.0", duration: 5 })
    expect(seedanceRefQuoteRequest(k, [upload, k], [edge("clip", "gv", "videoReferences")])).toBeUndefined()
    // A clip on the start frame is not a reference video.
    expect(seedanceRefQuoteRequest(g, [upload, g], [edge("clip", "gv", "startFrame")])).toBeUndefined()
  })
})

describe("seedanceRefQuoteRequest — Video to Video's Seedance edit lane", () => {
  it("prices the source clip at Auto with the node's one resolution field and its draft toggle", () => {
    const v = node("v2v", "video-to-video", { provider: "seedance-2-5", v2vResolution: "1080p", draft: true })
    expect(seedanceRefQuoteRequest(v, [upload, v], [edge("clip", "v2v", "video")])).toEqual({
      provider: "seedance-2-5", resolution: "1080p", duration: VIDEO_DURATION_AUTO, draft: true, referenceVideoUrls: [CLIP],
    })
  })

  it("is undefined for a route provider (flat-priced)", () => {
    const v = node("v2v", "video-to-video", { provider: "wan" })
    expect(seedanceRefQuoteRequest(v, [upload, v], [edge("clip", "v2v", "video")])).toBeUndefined()
  })
})

describe("quote keys", () => {
  it("round-trip, and are told apart from model ids", () => {
    const g = node("gv", "generate-video", { provider: "seedance-2-5", duration: 8 })
    const key = seedanceRefQuoteKeyFor(g, [upload, g], [edge("clip", "gv", "videoReferences")])!
    expect(isSeedanceRefQuoteKey(key)).toBe(true)
    expect(isSeedanceRefQuoteKey("seedance-2-5:8s:720p-ref")).toBe(false)
    expect(parseSeedanceRefQuoteKey(key)).toEqual({ provider: "seedance-2-5", duration: 8, referenceVideoUrls: [CLIP] })
    expect(seedanceRefQuoteKey(parseSeedanceRefQuoteKey(key)!)).toBe(key)
  })
})
