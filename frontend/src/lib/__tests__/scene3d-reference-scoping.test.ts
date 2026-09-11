/**
 * Scene3D layout references on the CANVAS — the frontend twin of
 * `backend/src/services/workflow-engine/__tests__/scene3d-reference-scoping.test.ts`.
 *
 * Rule 1 of the greybox doctrine says one scoping line per attached Scene3D
 * render, on that reference's own seat. The orchestrated DAG has said it since
 * the doctrine landed; the video node's own Run button and the Final-view
 * preview did not, so the same graph produced a scoped request through
 * "Run workflow" and an unscoped one through the node's Run — greybox in,
 * greybox out.
 *
 * These cases pin the two halves the canvas owns: the WALK (which wired
 * reference is a clay render, and which seat it landed on) and the PREVIEW
 * (the assembled prompt shows the line exactly as it is sent). The WORDING is
 * not re-asserted here beyond pinning to the shared fixture — it belongs to
 * `@nodaro/prompts`, and both engines read it from there.
 */
import { describe, it, expect } from "vitest"
import {
  SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE,
  SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE,
  SCENE3D_LAYOUT_SCOPING_MARKER,
  buildScene3DLayoutScopingLine,
} from "@nodaro/prompts"
import {
  appendScene3DStillScopingLines,
  collectScene3DLayoutReferences,
  scene3DLayoutVideoCaptions,
} from "@/lib/scene3d/reference-scoping"
import { assembleVideoPrompt } from "@/lib/video-prompt-assembly"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const MP4_A = "https://r2.example/renders/table.mp4"
const MP4_B = "https://r2.example/renders/street.mp4"
const STILL = "https://r2.example/frames/table-f0.png"
const UPLOAD = "https://r2.example/uploads/handheld.mp4"

/** A Pro (v2) composition: two people at a table, one shot. */
const V2_TWO_PEOPLE = {
  planType: "3d-scene",
  schemaVersion: 2,
  revisionId: "rev-table",
  objects: [
    { id: "a", name: "Green", role: "person" },
    { id: "b", name: "Purple", role: "person" },
  ],
  shots: [{ id: "s1", startFrame: 0, endFrameExclusive: 240 }],
}

/** A Pro composition cut into four shots. */
const V2_FOUR_SHOTS = {
  ...V2_TWO_PEOPLE,
  revisionId: "rev-street",
  shots: [
    { id: "s1", startFrame: 0, endFrameExclusive: 60 },
    { id: "s2", startFrame: 60, endFrameExclusive: 120 },
    { id: "s3", startFrame: 120, endFrameExclusive: 180 },
    { id: "s4", startFrame: 180, endFrameExclusive: 240 },
  ],
}

/** A Basic (v1) plan with a static camera — no move to claim. */
const V1_STATIC = {
  planType: "3d-scene",
  schemaVersion: 1,
  revisionId: "rev-basic",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [{ id: "hero", name: "Hero", primitive: "capsule" }],
}

const CONSUMER = "gv"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}
function edge(source: string, sourceHandle: string | null, targetHandle: string | null): WorkflowEdge {
  return { id: `${source}->${targetHandle ?? ""}`, source, target: CONSUMER, sourceHandle, targetHandle } as unknown as WorkflowEdge
}
/** A settled Pro node: the canvas keeps the result on the node's own data. */
function proNode(id: string, plan: Record<string, unknown>, videoUrl: string): WorkflowNode {
  return node(id, "pro-3d-render", { scenePlan: plan, generatedVideoUrl: videoUrl })
}

describe("the canvas walk — which reference is a Scene3D clay render", () => {
  it("seats each Pro clip on its own @video_N with what THAT clip carries", () => {
    const consumer = node(CONSUMER, "text-to-video", { provider: "seedance-2" })
    const nodes = [consumer, proNode("p1", V2_TWO_PEOPLE, MP4_A), proNode("p2", V2_FOUR_SHOTS, MP4_B)]
    const edges = [edge("p1", "video", "videoReferences"), edge("p2", "video", "videoReferences")]

    const refs = collectScene3DLayoutReferences(consumer, { referenceVideoUrls: [MP4_A, MP4_B] }, nodes, edges)
    expect(refs.map((r) => r.binding)).toEqual(["@video_1", "@video_2"])
    expect(refs.every((r) => r.carries === "clip")).toBe(true)

    const captions = scene3DLayoutVideoCaptions(refs, "Two people talk across a round table at dusk.")
    // The A/B fixture, verbatim, on the first seat.
    expect(captions?.[0]).toBe(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE)
    // The four-shot composition names its cut points on the second.
    expect(captions?.[1]).toBe(buildScene3DLayoutScopingLine({ carries: "clip", shots: 4, includesCameraMotion: true }))
    expect(captions?.[1]).toContain("its 4 shots and where they cut")
  })

  it("does not claim a camera move a Basic scene does not make", () => {
    const consumer = node(CONSUMER, "text-to-video", { provider: "seedance-2" })
    const render = node("r1", "render-video", { plan: V1_STATIC, generatedVideoUrl: MP4_A })
    const refs = collectScene3DLayoutReferences(
      consumer, { referenceVideoUrls: [MP4_A] }, [consumer, render], [edge("r1", "video", "videoReferences")],
    )
    expect(refs).toHaveLength(1)
    const caption = scene3DLayoutVideoCaptions(refs, undefined)?.[0]
    expect(caption).toBe(buildScene3DLayoutScopingLine({ carries: "clip" }))
    expect(caption).not.toContain("camera move")
  })

  it("finds the render behind a Render Video node fed by a 3D composer", () => {
    const consumer = node(CONSUMER, "text-to-video", { provider: "seedance-2" })
    const composer = node("c1", "generate-3d-scene", { scenePlan: V2_FOUR_SHOTS })
    const render = node("r1", "render-video", { generatedVideoUrl: MP4_A })
    const edges = [
      edge("r1", "video", "videoReferences"),
      { id: "c->r", source: "c1", target: "r1", sourceHandle: null, targetHandle: null } as unknown as WorkflowEdge,
    ]
    const refs = collectScene3DLayoutReferences(
      consumer, { referenceVideoUrls: [MP4_A] }, [consumer, composer, render], edges,
    )
    expect(refs).toHaveLength(1)
    expect(scene3DLayoutVideoCaptions(refs, undefined)?.[0]).toContain("its 4 shots and where they cut")
  })

  it("adds nothing when the video reference is not a Scene3D render", () => {
    const consumer = node(CONSUMER, "text-to-video", { provider: "seedance-2" })
    const upload = node("u1", "upload-video", { videoUrl: UPLOAD })
    const refs = collectScene3DLayoutReferences(
      consumer, { referenceVideoUrls: [UPLOAD] }, [consumer, upload], [edge("u1", null, "videoReferences")],
    )
    expect(refs).toEqual([])
    expect(scene3DLayoutVideoCaptions(refs, "A handheld walk through a market.")).toBeUndefined()
    expect(appendScene3DStillScopingLines("A handheld walk through a market.", refs))
      .toBe("A handheld walk through a market.")
  })

  it("never binds a seat the payload does not ship", () => {
    // The clip is wired, but the resolved list does not carry it — a phantom
    // `@video_1` would scope a reference the model never receives.
    const consumer = node(CONSUMER, "text-to-video", { provider: "seedance-2" })
    const refs = collectScene3DLayoutReferences(
      consumer, { referenceVideoUrls: [] }, [consumer, proNode("p1", V2_TWO_PEOPLE, MP4_A)],
      [edge("p1", "video", "videoReferences")],
    )
    expect(refs).toEqual([])
  })

  it("scopes a still on its image seat, appended to the body in rendered form", () => {
    const consumer = node(CONSUMER, "image-to-video", { provider: "seedance-2" })
    const frame = node("f1", "extract-frame", { extractedFrameUrl: STILL, generatedImageUrl: STILL })
    const edges = [
      edge("f1", null, "imageReferences"),
      { id: "p->f", source: "p1", target: "f1", sourceHandle: "video", targetHandle: null } as unknown as WorkflowEdge,
    ]
    const nodes = [consumer, frame, proNode("p1", V2_TWO_PEOPLE, MP4_A)]
    const refs = collectScene3DLayoutReferences(consumer, { referenceImageUrls: [STILL] }, nodes, edges)
    expect(refs).toHaveLength(1)
    expect(refs[0].binding).toBe("@image_1")
    expect(refs[0].carries).toBe("still")
    // A still has no caption seat.
    expect(scene3DLayoutVideoCaptions(refs, undefined)).toBeUndefined()
    expect(appendScene3DStillScopingLines("A slow push in.", refs))
      .toBe(`A slow push in.\n${SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.stillRendered}`)
  })

  it("adds no second line for a seat the prompt already scopes, by hand or by us", () => {
    const consumer = node(CONSUMER, "text-to-video", { provider: "seedance-2" })
    const refs = collectScene3DLayoutReferences(
      consumer, { referenceVideoUrls: [MP4_A] }, [consumer, proNode("p1", V2_TWO_PEOPLE, MP4_A)],
      [edge("p1", "video", "videoReferences")],
    )
    expect(refs).toHaveLength(1)
    const typed = "A car turns the corner.\n@video_1 is a LAYOUT reference only: match its blocking."
    expect(scene3DLayoutVideoCaptions(refs, typed)).toBeUndefined()
    const stored = `A car turns the corner.\n${SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered}`
    expect(scene3DLayoutVideoCaptions(refs, stored)).toBeUndefined()
  })
})

describe("the Final-view preview shows the line it will send", () => {
  const consumer = node(CONSUMER, "text-to-video", {
    label: "Video",
    provider: "seedance-2",
    prompt: "Two people talk across a round table at dusk.",
  })
  const nodes = [consumer, proNode("p1", V2_TWO_PEOPLE, MP4_A)]
  const edges = [edge("p1", "video", "videoReferences")]

  it("renders the clip's caption on its seat", () => {
    const preview = assembleVideoPrompt("text-to-video", {
      node: consumer, nodes, edges, refMap: new Map(),
      inputs: { referenceVideoUrls: [MP4_A] },
    })
    expect(preview).toContain("Two people talk across a round table at dusk.")
    expect(preview).toContain(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered)
    // Exactly one line for one reference.
    expect(preview.match(new RegExp(SCENE3D_LAYOUT_SCOPING_MARKER, "g"))?.length).toBe(1)
  })

  it("is byte-identical to today's preview when nothing Scene3D is wired", () => {
    const plain = node("gv2", "text-to-video", { label: "Video", provider: "seedance-2", prompt: "A market at noon." })
    const withInputs = assembleVideoPrompt("text-to-video", {
      node: plain, nodes: [plain], edges: [], refMap: new Map(), inputs: { referenceVideoUrls: [UPLOAD] },
    })
    const without = assembleVideoPrompt("text-to-video", { node: plain, nodes: [plain], edges: [], refMap: new Map() })
    expect(withInputs).toBe(without)
    expect(withInputs).not.toContain(SCENE3D_LAYOUT_SCOPING_MARKER)
  })

  it("shows no line when the caller could not resolve the reference lists", () => {
    // No `inputs` → no seat can be known, so the preview stays as it was
    // rather than showing a line on a guessed seat.
    const preview = assembleVideoPrompt("text-to-video", { node: consumer, nodes, edges, refMap: new Map() })
    expect(preview).not.toContain(SCENE3D_LAYOUT_SCOPING_MARKER)
  })
})
