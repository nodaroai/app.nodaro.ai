/**
 * Video subjects on a WORKFLOW RUN (decided 2026-11-13): a Character node's
 * own clip (`subjectVideoUrl`) makes it a video subject on Kling 4.0 / Kling
 * 4.0 Flash. The payload builder seats the clip among the reference videos by
 * the rule /v1/generate-video's precheck applies (`seatCharacterVideos`), so
 * the DAG's duration gate, its reservation and the settlement measure and
 * price it as a reference video; the job the worker receives, run through the
 * KIE body builder, sends it as the character's element.
 *
 * Every case runs the real input resolver, then the payload builder, as the
 * orchestrator does.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { buildKling4Request } from "../../../providers/kie/kling4.js"
import type { VideoCharacterReference } from "@nodaro/shared/video"

const portrait = (id: string) => `https://cdn.example/${id}-portrait.png`
const smile = (id: string) => `https://cdn.example/${id}-smile.png`
const clip = (id: string) => `https://cdn.example/${id}-clip.mp4`
const ROOM = "https://cdn.example/room.mp4"

function character(id: string, extra: Record<string, unknown> = {}): SimpleNode {
  return {
    id,
    type: "character",
    data: {
      label: "Character Asset",
      characterName: id === "m" ? "Maya" : id === "l" ? "Leo" : "",
      description: "",
      sourceImageUrl: portrait(id),
      canonicalDescription: `the ${id} look`,
      expressions: [{ name: "smile", url: smile(id) }],
      ...extra,
    },
  }
}
const video = (provider: string, data: Record<string, unknown> = {}): SimpleNode =>
  ({ id: "gv", type: "generate-video", data: { provider, prompt: "they walk out into the rain", duration: 5, ...data } })
const room: SimpleNode = { id: "room", type: "upload-video", data: { url: ROOM, videoUrl: ROOM } }

function run(consumer: SimpleNode, chars: SimpleNode[], opts: { refVideo?: boolean } = {}) {
  const nodes = [consumer, ...chars, ...(opts.refVideo ? [room] : [])]
  const edges: SimpleEdge[] = [
    ...chars.map((c) => ({ id: `${c.id}->gv`, source: c.id, target: "gv", sourceHandle: "characterRef", targetHandle: "assets" })),
    ...(opts.refVideo ? [{ id: "room->gv", source: "room", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }] : []),
  ]
  const nodeStates: Record<string, NodeExecutionState> = {}
  for (const n of nodes.slice(1)) nodeStates[n.id] = { status: "completed", output: extractSavedNodeOutput(n) } as NodeExecutionState
  const inputs = resolveNodeInputs(consumer, edges, nodeStates, nodes)
  const r = buildPayload(consumer, "job-1", inputs, undefined, { nodes, edges, nodeStates })
  const p = r.payload as Record<string, unknown>
  return {
    r,
    p,
    videos: p.referenceVideoUrls as string[] | undefined,
    subjects: p.characterReferences as VideoCharacterReference[] | undefined,
  }
}

describe("a Character node's clip on a workflow run", () => {
  // Decided 2026-11-14, measured: Flash bills a video subject like an image subject.
  it("Kling 4.0 Flash: the character carries the clip and the clip is seated, but the run keeps the plain price", () => {
    const { videos, subjects, r } = run(video("kling-4-flash"), [character("m", { subjectVideoUrl: clip("m") })])
    expect(subjects?.map((s) => [s.name, s.videoUrl])).toEqual([["Maya", clip("m")]])
    expect(videos).toEqual([clip("m")])
    expect(r.modelIdentifier).toBe("kling-4-flash:5s:720p")
    expect(r.modelIdentifier).toBe(run(video("kling-4-flash"), [character("m")]).r.modelIdentifier)
  })

  it("Kling 4.0 Flash: a wired reference video that is also the character's clip goes as the character only — the plain price", () => {
    const { videos, r } = run(video("kling-4-flash"), [character("m", { subjectVideoUrl: ROOM })], { refVideo: true })
    expect(videos).toEqual([ROOM])
    expect(r.modelIdentifier).toBe("kling-4-flash:5s:720p")
    // Kling 4.0 keeps pricing it as a reference video.
    expect(run(video("kling-4"), [character("m", { subjectVideoUrl: ROOM })], { refVideo: true }).r.modelIdentifier).toMatch(/-ref$/)
  })

  it("Kling 4.0: the clip is seated and the run is priced as a reference-video run", () => {
    const { videos, r } = run(video("kling-4"), [character("m", { subjectVideoUrl: clip("m") })])
    expect(videos).toEqual([clip("m")])
    expect(r.modelIdentifier).toMatch(/-ref$/)
  })

  it("Kling 4.0 with a wired reference video: the clip follows it, and KIE gets the reference video plus a video element", () => {
    const { p, videos, subjects } = run(video("kling-4", { prompt: "@video_1 is the room" }), [character("m", { subjectVideoUrl: clip("m") }), character("l")], { refVideo: true })
    expect(videos).toEqual([ROOM, clip("m")])
    const { input } = buildKling4Request({
      provider: "kling-4",
      prompt: p.prompt as string,
      durationSec: 5,
      referenceImageUrls: p.referenceImageUrls as string[] | undefined,
      referenceVideoUrls: videos,
      characterReferences: subjects,
    })
    expect(input.video_urls).toEqual([ROOM])
    expect((input.elements as Array<Record<string, unknown>>).map((e) => [e.name, e.video_url, e.image_urls, e.type])).toEqual([
      ["Maya", clip("m"), undefined, undefined],
      ["Leo", undefined, [portrait("l"), smile("l")], undefined],
    ])
    // Every image seat belongs to a subject: none is sent as a plain image.
    expect(input.image_urls).toBeUndefined()
  })

  it("a model that takes no video subjects ignores the clip: the run is exactly the node's without one", () => {
    for (const provider of ["seedance-2", "minimax-h3", "gemini-omni-flash"]) {
      const withClip = run(video(provider), [character("m", { subjectVideoUrl: clip("m") })])
      const without = run(video(provider), [character("m")])
      expect(withClip.p, provider).toEqual(without.p)
      expect(withClip.r.modelIdentifier).toBe(without.r.modelIdentifier)
    }
  })

  it("without a clip the Kling run is unchanged (no reference videos added)", () => {
    const { videos, subjects, r } = run(video("kling-4"), [character("m")])
    expect(videos).toBeUndefined()
    expect(subjects?.[0]).not.toHaveProperty("videoUrl")
    expect(r.modelIdentifier).not.toMatch(/-ref$/)
  })

  // Decided 2026-11-13: a 6th video is refused, never dropped without a word.
  it("6 wired reference videos on Kling 4.0 / Flash are refused before any job; Generate Video and the legacy video nodes alike", () => {
    const clips = [1, 2, 3, 4, 5, 6].map((n): SimpleNode => ({ id: `v${n}`, type: "upload-video", data: { url: `https://cdn.example/v${n}.mp4`, videoUrl: `https://cdn.example/v${n}.mp4` } }))
    for (const consumer of [video("kling-4"), video("kling-4-flash"), { ...video("kling-4"), type: "text-to-video" }]) {
      const nodes = [consumer, ...clips]
      const edges: SimpleEdge[] = clips.map((c) => ({ id: `${c.id}->gv`, source: c.id, target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }))
      const nodeStates: Record<string, NodeExecutionState> = {}
      for (const n of clips) nodeStates[n.id] = { status: "completed", output: extractSavedNodeOutput(n) } as NodeExecutionState
      const inputs = resolveNodeInputs(consumer, edges, nodeStates, nodes)
      expect(inputs.referenceVideoUrls, consumer.type).toHaveLength(6)
      expect(() => buildPayload(consumer, "job-1", inputs, undefined, { nodes, edges, nodeStates }), `${consumer.type} ${consumer.data.provider}`).toThrow(/at most 5 videos in all/)
    }
  })

  it("refused before any job or reservation: more than 3 clips, two characters on one clip", () => {
    const four = ["a", "b", "c", "d"].map((id) => character(id, { characterName: `C${id}`, subjectVideoUrl: clip(id) }))
    expect(() => run(video("kling-4"), four)).toThrow(/at most 3 characters made from a video/)
    const shared = [character("m", { subjectVideoUrl: clip("x") }), character("l", { subjectVideoUrl: clip("x") })]
    expect(() => run(video("kling-4-flash"), shared)).toThrow(/same video/)
  })
})
