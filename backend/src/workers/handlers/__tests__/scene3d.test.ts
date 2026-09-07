/**
 * The Scene3D handlers. Guarantees:
 *   - a generate run completes with `{ scenePlan }` and THEN commits the
 *     reservation — never the other way round;
 *   - a deterministic edit calls NO model at all, produces the revision the
 *     route minted, and still settles through the same completion path;
 *   - a video-reference run waits for the analysis child, mirrors its progress
 *     into the analysis band and carries its id + credits on the finished row;
 *   - a lost completion CAS (cancelled / held mid-flight) never commits;
 *   - an edit the contract refuses fails the job, so the worker's own failure
 *     path refunds it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  markJobCompleted: vi.fn(),
  setJobProgress: vi.fn(async () => {}),
  commitReservedCreditsForJob: vi.fn(async () => {}),
  markProviderCallStart: vi.fn(async () => {}),
  throwIfJobCancelled: vi.fn(async () => {}),
  generateScenePlan: vi.fn(),
  editScenePlan: vi.fn(),
  jobRead: vi.fn(),
}))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return { ...actual, markJobCompleted: mocks.markJobCompleted, setJobProgress: mocks.setJobProgress }
})
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: mocks.commitReservedCreditsForJob }))
vi.mock("../../../lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("../../../lib/job-cancellation.js", () => ({ throwIfJobCancelled: mocks.throwIfJobCancelled }))
vi.mock("../../../services/scene3d/index.js", async (importOriginal) => {
  // The deterministic lane keeps the REAL `applyScene3DEditOperations` wrapper:
  // "no model is called" is only meaningful if the apply is the real one.
  const actual = await importOriginal<typeof import("../../../services/scene3d/index.js")>()
  return { ...actual, generateScenePlan: mocks.generateScenePlan, editScenePlan: mocks.editScenePlan }
})
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: mocks.jobRead(), error: null }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    })),
  },
}))

import { SCENE3D_PLAN_TYPE, SCENE3D_SCHEMA_VERSION, videoAnalysisResultSchema, type Scene3DPlan } from "@nodaro/shared"
import { handleEdit3dScene, handleGenerate3dScene } from "../scene3d.js"
import type { Job } from "bullmq"
import type { JobContext } from "../../shared.js"

const REV = "11111111-2222-4333-8444-555555555555"
const NEXT_REV = "66666666-7777-4888-8999-aaaaaaaaaaaa"

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
    { id: "ground", name: "Ground", primitive: "plane", dimensions: [10, 0.01, 10], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#333333" },
    { id: "hero", name: "Hero", primitive: "capsule", dimensions: [0.5, 1.7, 0.5], position: [0, 0.85, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc8844" },
  ],
  lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
}

/** A real `VideoAnalysisResult`. On a vocabulary miss fix THIS against
 *  packages/shared/src/video-analysis.ts, never the assertion below. */
const ANALYSIS = {
  meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9", title: "Dolly" },
  slots: [{ slotId: "hero", label: "Hero", source: "wired-character", role: "person", description: "a seated figure" }],
  scenes: [{ startSec: 0, endSec: 4, label: "Push", shotType: "Medium Close-Up", camera: "push-in", visual: "{slot:hero} sits", audio: [], sceneNumber: 1, visualResolved: "Hero sits", slotRefs: ["hero"] }],
  warnings: [],
}

const CTX: JobContext = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const job = (data: Record<string, unknown>) => ({ data, updateProgress: async () => {} }) as unknown as Job

const GENERATE = {
  kind: "generate",
  jobId: "job-1",
  prompt: "A lone figure in an empty warehouse",
  llmModel: "claude-sonnet-4.6",
  references: [],
  revisionId: REV,
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
}

const completedOutput = () => mocks.markJobCompleted.mock.calls[0][1].output_data as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.generateScenePlan.mockResolvedValue({ plan: PLAN, inputTokens: 100, outputTokens: 200, revisions: 0 })
  mocks.editScenePlan.mockResolvedValue({
    plan: { ...PLAN, revisionId: NEXT_REV, parentRevisionId: REV },
    changeSummary: "Moved the hero.",
    inputTokens: 50,
    outputTokens: 60,
    revisions: 0,
  })
})

describe("fixture", () => {
  it("is a real analysis result — the analysis-child test depends on it validating", () => {
    expect(videoAnalysisResultSchema.safeParse(ANALYSIS).success).toBe(true)
  })
})

describe("generate-3d-scene", () => {
  it("completes with the plan, then commits", async () => {
    await handleGenerate3dScene(job(GENERATE), CTX)
    expect(completedOutput()).toMatchObject({ scenePlan: PLAN, inputTokens: 100, outputTokens: 200, revisions: 0 })
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.markJobCompleted.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.commitReservedCreditsForJob.mock.invocationCallOrder[0],
    )
  })

  it("hands the authoring service the server-owned frame verbatim", async () => {
    await handleGenerate3dScene(job({ ...GENERATE, fps: 30, durationInFrames: 60 }), CTX)
    expect(mocks.generateScenePlan).toHaveBeenCalledWith(expect.objectContaining({ fps: 30, durationInFrames: 60, revisionId: REV }))
  })

  it("never commits when the completion CAS is lost (cancelled or held)", async () => {
    mocks.markJobCompleted.mockResolvedValue(false)
    await handleGenerate3dScene(job(GENERATE), CTX)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("waits for the analysis child and carries its id and credits onto the row", async () => {
    mocks.jobRead.mockReturnValue({
      status: "completed",
      progress: 100,
      output_data: { json: ANALYSIS },
      error_message: null,
      user_id: "user-1",
      credits: 12,
    })
    await handleGenerate3dScene(job({ ...GENERATE, analysisJobId: "analysis-1" }), CTX)
    expect(mocks.generateScenePlan).toHaveBeenCalledWith(
      expect.objectContaining({ analysis: expect.objectContaining({ meta: expect.objectContaining({ title: "Dolly" }) }) }),
    )
    expect(completedOutput()).toMatchObject({ analysisJobId: "analysis-1", analysisCredits: 12 })
  })

  it("fails the job when the analysis child failed — the worker's failure path refunds", async () => {
    mocks.jobRead.mockReturnValue({
      status: "failed", progress: 0, output_data: null, error_message: "clip too long", user_id: "user-1", credits: null,
    })
    await expect(handleGenerate3dScene(job({ ...GENERATE, analysisJobId: "analysis-1" }), CTX)).rejects.toThrow(/clip too long/)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("lets an authoring failure through so the job fails and refunds", async () => {
    mocks.generateScenePlan.mockRejectedValue(new Error("validation failed after 3 attempts"))
    await expect(handleGenerate3dScene(job(GENERATE), CTX)).rejects.toThrow(/validation failed/)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("edit-3d-scene — the deterministic lane", () => {
  const deterministic = {
    kind: "edit",
    jobId: "job-1",
    plan: PLAN,
    expectedRevisionId: REV,
    revisionId: NEXT_REV,
    lockedObjectIds: [],
    selectedObjectIds: [],
    references: [],
    operations: [{ op: "set-object", objectId: "hero", changes: { position: [-2, 0.85, 0] } }],
  }

  it("calls no model, produces the route's revision, and settles the same way", async () => {
    await handleEdit3dScene(job(deterministic), CTX)
    expect(mocks.editScenePlan).not.toHaveBeenCalled()
    const output = completedOutput()
    const plan = output.scenePlan as Scene3DPlan
    expect(plan.revisionId).toBe(NEXT_REV)
    expect(plan.parentRevisionId).toBe(REV)
    expect(plan.objects.find((o) => o.id === "hero")?.position).toEqual([-2, 0.85, 0])
    expect(output).toMatchObject({ mode: "operations", changedObjectIds: ["hero"] })
    expect(output.changeSummary).toContain("hero")
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("does not wait on an analysis child even if one is somehow set", async () => {
    mocks.jobRead.mockReturnValue({ status: "pending", progress: 0, output_data: null, error_message: null, user_id: "user-1", credits: null })
    await handleEdit3dScene(job({ ...deterministic, analysisJobId: "analysis-1" }), CTX)
    expect(mocks.markJobCompleted).toHaveBeenCalled()
  })

  it("fails the job when the operations no longer apply", async () => {
    await expect(
      handleEdit3dScene(job({ ...deterministic, operations: [{ op: "remove-object", objectId: "ghost" }] }), CTX),
    ).rejects.toThrow(/ghost/)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("fails the job when a locked object is touched", async () => {
    await expect(handleEdit3dScene(job({ ...deterministic, lockedObjectIds: ["hero"] }), CTX)).rejects.toThrow(/locked/)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
  })

  it("fails the job when the plan moved on under it", async () => {
    await expect(
      handleEdit3dScene(job({ ...deterministic, expectedRevisionId: NEXT_REV }), CTX),
    ).rejects.toThrow(/moved on/)
  })
})

describe("edit-3d-scene — the instruction lane", () => {
  const instruction = {
    kind: "edit",
    jobId: "job-1",
    plan: PLAN,
    expectedRevisionId: REV,
    revisionId: NEXT_REV,
    lockedObjectIds: ["ground"],
    selectedObjectIds: ["hero"],
    references: [],
    instruction: "move the hero to the left",
    llmModel: "claude-sonnet-4.6",
  }

  it("preserves reference replacement across the durable worker boundary", async () => {
    await handleEdit3dScene(job({ ...instruction, replaceReferences: true }), CTX)
    expect(mocks.editScenePlan).toHaveBeenCalledWith(expect.objectContaining({ replaceReferences: true, references: [] }))
  })

  it("forwards the locks and the selection to the authoring service", async () => {
    await handleEdit3dScene(job(instruction), CTX)
    expect(mocks.editScenePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "move the hero to the left",
        lockedObjectIds: ["ground"],
        selectedObjectIds: ["hero"],
        revisionId: NEXT_REV,
      }),
    )
    expect(completedOutput()).toMatchObject({ mode: "prompt", changeSummary: "Moved the hero.", inputTokens: 50 })
  })

  it("never commits when the completion CAS is lost", async () => {
    mocks.markJobCompleted.mockResolvedValue(false)
    await handleEdit3dScene(job(instruction), CTX)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
})
