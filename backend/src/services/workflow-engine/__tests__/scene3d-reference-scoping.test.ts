/**
 * Scene3D layout references on the ORCHESTRATED video path — the two greybox
 * rules (2026-09-10 experiment) wired through `buildPayload`:
 *
 *   1. one scoping line per attached Scene3D render, on the reference's own
 *      seat (`@video_N: …` for a clip, `@image_N: …` for a still), never
 *      doubled on a re-run, and NOTHING added when no Scene3D render is wired;
 *   2. the `scene3d_unreferenced_figures` warning on the payload — hence on
 *      the job row — when a v2 composition shows more `person` entities than
 *      the run carries character references. A warning, never a refusal.
 *
 * The docs quote the exact line; the last block pins them to the fixture.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared"
import {
  SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE,
  SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE,
  SCENE3D_LAYOUT_SCOPING_MARKER,
  SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE,
  buildScene3DLayoutScopingLine,
} from "@nodaro/prompts"
import { buildPayload } from "../payload-builder.js"
import type { NodeExecutionState, ResolvedInputs, SimpleEdge, SimpleNode } from "../types.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROVIDER = "seedance-2"
const MP4_A = "https://r2.example/renders/table.mp4"
const MP4_B = "https://r2.example/renders/street.mp4"
const FRAME = "https://r2.example/frames/table-f493.png"
const UPLOAD = "https://r2.example/uploads/handheld.mp4"

/** A Pro (v2) composition: two people at a table, one shot. Structural — the
 *  scoping walk reads the version marker, the entity roles and the shot list,
 *  never the full plan schema. */
const V2_TWO_PEOPLE = {
  planType: "3d-scene",
  schemaVersion: 2,
  revisionId: "rev-table",
  objects: [
    { id: "a", name: "Green", role: "person" },
    { id: "b", name: "Purple", role: "person" },
    { id: "t", name: "Table", role: "prop" },
  ],
  shots: [{ id: "s1", startFrame: 0, endFrameExclusive: 240 }],
}

/** A Pro composition cut into four shots. */
const V2_FOUR_SHOTS = {
  ...V2_TWO_PEOPLE,
  revisionId: "rev-street",
  objects: [{ id: "c", name: "Car", role: "vehicle" }],
  shots: [
    { id: "s1", startFrame: 0, endFrameExclusive: 60 },
    { id: "s2", startFrame: 60, endFrameExclusive: 120 },
    { id: "s3", startFrame: 120, endFrameExclusive: 180 },
    { id: "s4", startFrame: 180, endFrameExclusive: 240 },
  ],
}

/** A Basic (v1) plan with a static camera and no entity roles. */
const V1_STATIC = {
  planType: "3d-scene",
  schemaVersion: 1,
  revisionId: "rev-basic",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [{ id: "hero", name: "Hero", primitive: "capsule" }],
}

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(source: string, target: string, sourceHandle: string | null, targetHandle: string | null): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle ?? ""}`, source, target, sourceHandle, targetHandle }
}

function charNode(id: string, name: string): SimpleNode {
  return node(id, "character", {
    label: name,
    characterName: name,
    sourceImageUrl: `https://r2.example/chars/${id}-source.png`,
    canonicalDescription: `${name}, distinctive`,
    defaultAssetUrl: `https://r2.example/chars/${id}.png`,
    expressions: [],
    poses: [],
    motions: [],
    angles: [],
    bodyAngles: [],
    lightingVariations: [],
  })
}

function proNode(id: string, plan: Record<string, unknown>): SimpleNode {
  return node(id, "pro-3d-render", { scenePlan: plan })
}

const ran = (output: NodeExecutionState["output"]): NodeExecutionState => ({ status: "completed", output })

interface Graph {
  nodes: SimpleNode[]
  edges: SimpleEdge[]
  nodeStates: Record<string, NodeExecutionState>
}

const CONSUMER = "gv"

function build(type: string, data: Record<string, unknown>, inputs: ResolvedInputs, graph: Graph) {
  const consumer = node(CONSUMER, type, { provider: PROVIDER, ...data })
  return buildPayload(consumer, "job-1", inputs, undefined, { nodes: [consumer, ...graph.nodes], edges: graph.edges, nodeStates: graph.nodeStates })
}

const CLIP_LINE = `@video_1: ${SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE}.`

// ---------------------------------------------------------------------------
// Rule 1 — one scoping line per Scene3D reference, on its own seat
// ---------------------------------------------------------------------------

describe("rule 1 — a scoping line per Scene3D layout reference", () => {
  it("captions each Pro clip on its @video_N seat with what THAT clip carries", () => {
    const result = build(
      "generate-video",
      { prompt: "Two people talk across a round table at dusk." },
      { referenceVideoUrls: [MP4_A, MP4_B] },
      {
        nodes: [proNode("p1", V2_TWO_PEOPLE), proNode("p2", V2_FOUR_SHOTS)],
        edges: [edge("p1", CONSUMER, "video", "videoReferences"), edge("p2", CONSUMER, "video", "videoReferences")],
        nodeStates: { p1: ran({ videoUrl: MP4_A, plan: V2_TWO_PEOPLE }), p2: ran({ videoUrl: MP4_B, plan: V2_FOUR_SHOTS }) },
      },
    )
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("Two people talk across a round table at dusk.")
    // The A/B fixture, verbatim, on the first seat.
    expect(prompt).toContain(CLIP_LINE)
    expect(prompt).toContain(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered)
    // The four-shot composition names its cut points on the second seat.
    expect(prompt).toContain(`@video_2: ${buildScene3DLayoutScopingLine({ carries: "clip", shots: 4, includesCameraMotion: true })}.`)
    expect(prompt).toContain("its 4 shots and where they cut")
    // Exactly one line per reference.
    expect(prompt.match(new RegExp(SCENE3D_LAYOUT_SCOPING_MARKER, "g"))?.length).toBe(2)
    // The references themselves ship untouched.
    expect(result.payload.referenceVideoUrls).toEqual([MP4_A, MP4_B])
  })

  it("leaves the prompt byte-identical when the video reference is not a Scene3D render", () => {
    const withUpload = build(
      "generate-video",
      { prompt: "A handheld walk through a market." },
      { referenceVideoUrls: [UPLOAD] },
      {
        nodes: [node("u1", "upload-video", { videoUrl: UPLOAD })],
        edges: [edge("u1", CONSUMER, null, "videoReferences")],
        nodeStates: { u1: ran({ videoUrl: UPLOAD }) },
      },
    )
    const without = build("generate-video", { prompt: "A handheld walk through a market." }, {}, { nodes: [], edges: [], nodeStates: {} })
    expect(withUpload.payload.prompt).toBe(without.payload.prompt)
    expect(withUpload.payload.prompt).not.toContain(SCENE3D_LAYOUT_SCOPING_MARKER)
    expect(withUpload.payload).not.toHaveProperty("warnings")
  })

  it("does not double a line the prompt already carries for that seat, and is stable across re-runs", () => {
    const graph: Graph = {
      nodes: [proNode("p1", V2_FOUR_SHOTS)],
      edges: [edge("p1", CONSUMER, "video", "videoReferences")],
      nodeStates: { p1: ran({ videoUrl: MP4_A, plan: V2_FOUR_SHOTS }) },
    }
    // A hand-typed scoping sentence for the same seat counts as present.
    const typed = build(
      "generate-video",
      { prompt: "A car turns the corner.\n@video_1 is a LAYOUT reference only: match its blocking." },
      { referenceVideoUrls: [MP4_A] },
      graph,
    )
    expect((typed.payload.prompt as string).match(new RegExp(SCENE3D_LAYOUT_SCOPING_MARKER, "g"))?.length).toBe(1)
    // The platform's own rendered line, stored back into the prompt, is not added again either.
    const stored = build(
      "generate-video",
      { prompt: `A car turns the corner.\n${SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered}` },
      { referenceVideoUrls: [MP4_A] },
      graph,
    )
    expect((stored.payload.prompt as string).match(new RegExp(SCENE3D_LAYOUT_SCOPING_MARKER, "g"))?.length).toBe(1)
    // Pure: the same graph builds the same prompt twice.
    const again = build("generate-video", { prompt: "A car turns the corner." }, { referenceVideoUrls: [MP4_A] }, graph)
    const once = build("generate-video", { prompt: "A car turns the corner." }, { referenceVideoUrls: [MP4_A] }, graph)
    expect(again.payload.prompt).toBe(once.payload.prompt)
  })

  it("scopes a Render Video export of a Basic scene, without claiming a camera move the scene does not make", () => {
    const result = build(
      "text-to-video",
      { prompt: "A lone figure in a warehouse." },
      { referenceVideoUrls: [MP4_A] },
      {
        nodes: [node("g1", "generate-3d-scene", { scenePlan: V1_STATIC }), node("rv", "render-video", { planType: "3d-scene" })],
        edges: [edge("g1", "rv", null, "scene"), edge("rv", CONSUMER, null, "videoReferences")],
        nodeStates: { g1: ran({ plan: V1_STATIC }), rv: ran({ videoUrl: MP4_A }) },
      },
    )
    const prompt = result.payload.prompt as string
    expect(prompt).toContain(`@video_1: ${buildScene3DLayoutScopingLine({ carries: "clip", includesCameraMotion: false })}.`)
    expect(prompt).not.toContain("camera motion")
    // v1 has no entity roles → nothing to warn about.
    expect(result.payload).not.toHaveProperty("warnings")
  })

  it("scopes a frame extracted from a Pro render on its @image_N seat, as a still", () => {
    const result = build(
      "image-to-video",
      { prompt: "Two people talk across a round table." },
      { imageUrl: "https://r2.example/start.png", referenceImageUrls: [FRAME] },
      {
        nodes: [proNode("p1", V2_TWO_PEOPLE), node("ef", "extract-frame", { mode: "first" })],
        edges: [edge("p1", "ef", "video", "video"), edge("ef", CONSUMER, null, "imageReferences")],
        nodeStates: { p1: ran({ videoUrl: MP4_A, plan: V2_TWO_PEOPLE }), ef: ran({ imageUrl: FRAME }) },
      },
    )
    const prompt = result.payload.prompt as string
    expect(prompt.endsWith(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.stillRendered)).toBe(true)
    expect(prompt).not.toContain("its timing")
  })

  it("gives a clip no line when its URL did not reach the reference list — never a phantom seat", () => {
    const result = build(
      "generate-video",
      { prompt: "x" },
      { referenceVideoUrls: [UPLOAD] },
      {
        nodes: [proNode("p1", V2_TWO_PEOPLE)],
        edges: [edge("p1", CONSUMER, "video", "videoReferences")],
        nodeStates: { p1: ran({ videoUrl: MP4_A, plan: V2_TWO_PEOPLE }) },
      },
    )
    expect(result.payload.prompt).not.toContain(SCENE3D_LAYOUT_SCOPING_MARKER)
  })
})

// ---------------------------------------------------------------------------
// Rule 2 — one character reference per figure, as a warning
// ---------------------------------------------------------------------------

describe("rule 2 — the scene3d_unreferenced_figures warning", () => {
  const graphWith = (characters: SimpleNode[]): Graph => ({
    nodes: [proNode("p1", V2_TWO_PEOPLE), ...characters],
    edges: [
      edge("p1", CONSUMER, "video", "videoReferences"),
      ...characters.map((c) => edge(c.id, CONSUMER, null, "imageReferences")),
    ],
    nodeStates: { p1: ran({ videoUrl: MP4_A, plan: V2_TWO_PEOPLE }) },
  })

  it("warns — and still builds the run — when the composition shows more figures than character references", () => {
    const result = build("generate-video", { prompt: "Two people at a table." }, { referenceVideoUrls: [MP4_A] }, graphWith([charNode("c1", "Kira")]))
    expect(result.jobName).toBe("text-to-video")
    const warnings = result.payload.warnings as Array<Record<string, unknown>>
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      code: SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE,
      figureCount: 2,
      characterReferenceCount: 1,
      missing: 1,
    })
    expect(warnings[0].message).toContain("2 figures but 1 character reference is attached")
    const cap = VIDEO_REF_LIMITS_BY_PROVIDER[PROVIDER]?.images
    expect(typeof cap).toBe("number")
    expect(warnings[0].message).toContain(`this model takes ${cap} image references`)
    // The scoping line is there too — the two rules travel together.
    expect(result.payload.prompt).toContain(CLIP_LINE)
  })

  it("stays silent when every figure has a character reference", () => {
    const result = build(
      "generate-video",
      { prompt: "Two people at a table." },
      { referenceVideoUrls: [MP4_A] },
      graphWith([charNode("c1", "Kira"), charNode("c2", "Tomas")]),
    )
    expect(result.payload).not.toHaveProperty("warnings")
    expect(result.payload.prompt).toContain(CLIP_LINE)
  })

  it("counts an extra reference bound to a character slug as a character reference", () => {
    const result = build(
      "generate-video",
      {
        prompt: "Two people at a table.",
        extraRefs: [{ id: "x1", url: "https://r2.example/chars/tomas.png", characterSlug: "tomas" }],
      },
      { referenceVideoUrls: [MP4_A] },
      graphWith([charNode("c1", "Kira")]),
    )
    expect(result.payload).not.toHaveProperty("warnings")
  })
})

// ---------------------------------------------------------------------------
// Docs — the public pages quote the fixture verbatim
// ---------------------------------------------------------------------------

describe("docs quote the exact line the platform sends", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const DOCS = resolve(HERE, "..", "..", "..", "..", "..", "docs", "nodes", "composition")

  for (const page of ["pro-3d-render.md", "generate-3d-scene.md"]) {
    it(`${page} carries SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE byte-for-byte`, () => {
      const src = readFileSync(resolve(DOCS, page), "utf8")
      expect(src).toContain(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE)
      expect(src).toContain(SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE)
    })
  }
})
