// @test-units-by-name prices the node types it names (character, upload-video, generate-video)
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The server's workflow estimate (the run estimate, the published-app listing)
 * prices a Kling 4.0 / Flash run whose wired Character carries its own clip
 * (a video subject) exactly like the same run with that clip wired as a
 * reference video: the run seats the clip among its reference videos, and KIE
 * bills a video subject's seconds as reference-video seconds (decided
 * 2026-11-13).
 */

const probe = vi.hoisted(() => ({ durations: new Map<string, number>() }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
}))
vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 40 }) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { CreditsService } from "../credits.js"
import { __forgetUploadClipLengths, knownClipUrl } from "../upload-clip-lengths.js"
import { refVideoClipSources } from "../seedance-ref-video-estimate.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveNodeInputs } from "../../../services/workflow-engine/input-resolver.js"
import { extractSavedNodeOutput } from "../../../services/workflow-engine/output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../../../services/workflow-engine/types.js"
import { characterVideoUrls } from "@nodaro/shared/video"

const CLIP = "https://cdn.example/maya.mp4"
type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { source: string; target: string; sourceHandle: string; targetHandle: string }
const video = (provider: string): Node => ({ id: "gv", type: "generate-video", data: { provider, duration: 5, resolution: "720p", prompt: "Maya walks" } })
const maya = (data: Record<string, unknown> = {}): Node => ({
  id: "maya", type: "character", data: { label: "Character Asset", characterName: "Maya", sourceImageUrl: "https://cdn.example/maya.png", ...data },
})
const upload: Node = { id: "clip", type: "upload-video", data: { url: CLIP } }
const characterWire: Edge = { source: "maya", target: "gv", sourceHandle: "characterRef", targetHandle: "assets" }
const videoWire: Edge = { source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }
const estimate = (nodes: Node[], edges: Edge[]) => CreditsService.estimateWorkflowCredits(nodes, edges)

beforeEach(() => {
  __forgetUploadClipLengths()
  probe.durations = new Map([[CLIP, 5]])
})

describe("workflow estimate — a Character's clip on Kling 4.0", () => {
  it("kling-4: priced as the same clip wired as a reference video", async () => {
    const withSubject = (await estimate([maya({ subjectVideoUrl: CLIP }), video("kling-4")], [characterWire])) - (await estimate([maya({ subjectVideoUrl: CLIP })], []))
    const withClip = (await estimate([maya(), upload, video("kling-4")], [characterWire, videoWire])) - (await estimate([maya(), upload], []))
    expect(withSubject).toBe(withClip)
    const plain = (await estimate([maya(), video("kling-4")], [characterWire])) - (await estimate([maya()], []))
    expect(withSubject).not.toBe(plain)
  })

  // Decided 2026-11-14, measured: Flash bills a video subject like an image subject.
  it("kling-4-flash: priced as the same character without the clip", async () => {
    const withSubject = (await estimate([maya({ subjectVideoUrl: CLIP }), video("kling-4-flash")], [characterWire])) - (await estimate([maya({ subjectVideoUrl: CLIP })], []))
    const plain = (await estimate([maya(), video("kling-4-flash")], [characterWire])) - (await estimate([maya()], []))
    expect(withSubject).toBe(plain)
    const withClip = (await estimate([maya(), upload, video("kling-4-flash")], [characterWire, videoWire])) - (await estimate([maya(), upload], []))
    expect(withSubject).not.toBe(withClip)
  })

  it("kling-4-flash: a wired upload that is also the character's clip is priced as the character only (plain)", async () => {
    const withBoth = (await estimate([maya({ subjectVideoUrl: CLIP }), upload, video("kling-4-flash")], [characterWire, videoWire])) - (await estimate([maya({ subjectVideoUrl: CLIP }), upload], []))
    const plain = (await estimate([maya(), video("kling-4-flash")], [characterWire])) - (await estimate([maya()], []))
    expect(withBoth).toBe(plain)
    // On Kling 4.0 it stays one reference video: the same as the clip wired alone.
    const k4Both = (await estimate([maya({ subjectVideoUrl: CLIP }), upload, video("kling-4")], [characterWire, videoWire])) - (await estimate([maya({ subjectVideoUrl: CLIP }), upload], []))
    const k4Clip = (await estimate([maya(), upload, video("kling-4")], [characterWire, videoWire])) - (await estimate([maya(), upload], []))
    expect(k4Both).toBe(k4Clip)
  })

  it("a model that takes no video subjects prices the node as without the clip", async () => {
    const withClip = await estimate([maya({ subjectVideoUrl: CLIP }), video("seedance-2")], [characterWire])
    const without = await estimate([maya(), video("seedance-2")], [characterWire])
    expect(withClip).toBe(without)
  })
})

/**
 * Parity with the RUN (decided 2026-11-13): the estimate names exactly the
 * character clips the workflow run's payload seats — read off the real input
 * resolver and payload builder, not off another estimate — and prices the
 * same as the run's own reference videos wired as uploads. Two balance checks
 * read this estimate (an app run's Retry, render-final), so it must never
 * name a clip the run leaves out.
 */
describe("workflow estimate — the character clips are the run's", () => {
  const clipOf = (n: number) => `https://cdn.example/clip-${n}.mp4`
  const characterNode = (n: number, data: Record<string, unknown> = {}): Node => ({
    id: `c${n}`, type: "character", data: { label: "Character Asset", characterName: `Person ${n}`, sourceImageUrl: `https://cdn.example/p${n}.png`, ...data },
  })
  const wireOf = (n: number): Edge => ({ source: `c${n}`, target: "gv", sourceHandle: "characterRef", targetHandle: "assets" })

  /** The clips the run seats as subjects: built by the real input resolver and payload builder. */
  function runSubjectClips(nodes: Node[], edges: Edge[]): string[] {
    const simpleEdges: SimpleEdge[] = edges.map((e, i) => ({ id: `e${i}`, ...e }))
    const consumer = nodes.find((n) => n.id === "gv")! as SimpleNode
    const nodeStates: Record<string, NodeExecutionState> = {}
    for (const n of nodes) if (n.id !== "gv") nodeStates[n.id] = { status: "completed", output: extractSavedNodeOutput(n as SimpleNode) } as NodeExecutionState
    const inputs = resolveNodeInputs(consumer, simpleEdges, nodeStates, nodes as SimpleNode[])
    const payload = buildPayload(consumer, "job-1", inputs, undefined, { nodes: nodes as SimpleNode[], edges: simpleEdges, nodeStates }).payload as Record<string, unknown>
    const seated = (payload.referenceVideoUrls as string[] | undefined) ?? []
    return characterVideoUrls(payload.characterReferences as unknown[] | undefined).filter((u) => seated.includes(u))
  }
  /** The clips the estimate names for the character subjects (its pseudo-upload sources). */
  const estimateSubjectClips = (nodes: Node[], edges: Edge[]) =>
    refVideoClipSources(nodes, edges).map((s) => knownClipUrl(s)).filter((u): u is string => !!u && u.includes("clip-"))
  /** The same Generate Video node with the run's clips wired as uploads, and no character clip. */
  async function asUploads(provider: string, clips: string[], characters: Node[], characterEdges: Edge[]): Promise<number> {
    const uploads = clips.map((url, i): Node => ({ id: `u${i}`, type: "upload-video", data: { url } }))
    const plain = characters.map((c) => ({ ...c, data: { ...c.data, subjectVideoUrl: undefined } }))
    const edges = [...characterEdges, ...uploads.map((u): Edge => ({ source: u.id, target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }))]
    return (await estimate([...plain, ...uploads, video(provider)], edges)) - (await estimate([...plain, ...uploads], []))
  }

  beforeEach(() => {
    probe.durations = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [clipOf(n), 4 + (n % 3)]))
  })

  it("a portrait and a clip on Kling 4.0: the run seats it, the estimate names it and prices it as the run's upload", async () => {
    const chars = [characterNode(1, { subjectVideoUrl: clipOf(1) }), characterNode(2)]
    const edges = [wireOf(1), wireOf(2)]
    const nodes = [...chars, video("kling-4")]
    expect(runSubjectClips(nodes, edges)).toEqual([clipOf(1)])
    expect(estimateSubjectClips(nodes, edges)).toEqual([clipOf(1)])
    const withSubject = (await estimate(nodes, edges)) - (await estimate(chars, []))
    expect(withSubject).toBe(await asUploads("kling-4", [clipOf(1)], chars, edges))
  })

  it("a portrait and a clip on Flash: the run seats it, but it is not priced — and the estimate names none", async () => {
    const chars = [characterNode(1, { subjectVideoUrl: clipOf(1) }), characterNode(2)]
    const edges = [wireOf(1), wireOf(2)]
    const nodes = [...chars, video("kling-4-flash")]
    expect(runSubjectClips(nodes, edges)).toEqual([clipOf(1)])
    expect(estimateSubjectClips(nodes, edges)).toEqual([])
    const withSubject = (await estimate(nodes, edges)) - (await estimate(chars, []))
    expect(withSubject).toBe(await asUploads("kling-4-flash", [], chars, edges))
  })

  it("a clip on a Character with no image at all: the run makes no character of it, the estimate names no clip", async () => {
    const chars = [characterNode(1, { sourceImageUrl: "", subjectVideoUrl: clipOf(1) }), characterNode(2)]
    const edges = [wireOf(1), wireOf(2)]
    const nodes = [...chars, video("kling-4")]
    expect(runSubjectClips(nodes, edges)).toEqual([])
    expect(estimateSubjectClips(nodes, edges)).toEqual([])
    expect((await estimate(nodes, edges)) - (await estimate(chars, []))).toBe(await asUploads("kling-4", [], chars, edges))
  })

  it("the older Text to Video / Image to Video nodes carry no video subject, in the run and in the estimate", async () => {
    for (const type of ["text-to-video", "image-to-video"]) {
      const chars = [characterNode(1, { subjectVideoUrl: clipOf(1) })]
      const legacy: Node = { id: "gv", type, data: { provider: "kling-4", duration: 5, resolution: "720p", prompt: "Maya walks" } }
      const nodes = [...chars, legacy]
      expect(runSubjectClips(nodes, [wireOf(1)]), type).toEqual([])
      expect(estimateSubjectClips(nodes, [wireOf(1)]), type).toEqual([])
    }
  })

  it("a clip that is also a wired generation's result is that one seat, in the run and in the estimate", async () => {
    const gen: Node = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 5, generatedResults: [{ url: clipOf(1) }], activeResultIndex: 0 } }
    const chars = [characterNode(1, { subjectVideoUrl: clipOf(1) })]
    const edges = [wireOf(1), { source: "g", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }]
    const nodes = [gen, ...chars, video("kling-4")]
    expect(runSubjectClips(nodes, edges)).toEqual([clipOf(1)])
    expect(estimateSubjectClips(nodes, edges)).toEqual([])
    // The generation's clip stays the one wired source the estimate prices.
    expect(refVideoClipSources(nodes, edges).map((n) => n?.id)).toEqual(["g"])
  })

  it("more than 7 characters: a clip past the run's 7th character is left out of both", async () => {
    const chars = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => characterNode(n, n === 2 || n === 8 ? { subjectVideoUrl: clipOf(n) } : {}))
    const edges = chars.map((_, i) => wireOf(i + 1))
    const nodes = [...chars, video("kling-4")]
    expect(runSubjectClips(nodes, edges)).toEqual([clipOf(2)])
    expect(estimateSubjectClips(nodes, edges)).toEqual([clipOf(2)])
    const withSubjects = (await estimate(nodes, edges)) - (await estimate(chars, []))
    expect(withSubjects).toBe(await asUploads("kling-4", [clipOf(2)], chars, edges))
  })
})
