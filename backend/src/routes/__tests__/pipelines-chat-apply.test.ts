/**
 * Phase 1D.2b H2 — route tests for
 *   POST /v1/pipelines/:id/stages/:stage_name/chat/turns/:turnId/apply
 *
 * `applyStageEdit` is mocked so these tests focus on the routing layer:
 *   - Triple-gate (auth + scope + edition)
 *   - UUID + stage validation
 *   - Ownership check (existence-leak guard returns 404)
 *   - Turn validation (must be assistant + edit_artifact + not yet applied)
 *   - Result-shape forwarding:
 *       ok=true                                → 200 { applied: true, ... }
 *       schema_invalid / reference_integrity   → 200 { applied: false } +
 *                                                inserts follow-up assistant
 *                                                turn + emits chat:turn SSE
 *       patch_invalid / stage_not_awaiting     → 409
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import.
// ---------------------------------------------------------------------------

vi.mock("../../lib/config.js", () => ({
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
}))

vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
  pipelineOrchestrationQueue: { getJobs: vi.fn(async () => []) },
}))

vi.mock("../../ee/pipelines/credits.js", () => ({
  estimateUpfrontCredits: vi.fn(() => 30),
  resolveMaxCostCredits: vi.fn(() => 2000),
  reservePipelineCredits: vi.fn(async () => ({ ok: true, usageLogId: "ul-1" })),
  refundPipelineCredits: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/engine.js", () => ({
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  approveStage: vi.fn(async () => ({ ok: true })),
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

const applyStageEditMock = vi.fn()
vi.mock("../../ee/pipelines/chat/apply-stage-edit.js", () => ({
  applyStageEdit: applyStageEditMock,
}))

// ---------------------------------------------------------------------------
// Supabase fixtures.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const STAGE_ID = "00000000-0000-0000-0000-000000000222"
const TURN_ID = "00000000-0000-0000-0000-000000000333"
const FOLLOWUP_TURN_ID = "00000000-0000-0000-0000-000000000444"
const NEW_ATTEMPT_ID = "00000000-0000-0000-0000-000000000555"
const TEST_USER_ID = "user-1"
const OTHER_USER_ID = "user-2"

type PipelineFixture = { user_id: string } | null
type TurnFixture = {
  id: string
  pipeline_stage_id: string
  role: string
  proposed_change: unknown
  applied_to_attempt_id: string | null
  llm_call_id: string | null
} | null

let pipelineFixture: PipelineFixture = null
let turnFixture: TurnFixture = null
let maxTurnN: number | null = null

const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []

function resetFixtures() {
  pipelineFixture = null
  turnFixture = null
  maxTurnN = null
  insertedRows.length = 0
}

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: pipelineFixture, error: null }),
            single: async () => ({ data: pipelineFixture, error: null }),
          }),
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: PIPELINE_ID }, error: null }),
          }),
        }),
        delete: () => ({ eq: async () => ({ data: null, error: null }) }),
      }
    }
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { tier: "pro" }, error: null }),
          }),
        }),
      }
    }
    if (table === "pipeline_chat_turns") {
      return {
        select: () => ({
          eq: () => ({
            // First select shape: `.eq(id, turnId).maybeSingle()` — fetch turn.
            maybeSingle: async () => ({ data: turnFixture, error: null }),
            // Second shape: `.eq(stage_id).order('turn_n', desc).limit(1).maybeSingle()` — max turn_n.
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: maxTurnN == null ? null : { turn_n: maxTurnN },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertedRows.push({ table: "pipeline_chat_turns", row })
          return {
            select: () => ({
              single: async () => ({
                data: { id: FOLLOWUP_TURN_ID, turn_n: row.turn_n },
                error: null,
              }),
            }),
          }
        },
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }
  return { supabase: { from } }
})

// ---------------------------------------------------------------------------
// Imports (after mocks).
// ---------------------------------------------------------------------------

import { pipelinesRoutes } from "../pipelines.js"

async function makeApp(userId: string | null = TEST_USER_ID) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string | null }).userId = userId
    ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
  })
  await app.register(pipelinesRoutes)
  await app.ready()
  return app
}

function setHappyPathFixtures() {
  pipelineFixture = { user_id: TEST_USER_ID }
  turnFixture = {
    id: TURN_ID,
    pipeline_stage_id: STAGE_ID,
    role: "assistant",
    proposed_change: {
      change_type: "edit_artifact",
      json_patch: [{ op: "replace", path: "/title", value: "New" }],
      summary: "rename title",
    },
    applied_to_attempt_id: null,
    llm_call_id: "llm-call-1",
  }
  applyStageEditMock.mockResolvedValue({
    ok: true,
    newAttemptId: NEW_ATTEMPT_ID,
    newOutput: { title: "New", logline: "L" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFixtures()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const URL = (p = PIPELINE_ID, s = "script", t = TURN_ID) =>
  `/v1/pipelines/${p}/stages/${s}/chat/turns/${t}/apply`

describe("POST /v1/pipelines/:id/stages/:stage_name/chat/turns/:turnId/apply", () => {
  it("returns 401 when auth is missing", async () => {
    setHappyPathFixtures()
    const app = await makeApp(null)
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 403 when OAuth dev-app lacks pipelines:approve scope", async () => {
    setHappyPathFixtures()
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      ;(req as unknown as { userId: string }).userId = TEST_USER_ID
      ;(
        req as unknown as { appAuthorization: { scopes: string[] } }
      ).appAuthorization = { scopes: ["pipelines:read"] }
    })
    await app.register(pipelinesRoutes)
    await app.ready()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("returns 404 (existence-leak guard) when caller doesn't own the pipeline", async () => {
    setHappyPathFixtures()
    pipelineFixture = { user_id: OTHER_USER_ID }
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(applyStageEditMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 400 for an invalid stage_name", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: URL(PIPELINE_ID, "characters"),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    await app.close()
  })

  it("returns 501 for chat-enabled-but-unwired stage (shot_list)", async () => {
    // Phase 1D.2c — `chat_not_wired_for_stage` is the new code; replaces
    // the previous `chat_specialist_not_implemented`.
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: URL(PIPELINE_ID, "shot_list"),
    })
    expect(res.statusCode).toBe(501)
    expect(res.json().error.code).toBe("chat_not_wired_for_stage")
    expect(res.json().error.stage).toBe("shot_list")
    await app.close()
  })

  it("returns 400 for a non-uuid turnId", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: URL(PIPELINE_ID, "script", "not-a-uuid"),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    await app.close()
  })

  it("returns 404 when the turn doesn't exist", async () => {
    setHappyPathFixtures()
    turnFixture = null
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("returns 409 already_applied when turn.applied_to_attempt_id is set", async () => {
    setHappyPathFixtures()
    turnFixture = {
      ...turnFixture!,
      applied_to_attempt_id: "00000000-0000-0000-0000-00000000aaaa",
    }
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("already_applied")
    expect(applyStageEditMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 400 turn_not_applyable when role is 'user'", async () => {
    setHappyPathFixtures()
    turnFixture = { ...turnFixture!, role: "user" }
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("turn_not_applyable")
    expect(applyStageEditMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 400 turn_not_applyable when proposed_change is null (chat-only turn)", async () => {
    setHappyPathFixtures()
    turnFixture = { ...turnFixture!, proposed_change: null }
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("turn_not_applyable")
    await app.close()
  })

  it("returns 400 turn_not_applyable when change_type is 'suggest_branch'", async () => {
    setHappyPathFixtures()
    turnFixture = {
      ...turnFixture!,
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "script",
        reason: "genre change",
      },
    }
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("turn_not_applyable")
    await app.close()
  })

  it("happy path: ok=true → returns 200 + attemptId; applyStageEdit called with right args", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      applied: true,
      attemptId: NEW_ATTEMPT_ID,
      newOutput: { title: "New", logline: "L" },
    })
    expect(applyStageEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        stageName: "script",
        stageId: STAGE_ID,
        userId: TEST_USER_ID,
        source: "chat_apply",
        chatTurnId: TURN_ID,
        llmCallId: "llm-call-1",
        jsonPatch: [{ op: "replace", path: "/title", value: "New" }],
      }),
    )
    await app.close()
  })

  it("schema_invalid: returns 200 applied=false + inserts follow-up assistant turn + SSE", async () => {
    setHappyPathFixtures()
    applyStageEditMock.mockResolvedValueOnce({
      ok: false,
      reason: "schema_invalid",
      detail: [{ path: "/title", message: "string expected" }],
    })
    maxTurnN = 2
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.applied).toBe(false)
    expect(body.error.code).toBe("schema_invalid")
    expect(body.error.detail).toBeDefined()

    // Follow-up assistant turn inserted with next turn_n=3 (maxTurnN+1).
    const inserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row.role).toBe("assistant")
    expect(inserts[0].row.turn_n).toBe(3)
    expect(inserts[0].row.proposed_change).toBeNull()
    expect(inserts[0].row.llm_call_id).toBe("llm-call-1")
    expect(inserts[0].row.content).toContain("schema validation")

    // SSE emitted for the follow-up turn.
    const { pipelineEvents } = await import("../../ee/pipelines/events.js")
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat:turn",
        pipelineId: PIPELINE_ID,
        stageName: "script",
      }),
    )
    await app.close()
  })

  it("reference_integrity_failed: returns 200 applied=false + inserts hint turn", async () => {
    setHappyPathFixtures()
    applyStageEditMock.mockResolvedValueOnce({
      ok: false,
      reason: "reference_integrity_failed",
      detail: { dangling_refs: ["alice"] },
    })
    maxTurnN = 4
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(false)
    expect(res.json().error.code).toBe("reference_integrity_failed")

    const inserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row.role).toBe("assistant")
    expect(inserts[0].row.turn_n).toBe(5)
    expect(inserts[0].row.content).toContain("reference integrity")
    await app.close()
  })

  it("patch_invalid: returns 409 with reason code (no follow-up turn)", async () => {
    setHappyPathFixtures()
    applyStageEditMock.mockResolvedValueOnce({
      ok: false,
      reason: "patch_invalid",
      detail: { name: "OPERATION_PATH_INVALID" },
    })
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("patch_invalid")

    // No follow-up turn for hard failures.
    const inserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(inserts).toHaveLength(0)
    await app.close()
  })

  it("stage_not_awaiting: returns 409 with reason code", async () => {
    setHappyPathFixtures()
    applyStageEditMock.mockResolvedValueOnce({
      ok: false,
      reason: "stage_not_awaiting",
    })
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL() })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("stage_not_awaiting")
    await app.close()
  })

  // ── Phase 1D.2c C2 — post_merge stage edit_artifact rejection ────────
  it("post_merge + edit_artifact: returns 400 invalid_change_type_for_stage (defense-in-depth per spec §5.12)", async () => {
    // The chat-refine-postmerge specialist's prompt explicitly forbids
    // edit_artifact; this route-level gate catches the rare LLM regression
    // where an edit_artifact slips through.
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: URL(PIPELINE_ID, "post_merge"),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_change_type_for_stage")
    expect(res.json().error.detail).toMatch(/post_merge.*suggest_branch/i)
    // The applyStageEdit helper MUST NOT have been called — the gate runs
    // before the dispatcher.
    expect(applyStageEditMock).not.toHaveBeenCalled()
    await app.close()
  })

  // ── Phase 1D.2c C2 — post_merge stage suggest_branch acknowledgement ──
  it("post_merge + suggest_branch: returns 200 with suggested=true (no artifact mutation)", async () => {
    setHappyPathFixtures()
    turnFixture = {
      ...turnFixture!,
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "shot_list",
        reason: "Pacing tweaks require re-cutting shot boundaries.",
      },
    }
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: URL(PIPELINE_ID, "post_merge"),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.applied).toBe(false)
    expect(body.suggested).toBe(true)
    expect(body.suggested_from_stage).toBe("shot_list")
    expect(body.suggested_reason).toMatch(/pacing/i)
    // No artifact mutation — applyStageEdit not invoked.
    expect(applyStageEditMock).not.toHaveBeenCalled()
    // No follow-up turn inserted either — the suggestion stays as-is and
    // the user acts on it via the dedicated branch endpoint.
    const inserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(inserts).toHaveLength(0)
    await app.close()
  })

  it("script + suggest_branch: still returns 400 turn_not_applyable (unchanged)", async () => {
    // Defense check: the post_merge suggest_branch carve-out MUST NOT
    // leak into the script path. The frontend's ProposedChangeCard hides
    // the Apply button for suggest_branch, so this is purely a contract
    // assertion — no UX regression.
    setHappyPathFixtures()
    turnFixture = {
      ...turnFixture!,
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "script",
        reason: "genre change",
      },
    }
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: URL(PIPELINE_ID, "script"),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("turn_not_applyable")
    expect(applyStageEditMock).not.toHaveBeenCalled()
    await app.close()
  })
})
