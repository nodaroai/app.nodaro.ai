/**
 * Scene3D on the ORCHESTRATED path.
 *
 * The canvas Run button goes through `routes/3d-scene.ts`; a workflow run
 * goes through `buildPayload`. Both must enqueue the same payload shape and
 * bill the same identifier, or the same node behaves differently depending on
 * how it was started — the recurring DAG-parity bug class.
 *
 * The edit node additionally has to FIND its scene. It resolves the plan the
 * way render-video resolves its plan (this run's upstream output before the
 * saved node data, via COMPOSER_PLAN_MAP), and refuses with the node's own
 * sentence when there is none — rather than enqueueing a job that dies in the
 * worker.
 */
import { describe, it, expect } from "vitest"
import { SCENE3D_PLAN_TYPE, SCENE3D_SCHEMA_VERSION, type Scene3DPlan } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

const REV = "11111111-2222-4333-8444-555555555555"

const PLAN: Scene3DPlan = {
  planType: SCENE3D_PLAN_TYPE,
  schemaVersion: SCENE3D_SCHEMA_VERSION,
  revisionId: REV,
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  backgroundColor: "#101014",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [
    { id: "hero", name: "Hero", primitive: "capsule", dimensions: [0.5, 1.7, 0.5], position: [0, 0.85, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc8844" },
  ],
  lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
}

const node = (type: string, data: Record<string, unknown>): SimpleNode =>
  ({ id: "n1", type, data }) as unknown as SimpleNode

const build = (type: string, data: Record<string, unknown>, inputs: Record<string, unknown> = {}, ctx?: unknown) =>
  buildPayload(node(type, data), "job-1", inputs as never, "usage-1", ctx as never)

describe("generate-3d-scene", () => {
  it("enqueues the worker payload with the frame the node data implies", () => {
    const result = build("generate-3d-scene", {
      scenePrompt: "A lone figure in an empty warehouse",
      durationSeconds: 3,
      fps: 30,
      aspectRatio: "9:16",
    })
    expect(result.jobName).toBe("generate-3d-scene")
    expect(result.queueName).toBe("video-generation")
    expect(result.modelIdentifier).toBe("3d-scene")
    expect(result.payload).toMatchObject({
      kind: "generate",
      jobId: "job-1",
      prompt: "A lone figure in an empty warehouse",
      fps: 30,
      durationInFrames: 90,
      width: 1080,
      height: 1920,
      usageLogId: "usage-1",
    })
    expect(result.payload.revisionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("defaults to 4s at 24fps in 16:9 — the route's defaults, not its own", () => {
    const result = build("generate-3d-scene", { scenePrompt: "x" })
    expect(result.payload).toMatchObject({ fps: 24, durationInFrames: 96, width: 1920, height: 1080 })
  })

  it("bills the tier the node's model implies", () => {
    expect(build("generate-3d-scene", { scenePrompt: "x", llmModel: "claude-opus-4.7" }).modelIdentifier).toBe("3d-scene:premium")
    expect(build("generate-3d-scene", { scenePrompt: "x", llmModel: "gemini-3.6-flash" }).modelIdentifier).toBe("3d-scene:economy")
  })

  it("turns wired reference handles into typed references, images before videos", () => {
    const result = build(
      "generate-3d-scene",
      { scenePrompt: "x" },
      {
        referenceImageUrls: ["https://x.test/a.png", "https://x.test/b.png"],
        referenceVideoUrls: ["https://x.test/c.mp4"],
      },
    )
    expect(result.payload.references).toEqual([
      { id: expect.stringMatching(/^ref-[a-f0-9]{32}$/), url: "https://x.test/a.png", kind: "image", role: "appearance" },
      { id: expect.stringMatching(/^ref-[a-f0-9]{32}$/), url: "https://x.test/b.png", kind: "image", role: "appearance" },
      { id: expect.stringMatching(/^ref-[a-f0-9]{32}$/), url: "https://x.test/c.mp4", kind: "video", role: "motion" },
    ])
  })

  it("keeps authored references and does not duplicate a wired URL", () => {
    const result = build(
      "generate-3d-scene",
      { scenePrompt: "x", references: [{ id: "authored", url: "https://x.test/a.png", kind: "image", role: "layout" }] },
      { referenceImageUrls: ["https://x.test/a.png", "https://x.test/b.png"] },
    )
    expect(result.payload.references).toEqual([
      // Authored identity survives edit chains.
      { id: "authored", url: "https://x.test/a.png", kind: "image", role: "layout" },
      { id: expect.stringMatching(/^ref-[a-f0-9]{32}$/), url: "https://x.test/b.png", kind: "image", role: "appearance" },
    ])
  })

  it("rejects malformed references instead of changing their identity or scope", () => {
    expect(() => build("generate-3d-scene", { scenePrompt: "x", references: [
      { id: "bad id", url: "https://x.test/a.png", kind: "image", role: "layout" },
    ] })).toThrow(/Invalid 3D scene reference/)
    expect(() => build("generate-3d-scene", { scenePrompt: "x", references: [
      { id: "image", url: "https://x.test/a.png", kind: "image", role: "layout", startSeconds: 2 },
    ] })).toThrow(/time window applies to video only/)
  })

  it("refuses a VIDEO time window with the route's own sentence, before any payload", () => {
    // A window is not a value we can substitute for — it names a different
    // input. Coercing it away here (the way the image window IS coerced) would
    // make a workflow run silently analyse the whole clip while the very same
    // node run standalone 400s at the route. `buildPayload` throws before the
    // orchestrator reserves, so this costs nothing.
    expect(() =>
      build("generate-3d-scene", {
        scenePrompt: "x",
        references: [{ id: "v", url: "https://x.test/b.mp4", kind: "video", role: "motion", startSeconds: 2, endSeconds: 5 }],
      }),
    ).toThrow(/trim the video first/)
  })

  it("refuses a second video reference on the DAG path too", () => {
    // New on this path: a 2-video fan-in used to land on the plan. It cannot,
    // for the same reason the route refuses it — `lib/cancel-job.ts` reads a
    // SINGULAR analysisJobId — and a 2-video plan would then be unenqueueable
    // through the route on the next edit.
    expect(() =>
      build("generate-3d-scene", {
        scenePrompt: "x",
      }, { referenceVideoUrls: ["https://x.test/a.mp4", "https://x.test/b.mp4"] }),
    ).toThrow(/At most 1 video reference/)
  })

  it("refuses a generate with no brief", () => {
    expect(() => build("generate-3d-scene", {})).toThrow(/no brief/)
  })

  it("refuses over-cap references before changing the requested scene", () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://x.test/${i}.png`)
    expect(() => build("generate-3d-scene", { scenePrompt: "x" }, { referenceImageUrls: many })).toThrow(/At most 8 references/)
  })

  it("reads the node's OWN prompt field, falls back to a wired one, and wraps the affixes", () => {
    // `scenePrompt`, not `prompt` — the field NODE_PROMPT_FIELDS registers.
    expect(build("generate-3d-scene", { scenePrompt: "typed" }).payload.prompt).toBe("typed")
    expect(build("generate-3d-scene", {}, { prompt: "from upstream" }).payload.prompt).toBe("from upstream")
    expect(
      build("generate-3d-scene", { scenePrompt: "typed", promptPrefix: "PRE", promptSuffix: "POST" }).payload.prompt,
    ).toBe("PRE typed POST")
  })
})

describe("edit-3d-scene", () => {
  it("edits the plan stored on the node", () => {
    const result = build("edit-3d-scene", { scenePlan: PLAN, editPrompt: "move the hero left" })
    expect(result.jobName).toBe("edit-3d-scene")
    expect(result.modelIdentifier).toBe("3d-scene")
    expect(result.payload).toMatchObject({
      kind: "edit",
      expectedRevisionId: REV,
      instruction: "move the hero left",
    })
    expect((result.payload.plan as Scene3DPlan).revisionId).toBe(REV)
    expect(result.payload.revisionId).not.toBe(REV)
  })

  it("finds the plan an upstream generate node produced in THIS run", () => {
    const ctx = {
      nodes: [node("generate-3d-scene", {}), node("edit-3d-scene", {})].map((n, i) => ({ ...n, id: i === 0 ? "src" : "n1" })),
      edges: [{ id: "e1", source: "src", target: "n1", sourceHandle: null, targetHandle: "scene" }],
      nodeStates: { src: { output: { plan: PLAN } } },
    }
    const result = build("edit-3d-scene", { editPrompt: "x" }, {}, ctx)
    expect((result.payload.plan as Scene3DPlan).revisionId).toBe(REV)
  })

  it("prefers THIS run's upstream plan over the node's own stored output", () => {
    // `scenePlan` on an edit node is its OUTPUT, not an input field (which is
    // why the precedence here is NOT render-video's). Reading it first would
    // make a re-run edit last run's stale revision and silently ignore the
    // freshly generated upstream one.
    const fresh: Scene3DPlan = { ...PLAN, revisionId: "aaaaaaaa-2222-4333-8444-555555555555" }
    const ctx = {
      nodes: [{ ...node("generate-3d-scene", {}), id: "src" }, { ...node("edit-3d-scene", {}), id: "n1" }],
      edges: [{ id: "e1", source: "src", target: "n1", sourceHandle: null, targetHandle: "scene" }],
      nodeStates: { src: { output: { plan: fresh } } },
    }
    const result = build("edit-3d-scene", { scenePlan: PLAN, editPrompt: "x" }, {}, ctx)
    expect((result.payload.plan as Scene3DPlan).revisionId).toBe(fresh.revisionId)
    expect(result.payload.expectedRevisionId).toBe(fresh.revisionId)
  })

  it("refuses an edit with nothing to do rather than paying for an empty instruction", () => {
    expect(() => build("edit-3d-scene", { scenePlan: PLAN })).toThrow(/nothing to do/)
  })

  it("falls back to the upstream node's SAVED plan when this run has no state", () => {
    const ctx = {
      nodes: [{ ...node("generate-3d-scene", { scenePlan: PLAN }), id: "src" }, { ...node("edit-3d-scene", {}), id: "n1" }],
      edges: [{ id: "e1", source: "src", target: "n1", sourceHandle: null, targetHandle: "scene" }],
      nodeStates: {},
    }
    const result = build("edit-3d-scene", { editPrompt: "x" }, {}, ctx)
    expect((result.payload.plan as Scene3DPlan).revisionId).toBe(REV)
  })

  it("refuses with the node's own sentence when there is no scene to edit", () => {
    expect(() => build("edit-3d-scene", { editPrompt: "x" })).toThrow(/no scene to edit/)
  })

  it("refuses an invalid scene with an actionable version error", () => {
    expect(() => build("edit-3d-scene", { scenePlan: { planType: "3d-scene", objects: [] }, editPrompt: "x" })).toThrow(
      /invalid or uses an unsupported version/,
    )
  })

  it("bills nothing for the deterministic lane and carries the operations", () => {
    const operations = [{ op: "set-object", objectId: "hero", changes: { color: "#ff0000" } }]
    const result = build("edit-3d-scene", { scenePlan: PLAN, operations })
    expect(result.modelIdentifier).toBe("3d-scene-ops")
    expect(result.payload).toMatchObject({ operations })
    expect(result.payload.instruction).toBeUndefined()
  })

  it("forwards the locks and the selection", () => {
    const result = build("edit-3d-scene", {
      scenePlan: PLAN,
      editPrompt: "x",
      lockedObjectIds: ["hero"],
      selectedObjectIds: ["hero"],
    })
    expect(result.payload).toMatchObject({ lockedObjectIds: ["hero"], selectedObjectIds: ["hero"] })
  })
})

 it("the DAG forwards reference replacement before validating the resulting set", () => {
   const result = build("edit-3d-scene", {
     scenePlan: { ...PLAN, references: [{ id: "old", url: "https://x.test/old.mp4", kind: "video", role: "motion" }] },
     editPrompt: "match the new move", replaceReferences: true,
     references: [{ id: "new", url: "https://x.test/new.mp4", kind: "video", role: "motion" }],
   })
   expect(result.payload).toMatchObject({ replaceReferences: true, references: [{ id: "new" }] })
 })
