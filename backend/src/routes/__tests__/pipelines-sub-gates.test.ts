import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import.
//
// Phase 1C.2 L1 — covers POST /v1/pipelines/:id/sub-gates/:gate/{approve,reject}.
// ---------------------------------------------------------------------------

vi.mock("../../lib/config.js", () => ({
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
}))

vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/credits.js", () => ({
  estimateUpfrontCredits: vi.fn(() => 30),
  resolveMaxCostCredits: vi.fn(() => 2000),
  reservePipelineCredits: vi.fn(async () => ({ ok: true, usageLogId: "ul-1" })),
  refundPipelineCredits: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/engine.js", () => ({
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  rejectScriptStage: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/entity-approval.js", () => ({
  approveEntity: vi.fn(async () => ({ ok: true })),
  rejectEntity: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}))

vi.mock("../../ee/pipelines/fork.js", () => ({
  forkPipeline: vi.fn(),
}))

// Constants used by the in-memory supabase mock. vi.mock factories are
// hoisted module-scope, so we inline string literals to avoid TDZ.

const TEST_USER_ID = "user-1"
const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const OTHER_PIPELINE_ID = "00000000-0000-0000-0000-000000000999"

// Fixtures: { pipelineId -> {pipeline, stage} }. The mock matches the chain
// shapes the route uses (select/eq/maybeSingle for pipelines + pipeline_stages,
// update/eq for both).
vi.mock("../../lib/supabase.js", () => {
  const state = {
    pipelines: new Map<string, { id: string; user_id: string; status: string }>(),
    stages: new Map<
      string,
      {
        id: string
        pipeline_id: string
        stage_name: string
        status: string
        output: Record<string, unknown> | null
      }
    >(),
  }

  // Pipeline owned by TEST_USER_ID, with an animate_audio_edit stage
  // awaiting a silent_cut_preview sub-gate.
  state.pipelines.set("00000000-0000-0000-0000-000000000111", {
    id: "00000000-0000-0000-0000-000000000111",
    user_id: "user-1",
    status: "awaiting_approval",
  })
  state.stages.set("stage-7", {
    id: "stage-7",
    pipeline_id: "00000000-0000-0000-0000-000000000111",
    stage_name: "animate_audio_edit",
    status: "awaiting_approval",
    output: {
      current_sub_gate: "silent_cut_preview",
      silent_cut_preview_url: "https://r2/silent.mp4",
      sub_step_completed: { dialogue_recheck: true },
    },
  })

  // Pipeline owned by ANOTHER user (existence-leak check).
  state.pipelines.set("other-user", {
    id: "other-user",
    user_id: "another-user",
    status: "awaiting_approval",
  })

  // Pipeline whose stage isn't awaiting approval (running state).
  state.pipelines.set("running-pipeline", {
    id: "running-pipeline",
    user_id: "user-1",
    status: "running",
  })
  state.stages.set("stage-7-running", {
    id: "stage-7-running",
    pipeline_id: "running-pipeline",
    stage_name: "animate_audio_edit",
    status: "running",
    output: {},
  })

  // Pipeline with a different current_sub_gate (wrong-gate mismatch).
  state.pipelines.set("wrong-gate-pipeline", {
    id: "wrong-gate-pipeline",
    user_id: "user-1",
    status: "awaiting_approval",
  })
  state.stages.set("stage-7-wrong-gate", {
    id: "stage-7-wrong-gate",
    pipeline_id: "wrong-gate-pipeline",
    stage_name: "animate_audio_edit",
    status: "awaiting_approval",
    output: { current_sub_gate: "dialogue_recheck" },
  })

  // Pipeline with NO stage row (stage_not_found).
  state.pipelines.set("no-stage-pipeline", {
    id: "no-stage-pipeline",
    user_id: "user-1",
    status: "awaiting_approval",
  })

  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({
              data: state.pipelines.get(val) ?? null,
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, val: string) => {
            const row = state.pipelines.get(val)
            if (row) state.pipelines.set(val, { ...row, ...patch } as never)
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === "pipeline_stages") {
      return {
        select: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              maybeSingle: async () => {
                // Find by pipeline_id + stage_name.
                for (const stage of state.stages.values()) {
                  if (
                    col1 === "pipeline_id" &&
                    stage.pipeline_id === val1 &&
                    col2 === "stage_name" &&
                    stage.stage_name === val2
                  ) {
                    return { data: stage, error: null }
                  }
                }
                return { data: null, error: null }
              },
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, val: string) => {
            const stage = state.stages.get(val)
            if (stage) state.stages.set(val, { ...stage, ...patch } as never)
            return { data: null, error: null }
          },
        }),
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }

  return { supabase: { from }, _state: state }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { pipelinesRoutes } from "../pipelines.js"
import { enqueuePipelineRun } from "../../ee/pipelines/queue.js"
import { refundPipelineCredits } from "../../ee/pipelines/credits.js"
import { pipelineEvents } from "../../ee/pipelines/events.js"
import { hasCredits } from "../../lib/config.js"

async function makeApp(overrides?: { scopes?: string[]; appAuth?: boolean }) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = TEST_USER_ID
    if (overrides?.appAuth) {
      ;(req as unknown as { appAuthorization: unknown }).appAuthorization = {
        appId: "app-1",
        authorizationId: "auth-1",
        scopes: overrides.scopes ?? [],
      }
    } else {
      ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
    }
  })
  await app.register(pipelinesRoutes)
  await app.ready()
  return app
}

beforeEach(async () => {
  vi.clearAllMocks()
  // Re-seed pipeline + stage state. Tests mutate the mock store; without a
  // reset they would contaminate each other.
  const supabaseMod = await import("../../lib/supabase.js")
  const state = (supabaseMod as never as { _state: never })._state as {
    pipelines: Map<string, { id: string; user_id: string; status: string }>
    stages: Map<
      string,
      {
        id: string
        pipeline_id: string
        stage_name: string
        status: string
        output: Record<string, unknown> | null
      }
    >
  }
  state.pipelines.clear()
  state.stages.clear()
  state.pipelines.set("00000000-0000-0000-0000-000000000111", {
    id: "00000000-0000-0000-0000-000000000111",
    user_id: "user-1",
    status: "awaiting_approval",
  })
  state.stages.set("stage-7", {
    id: "stage-7",
    pipeline_id: "00000000-0000-0000-0000-000000000111",
    stage_name: "animate_audio_edit",
    status: "awaiting_approval",
    output: {
      current_sub_gate: "silent_cut_preview",
      silent_cut_preview_url: "https://r2/silent.mp4",
      sub_step_completed: { dialogue_recheck: true },
    },
  })
  state.pipelines.set("other-user", {
    id: "other-user",
    user_id: "another-user",
    status: "awaiting_approval",
  })
  state.pipelines.set("running-pipeline", {
    id: "running-pipeline",
    user_id: "user-1",
    status: "running",
  })
  state.stages.set("stage-7-running", {
    id: "stage-7-running",
    pipeline_id: "running-pipeline",
    stage_name: "animate_audio_edit",
    status: "running",
    output: {},
  })
  state.pipelines.set("wrong-gate-pipeline", {
    id: "wrong-gate-pipeline",
    user_id: "user-1",
    status: "awaiting_approval",
  })
  state.stages.set("stage-7-wrong-gate", {
    id: "stage-7-wrong-gate",
    pipeline_id: "wrong-gate-pipeline",
    stage_name: "animate_audio_edit",
    status: "awaiting_approval",
    output: { current_sub_gate: "dialogue_recheck" },
  })
  state.pipelines.set("no-stage-pipeline", {
    id: "no-stage-pipeline",
    user_id: "user-1",
    status: "awaiting_approval",
  })
})

describe("POST /v1/pipelines/:id/sub-gates/:gate/approve", () => {
  it("approves silent_cut_preview, clears the gate, flips status to running, enqueues drive", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/silent_cut_preview/approve`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.gate).toBe("silent_cut_preview")
    expect(typeof body.resumed_at).toBe("string")
    expect(enqueuePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        userId: TEST_USER_ID,
        reason: "stage_advance",
      }),
    )
    // stage:status event was emitted.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:status",
        stageName: "animate_audio_edit",
        status: "running",
      }),
    )
    await app.close()
  })

  it("approves dialogue_recheck happy path (separate gate value)", async () => {
    // Override the stored sub-gate to dialogue_recheck for this test.
    const supabaseMod = await import("../../lib/supabase.js")
    const state = (supabaseMod as never as { _state: never })._state as {
      stages: Map<string, { output: Record<string, unknown> | null }>
    }
    const stage = state.stages.get("stage-7")
    if (stage)
      stage.output = {
        ...(stage.output as Record<string, unknown>),
        current_sub_gate: "dialogue_recheck",
      }

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/dialogue_recheck/approve`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, gate: "dialogue_recheck" })
    await app.close()
  })

  it("returns 404 when wrong gate value (current_sub_gate mismatch)", async () => {
    const app = await makeApp()
    // The seeded pipeline has current_sub_gate='silent_cut_preview' (from
    // the prior test's mutation may have flipped it — but we use a separate
    // pipeline that has current_sub_gate='dialogue_recheck' for this case).
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/wrong-gate-pipeline/sub-gates/silent_cut_preview/approve",
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 409 stage_not_awaiting_approval when stage isn't paused", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/running-pipeline/sub-gates/silent_cut_preview/approve",
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("stage_not_awaiting_approval")
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 400 invalid_sub_gate for bad gate name", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/bogus_gate/approve`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_sub_gate")
    await app.close()
  })

  it("returns 404 stage_not_found when no animate_audio_edit stage exists", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/no-stage-pipeline/sub-gates/silent_cut_preview/approve",
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("stage_not_found")
    await app.close()
  })

  it("returns 404 not_found when the pipeline belongs to another user", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/other-user/sub-gates/silent_cut_preview/approve",
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("returns 403 edition_required when hasCredits() is false", async () => {
    ;(hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/silent_cut_preview/approve`,
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("edition_required")
    await app.close()
  })

  it("enforces pipelines:approve scope on OAuth app path", async () => {
    const app = await makeApp({ appAuth: true, scopes: ["pipelines:read"] })
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/silent_cut_preview/approve`,
    })
    // Scope mismatch returns 403 from requireScope().
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe("POST /v1/pipelines/:id/sub-gates/:gate/reject", () => {
  it("rejects silent_cut_preview — stage failed + pipeline failed + refund called", async () => {
    // Re-seed stage output to the rejecting gate, in case prior tests mutated it.
    const supabaseMod = await import("../../lib/supabase.js")
    const state = (supabaseMod as never as { _state: never })._state as {
      stages: Map<
        string,
        { output: Record<string, unknown> | null; status: string }
      >
      pipelines: Map<string, { status: string }>
    }
    const stage = state.stages.get("stage-7")
    if (stage) {
      stage.status = "awaiting_approval"
      stage.output = { current_sub_gate: "silent_cut_preview" }
    }
    const p = state.pipelines.get(PIPELINE_ID)
    if (p) p.status = "awaiting_approval"

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/silent_cut_preview/reject`,
      payload: { feedback: "Pacing feels off" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      ok: false,
      gate: "silent_cut_preview",
      reason: "rejected",
    })
    // Re-fetch from state map: mock's update() replaces the row with a fresh
    // shallow copy, so the captured `stage` reference is stale.
    const updatedStage = state.stages.get("stage-7")
    expect(updatedStage?.status).toBe("failed")
    // Pipeline was cascaded to failed.
    expect(state.pipelines.get(PIPELINE_ID)?.status).toBe("failed")
    // Refund was called.
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        userId: TEST_USER_ID,
        reason: "sub_gate_rejected:silent_cut_preview",
      }),
    )
    // Stage failure event emitted.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:status",
        status: "failed",
      }),
    )
    await app.close()
  })

  it("stores feedback in stage output.reject_feedback", async () => {
    const supabaseMod = await import("../../lib/supabase.js")
    const state = (supabaseMod as never as { _state: never })._state as {
      stages: Map<
        string,
        { output: Record<string, unknown> | null; status: string }
      >
      pipelines: Map<string, { status: string }>
    }
    const stage = state.stages.get("stage-7")
    if (stage) {
      stage.status = "awaiting_approval"
      stage.output = { current_sub_gate: "dialogue_recheck" }
    }
    const p = state.pipelines.get(PIPELINE_ID)
    if (p) p.status = "awaiting_approval"

    const app = await makeApp()
    await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/dialogue_recheck/reject`,
      payload: { feedback: "Audio durations don't fit narration" },
    })
    const updatedStage = state.stages.get("stage-7")
    expect(updatedStage?.output?.reject_feedback).toBe(
      "Audio durations don't fit narration",
    )
    expect(updatedStage?.output?.failure_reason).toBe(
      "sub_gate_rejected:dialogue_recheck",
    )
    await app.close()
  })

  it("returns 400 invalid_sub_gate for bad gate name", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/bogus/reject`,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_sub_gate")
    expect(refundPipelineCredits).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 404 not_found when the pipeline belongs to another user", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/other-user/sub-gates/silent_cut_preview/reject",
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(refundPipelineCredits).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 403 edition_required when hasCredits() is false", async () => {
    ;(hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/silent_cut_preview/reject`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("enforces pipelines:approve scope on OAuth app path", async () => {
    const app = await makeApp({ appAuth: true, scopes: ["pipelines:read"] })
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/sub-gates/silent_cut_preview/reject`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
