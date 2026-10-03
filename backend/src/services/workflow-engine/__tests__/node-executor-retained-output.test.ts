/**
 * A FAILED job's RETAINED output, from the job row to the thrown Error.
 *
 * `SCENE_QUALITY_FAILED` after an exhausted repair budget is the refusal that
 * already published a real, renderable scene revision: the planner produced a
 * recipe, the compiler accepted it, the builder exported it, and the visual
 * reviewer said it does not yet match the brief. The row settles `failed` with
 * a full `output_data` — `scenePlan`, `sceneRevisionId`, `deliveryId`,
 * `posterAssetId`, `validation.sourceRetained`, `metadata.review`.
 *
 * `pollJobToCompletion` used to throw a plain `Error(error_message)` there, so
 * the draft never reached `nodeStates[nodeId]` and no DAG client could see it.
 * It now attaches `output` the same way it already attaches `errorHint` — and
 * this proves it at the REAL throw site, with only the external boundaries
 * mocked (mirrors `node-executor-error-hint.test.ts`, whose harness this is).
 *
 * The node here is `video-analysis` because that is the cheapest node to drive
 * through the real poll; the attachment itself is DATA-DRIVEN
 * (`retainedOutputOfFailedJob` asks `buildNodeOutputFromJobData` what the row
 * carries), so the node type selects the extractor branch and nothing else —
 * which is exactly the property that makes a future retaining node free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
}))

const JOB_ID = "job-retained-1"
let jobRecord: Record<string, unknown> = {}

vi.mock("../../../lib/supabase.js", () => {
  const builder = {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: JOB_ID }, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: jobRecord }) }) }),
  }
  return { supabase: { from: () => builder } }
})

vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))
// Video Analysis reads a post link's length before it reserves (the network
// lane in providers/video/social-post-video.ts). Here the post says no length,
// so the node takes the ceiling path it always took.
vi.mock("../../../providers/video/social-post-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/social-post-video.js")>()),
  probeSocialPostVideo: vi.fn(async () => ({ durationSec: null, title: null, isLive: false })),
}))

import { executeNode } from "../node-executor.js"
import { retainedOutputOfFailedJob, retainedOutputOfRejection } from "../failed-node-output.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

/** The `output_data` a refused-but-retained 3D-scene authoring run settles with. */
const RETAINED_DRAFT = {
  kind: "draft",
  scenePlan: { planType: "3d-scene", revisionId: "rev-1", objects: [] },
  sceneRevisionId: "rev-1",
  deliveryId: "del-1",
  posterAssetId: "asset-1",
  validation: { status: "failed", sourceRetained: true },
  metadata: { review: { refused: true, objections: [{ category: "layout", what: "the chair floats", frames: [12] }] } },
}

function vaNode(): SimpleNode {
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" } }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

async function runAndCatch(): Promise<unknown> {
  const node = vaNode()
  try {
    await executeNode(node, {}, [], [node], {}, makeCtx())
    throw new Error("expected executeNode to reject")
  } catch (err) {
    return err
  }
}

describe("pollJobToCompletion — retained output on a failed job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    mockReserveCredits.mockResolvedValue({ usageLogId: "usage-ro-1", creditsReserved: 3, watermark: false })
  })

  it("attaches what the refused run RETAINED, without softening the verdict", async () => {
    jobRecord = {
      status: "failed",
      output_data: RETAINED_DRAFT,
      error_message: "SCENE_QUALITY_FAILED: the reviewer refused the scene after 3 repair passes",
      progress: 100,
    }

    const caught = await runAndCatch()

    // Still a failure, with its reason — the draft changes no verdict.
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain("SCENE_QUALITY_FAILED")
    expect((caught as { output?: { plan?: unknown } }).output?.plan).toEqual(RETAINED_DRAFT.scenePlan)
  })

  it("leaves output undefined for a failure that retained nothing", async () => {
    jobRecord = {
      status: "failed",
      output_data: null,
      error_message: "Provider timeout after 30s",
      progress: 0,
    }
    expect((await runAndCatch() as { output?: unknown }).output).toBeUndefined()
  })

  it("leaves output undefined when output_data carries no extractable result", async () => {
    jobRecord = {
      status: "failed",
      output_data: { retries: 3, lastWarning: "admission failed" },
      error_message: "Compiler refused every recipe",
      progress: 0,
    }
    expect((await runAndCatch() as { output?: unknown }).output).toBeUndefined()
  })

  /**
   * The one lane where "attach whatever the row carries" could have been a leak,
   * and is not — pinned here so a future change to either policy path has to
   * come past this test.
   *
   * A job the result gate BLOCKS, and one a human REJECTS out of
   * `pending_review`, both write `output_data: null` explicitly
   * (`lib/job-policy-gate.ts` applyBlock / rejectHeldJobRow — a NULL
   * `output_data` is D19's security boundary). The withheld payload lives in
   * `held_output_data`, which this never reads. So the withheld result cannot
   * ride a failed node state onto the execution row and out through
   * `GET /v1/workflow-executions/:id`.
   */
  it("attaches nothing for a job the result gate refused to publish", async () => {
    jobRecord = {
      status: "failed",
      output_data: null,
      error_message: "This output was withheld by a content policy.",
      error_hint: { kind: "policy-block", policyId: "pol-1", hookPoint: "result" },
      progress: 100,
    }
    const caught = await runAndCatch()
    expect((caught as { output?: unknown }).output).toBeUndefined()
    // The verdict still rides, exactly as before.
    expect((caught as { errorHint?: { kind?: string } }).errorHint?.kind).toBe("policy-block")
  })

  it("never attaches one to a CANCELLED job — it published nothing and is being refunded", async () => {
    jobRecord = {
      status: "cancelled",
      output_data: RETAINED_DRAFT,
      error_message: "Execution cancelled",
      progress: 0,
    }
    expect((await runAndCatch() as { output?: unknown }).output).toBeUndefined()
  })
})

describe("retainedOutputOfFailedJob / retainedOutputOfRejection", () => {
  it("extracts the draft plan from a retained 3D-scene row", () => {
    expect(retainedOutputOfFailedJob(RETAINED_DRAFT, "generate-3d-scene")).toEqual({
      plan: RETAINED_DRAFT.scenePlan,
    })
  })

  it("answers undefined for null, a non-object, and a row with nothing extractable", () => {
    expect(retainedOutputOfFailedJob(null, "generate-3d-scene")).toBeUndefined()
    expect(retainedOutputOfFailedJob("nope", "generate-3d-scene")).toBeUndefined()
    expect(retainedOutputOfFailedJob([1, 2], "generate-3d-scene")).toBeUndefined()
    expect(retainedOutputOfFailedJob({ repairPasses: 3 }, "generate-3d-scene")).toBeUndefined()
  })

  it("reads the same answer back off a rejection, and ignores a non-object one", () => {
    const err = Object.assign(new Error("refused"), { output: { plan: { revisionId: "rev-1" } } })
    expect(retainedOutputOfRejection(err)).toEqual({ plan: { revisionId: "rev-1" } })
    expect(retainedOutputOfRejection(new Error("plain"))).toBeUndefined()
    expect(retainedOutputOfRejection("string reason")).toBeUndefined()
    expect(retainedOutputOfRejection(Object.assign(new Error("x"), { output: "nope" }))).toBeUndefined()
  })
})
