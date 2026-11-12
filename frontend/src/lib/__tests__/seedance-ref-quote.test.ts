// @test-watches backend/src/lib/__tests__/fixtures/seedance-reference-auto-quote.json backend/src/lib/__tests__/fixtures/seedance-draft-edit-quote.json
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
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

describe("seedanceRefQuoteRequest — Seedance 2.5 reference task type", () => {
  // The server resolves the declaration by the run's own rule (it measures the
  // clips), so the editor only hands it the node's value — and only a value the
  // model takes; anything else is exactly today's request.
  const gv = (data: Record<string, unknown>) => node("gv", "generate-video", { provider: "seedance-2-5", duration: 5, aspectRatio: "16:9", ...data })
  const wires = [edge("clip", "gv", "videoReferences")]
  const today = seedanceRefQuoteRequest(gv({}), [upload, gv({})], wires)

  it("carries the node's declared value", () => {
    for (const value of ["reference", "edit", "extend"] as const) {
      const g = gv({ referenceTaskType: value })
      expect(seedanceRefQuoteRequest(g, [upload, g], wires)).toStrictEqual({ ...today, referenceTaskType: value })
    }
  })

  it("an absent, auto or unknown value is today's request, key for key", () => {
    for (const value of [undefined, "auto", "Edit", 3]) {
      const g = gv({ referenceTaskType: value })
      expect(seedanceRefQuoteRequest(g, [upload, g], wires), String(value)).toStrictEqual(today)
    }
  })

  it("a model that takes no task type sends none", () => {
    const g = node("gv", "generate-video", { provider: "seedance-2", duration: 5, referenceTaskType: "edit" })
    const plain = node("gv", "generate-video", { provider: "seedance-2", duration: 5 })
    expect(seedanceRefQuoteRequest(g, [upload, g], wires)).toStrictEqual(seedanceRefQuoteRequest(plain, [upload, plain], wires))
  })

  it("keys the declaration, so switching the setting re-quotes; no setting keeps today's key", () => {
    const edit = gv({ referenceTaskType: "edit" })
    const extend = gv({ referenceTaskType: "extend" })
    const keyOf = (g: WorkflowNode) => seedanceRefQuoteKeyFor(g, [upload, g], wires)!
    expect(new Set([keyOf(gv({})), keyOf(edit), keyOf(extend)]).size).toBe(3)
    expect(keyOf(gv({}))).toBe(seedanceRefQuoteKey(today!))
    expect(keyOf(gv({}))).not.toContain("referenceTaskType")
    expect(parseSeedanceRefQuoteKey(keyOf(edit))).toStrictEqual({ ...today, referenceTaskType: "edit" })
  })

  // The editor's half of a shared fixture: a node with A reference and Duration
  // on Auto, whose run is held at the model's longest output. The server's half
  // (backend/src/ee/billing/__tests__/seedance-task-type-estimate.test.ts) posts
  // `editorRequest` to the estimate route and holds its answer, and the workflow
  // estimate of the same graph, to what that run reserves.
  it("A reference with Duration on Auto: the request is the fixture's, key for key — the one the server prices at the run's reservation", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const fixture = JSON.parse(readFileSync(join(here, "../../../../backend/src/lib/__tests__/fixtures/seedance-reference-auto-quote.json"), "utf8")) as {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: WorkflowEdge[]
      editorRequest: Record<string, unknown>
    }
    const nodes = fixture.nodes.map((n) => node(n.id, n.type, n.data))
    const g = nodes.find((n) => n.type === "generate-video")!
    expect(g.data).toMatchObject({ referenceTaskType: "reference", duration: VIDEO_DURATION_AUTO })
    expect(seedanceRefQuoteRequest(g, nodes, fixture.edges)).toStrictEqual(fixture.editorRequest)
  })

  // The editor's half of a second shared fixture: a Seedance 2.5 DRAFT that
  // declares The video to edit, fed one 6 s clip. The server's half (the same
  // backend test file) holds the estimate route's answer to `editorRequest`,
  // the run's reservation and the workflow estimate to one figure. The request
  // carries the draft and the declaration: the server resolves both, as the run does.
  it("a draft edit: the request is the fixture's, key for key, with Draft and the declaration both sent", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const fixture = JSON.parse(readFileSync(join(here, "../../../../backend/src/lib/__tests__/fixtures/seedance-draft-edit-quote.json"), "utf8")) as {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: WorkflowEdge[]
      editorRequest: Record<string, unknown>
    }
    const nodes = fixture.nodes.map((n) => node(n.id, n.type, n.data))
    const g = nodes.find((n) => n.type === "generate-video")!
    expect(g.data).toMatchObject({ referenceTaskType: "edit", draft: true })
    expect(seedanceRefQuoteRequest(g, nodes, fixture.edges)).toStrictEqual(fixture.editorRequest)
  })
})

describe("seedanceRefQuoteRequest — Kling 4.0 audio soundtrack", () => {
  const SONG = "https://cdn.example/song.mp3"
  const song = node("song", "upload-audio", { url: SONG })
  const gv = (data: Record<string, unknown> = {}) => node("gv", "generate-video", { provider: "kling-4", duration: 5, ...data })
  const audioWire = (source: string) => ({ ...edge(source, "gv", "audioReferences"), sourceHandle: "audio" }) as WorkflowEdge

  it("quotes the first audio clip as the soundtrack (a reference video) by default", () => {
    const g = gv()
    expect(seedanceRefQuoteRequest(g, [song, g], [audioWire("song")])).toEqual({
      provider: "kling-4", duration: 5, referenceVideoUrls: [], soundtrackAudioUrl: SONG,
    })
  })

  it("quotes a soundtrack not produced yet as unknown", () => {
    const g = gv()
    const pending = node("pending", "upload-audio", {})
    expect(seedanceRefQuoteRequest(g, [pending, g], [audioWire("pending")])?.unknownSoundtrack).toBe(true)
  })

  it("is undefined with the soundtrack off and no reference video — voice samples move no price", () => {
    const g = gv({ audioSoundtrack: false })
    expect(seedanceRefQuoteRequest(g, [song, g], [audioWire("song")])).toBeUndefined()
  })

  it("keys the soundtrack, so a changed track re-quotes", () => {
    const base = { provider: "kling-4", referenceVideoUrls: [] as string[] }
    expect(seedanceRefQuoteKey({ ...base, soundtrackAudioUrl: SONG })).not.toBe(seedanceRefQuoteKey({ ...base, soundtrackAudioUrl: "https://cdn.example/other.mp3" }))
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
