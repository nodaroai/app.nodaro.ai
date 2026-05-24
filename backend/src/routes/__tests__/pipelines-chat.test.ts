/**
 * Phase 1D.2b H1 + H3 — route tests for the chat REST surface.
 *
 *   POST /v1/pipelines/:id/stages/:stage_name/chat       (H1)
 *   GET  /v1/pipelines/:id/stages/:stage_name/chat       (H3)
 *
 * The chat-refine-showrunner specialist + downstream queue/SSE are mocked so
 * these tests focus on the routing layer: auth, scope, Zod validation,
 * ownership check, mode/status guards, turn-cap enforcement, and the
 * 2-row-insert happy path.
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

// ---------------------------------------------------------------------------
// chat-refine-showrunner mock. Tests control its return/throw per-case.
// ---------------------------------------------------------------------------

const runChatRefineShowrunnerMock = vi.fn()
vi.mock("../../ee/pipelines/llms/chat-refine-showrunner.js", () => ({
  runChatRefineShowrunner: runChatRefineShowrunnerMock,
}))

// ---------------------------------------------------------------------------
// chat-refine-postmerge mock (Phase 1D.2c).
// ---------------------------------------------------------------------------

const runChatRefinePostMergeMock = vi.fn()
vi.mock("../../ee/pipelines/llms/chat-refine-postmerge.js", () => ({
  runChatRefinePostMerge: runChatRefinePostMergeMock,
}))

// ---------------------------------------------------------------------------
// Supabase mock with mutable per-test fixture state. Each table builder
// reads from a small set of module-level fixtures the tests overwrite via
// the `set*` helpers below.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const STAGE_ID = "00000000-0000-0000-0000-000000000222"
const USER_TURN_ID = "00000000-0000-0000-0000-000000000333"
const ASSISTANT_TURN_ID = "00000000-0000-0000-0000-000000000444"
const TEST_USER_ID = "user-1"
const OTHER_USER_ID = "user-2"

type PipelineFixture = {
  user_id: string
  mode: string
} | null

type StageFixture = {
  id: string
  status: string
  output: Record<string, unknown> | null
} | null

let pipelineFixture: PipelineFixture = null
let stageFixture: StageFixture = null
let userTurnCount = 0
let maxTurnN: number | null = null
let allTurns: Array<{
  id: string
  turn_n: number
  role: string
  content: string
  proposed_change: unknown
  applied_to_attempt_id: string | null
  llm_call_id: string | null
  created_at: string
}> = []

const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []

function resetFixtures() {
  pipelineFixture = null
  stageFixture = null
  userTurnCount = 0
  maxTurnN = null
  allTurns = []
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
    if (table === "pipeline_stages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: stageFixture, error: null }),
            }),
            maybeSingle: async () => ({ data: stageFixture, error: null }),
          }),
        }),
      }
    }
    if (table === "pipeline_chat_turns") {
      return {
        select: (
          _cols?: string,
          opts?: { count?: "exact"; head?: boolean },
        ) => {
          // count-only query for the cap check.
          if (opts?.count === "exact" && opts.head === true) {
            return {
              eq: () => ({
                eq: async () => ({
                  data: null,
                  error: null,
                  count: userTurnCount,
                }),
              }),
            }
          }
          // Two query shapes:
          //   - .eq(stage).order(desc).limit(1).maybeSingle()   → max turn_n
          //   - .eq(stage).order(asc)                          → all turns
          return {
            eq: () => ({
              order: (_col: string, opts2: { ascending: boolean }) => {
                if (opts2.ascending === false) {
                  return {
                    limit: () => ({
                      maybeSingle: async () => ({
                        data:
                          maxTurnN == null ? null : { turn_n: maxTurnN },
                        error: null,
                      }),
                    }),
                  }
                }
                // ascending — for full chat history fetch (priorTurns load
                // + GET /chat). Returns thenable so `await q` resolves and
                // also `.eq` chains continue if route extends the query.
                const result = { data: allTurns, error: null }
                const thenable = {
                  then: (resolve: (v: typeof result) => unknown) =>
                    resolve(result),
                }
                return thenable
              },
            }),
          }
        },
        insert: (row: Record<string, unknown>) => {
          insertedRows.push({ table: "pipeline_chat_turns", row })
          const role = row.role as string
          return {
            select: () => ({
              single: async () => ({
                data:
                  role === "user"
                    ? { id: USER_TURN_ID }
                    : {
                        id: ASSISTANT_TURN_ID,
                        turn_n: row.turn_n,
                      },
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

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

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
  pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
  stageFixture = {
    id: STAGE_ID,
    status: "awaiting_approval",
    output: { plan: { title: "T", logline: "L" } },
  }
  userTurnCount = 0
  maxTurnN = null
  runChatRefineShowrunnerMock.mockResolvedValue({
    response: {
      reply: "Sure — here's a change.",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: [{ op: "replace", path: "/title", value: "New" }],
        summary: "rename title",
      },
    },
    llmCallId: "llm-call-1",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFixtures()
})

// ---------------------------------------------------------------------------
// POST /v1/pipelines/:id/stages/:stage_name/chat — H1
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/stages/:stage_name/chat", () => {
  it("happy path: user turn + assistant turn inserted, SSE published, specialist called", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "Make the title shorter" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.turnId).toBe(ASSISTANT_TURN_ID)
    expect(body.role).toBe("assistant")
    expect(body.content).toBe("Sure — here's a change.")
    expect(body.proposed_change?.change_type).toBe("edit_artifact")

    // 2 inserts: user (turn_n=1) + assistant (turn_n=2).
    const turnInserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(turnInserts).toHaveLength(2)
    expect(turnInserts[0].row.role).toBe("user")
    expect(turnInserts[0].row.turn_n).toBe(1)
    expect(turnInserts[1].row.role).toBe("assistant")
    expect(turnInserts[1].row.turn_n).toBe(2)
    expect(turnInserts[1].row.llm_call_id).toBe("llm-call-1")

    // Specialist called with the right args.
    expect(runChatRefineShowrunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        stageId: STAGE_ID,
        userId: TEST_USER_ID,
        userMessage: "Make the title shorter",
        currentPlan: { title: "T", logline: "L" },
      }),
    )

    // SSE published.
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

  it("returns 401 when auth is missing", async () => {
    setHappyPathFixtures()
    const app = await makeApp(null)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 404 (existence-leak guard) when caller doesn't own the pipeline", async () => {
    pipelineFixture = { user_id: OTHER_USER_ID, mode: "guided" }
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("returns 400 for an invalid stage_name (not in CHAT_ENABLED_STAGES)", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/characters/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_stage")
    await app.close()
  })

  it("returns 501 for chat-enabled-but-unwired stages (shot_list)", async () => {
    // Phase 1D.2c — shot_list is in CHAT_ENABLED_STAGES (so it passes the
    // Zod enum) but CHAT_WIRED_STAGES.shot_list === false, so the route
    // returns 501 with the new `chat_not_wired_for_stage` code instead of
    // the legacy `chat_specialist_not_implemented`.
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/shot_list/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(501)
    expect(res.json().error.code).toBe("chat_not_wired_for_stage")
    expect(res.json().error.stage).toBe("shot_list")
    await app.close()
  })

  it("returns 409 chat_unavailable when pipeline.mode !== 'guided'", async () => {
    setHappyPathFixtures()
    pipelineFixture = { user_id: TEST_USER_ID, mode: "auto" }
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("chat_unavailable")
    await app.close()
  })

  it("returns 409 chat_unavailable when stage.status !== 'awaiting_approval'", async () => {
    setHappyPathFixtures()
    stageFixture = {
      id: STAGE_ID,
      status: "running",
      output: { plan: {} },
    }
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("chat_unavailable")
    await app.close()
  })

  it("returns 409 chat_turn_cap_reached when 20+ user turns already exist", async () => {
    setHappyPathFixtures()
    userTurnCount = 20
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("chat_turn_cap_reached")
    expect(res.json().error.cap).toBe(20)
    // Specialist must NOT be called when cap is breached.
    expect(runChatRefineShowrunnerMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 502 llm_unavailable when specialist throws (user turn persists)", async () => {
    setHappyPathFixtures()
    runChatRefineShowrunnerMock.mockRejectedValueOnce(new Error("LLM down"))
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_unavailable")
    // User turn was inserted before the throw; we explicitly DO NOT clean it
    // up — the audit trail + retry path requires it.
    const turnInserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(turnInserts).toHaveLength(1)
    expect(turnInserts[0].row.role).toBe("user")
    await app.close()
  })

  it("rejects empty message body with 400 validation_error", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    await app.close()
  })

  it("returns 400 for an over-cap message (>8000 chars)", async () => {
    setHappyPathFixtures()
    const app = await makeApp()
    const big = "a".repeat(8001)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: big },
    })
    expect(res.statusCode).toBe(400)
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
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  // ── Phase 1D.2c C1 — post_merge dispatch ───────────────────────────────
  it("post_merge: happy path — dispatches to runChatRefinePostMerge with the stage artifact", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = {
      id: STAGE_ID,
      status: "awaiting_approval",
      output: {
        final_output_url: "https://r2/final.mp4",
        cut_decisions: [
          { shot_id: "s1_shot1", cut_kind: "hard_cut", out_point_seconds: 2.5 },
        ],
        final_duration_seconds: 42,
        beat_grid_used: [0.5, 1.0, 1.5],
      },
    }
    runChatRefinePostMergeMock.mockResolvedValue({
      output: {
        reply: "Re-run from shot_list to fix the pacing.",
        proposed_change: {
          change_type: "suggest_branch",
          from_stage: "shot_list",
          reason: "Pacing tweaks require re-cutting shot boundaries.",
        },
      },
      llmCallId: "llm-pm-1",
    })

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/post_merge/chat`,
      payload: { message: "the climax feels rushed" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.role).toBe("assistant")
    expect(body.content).toContain("Re-run from shot_list")
    expect(body.proposed_change?.change_type).toBe("suggest_branch")

    // Specialist called with the artifact fields from the stage output.
    expect(runChatRefinePostMergeMock).toHaveBeenCalledTimes(1)
    expect(runChatRefineShowrunnerMock).not.toHaveBeenCalled()
    const args = runChatRefinePostMergeMock.mock.calls[0][0]
    expect(args.pipelineId).toBe(PIPELINE_ID)
    expect(args.stageId).toBe(STAGE_ID)
    expect(args.userId).toBe(TEST_USER_ID)
    expect(args.userMessage).toBe("the climax feels rushed")
    expect(args.finalOutputUrl).toBe("https://r2/final.mp4")
    expect(args.cutDecisions).toHaveLength(1)
    expect(args.finalDurationSeconds).toBe(42)
    expect(args.beatGridUsed).toEqual([0.5, 1.0, 1.5])

    // Both turn rows inserted (user + assistant).
    const turnInserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(turnInserts).toHaveLength(2)
    expect(turnInserts[1].row.llm_call_id).toBe("llm-pm-1")
    await app.close()
  })

  it("post_merge: returns 409 stage_artifact_incomplete when no final_output_url", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = {
      id: STAGE_ID,
      status: "awaiting_approval",
      output: {
        // Final URL not yet persisted — e.g. the user opens chat while the
        // post-merge handler is still running.
        cut_decisions: [],
        final_duration_seconds: 0,
      },
    }
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/post_merge/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("stage_artifact_incomplete")
    expect(res.json().error.stage).toBe("post_merge")
    expect(runChatRefinePostMergeMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("post_merge: returns 502 llm_unavailable when the specialist throws", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = {
      id: STAGE_ID,
      status: "awaiting_approval",
      output: { final_output_url: "https://r2/final.mp4" },
    }
    runChatRefinePostMergeMock.mockRejectedValueOnce(new Error("502 down"))
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/post_merge/chat`,
      payload: { message: "hi" },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_unavailable")
    // User turn persisted before the throw — mirrors the script path.
    const turnInserts = insertedRows.filter(
      (r) => r.table === "pipeline_chat_turns",
    )
    expect(turnInserts).toHaveLength(1)
    expect(turnInserts[0].row.role).toBe("user")
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// GET /v1/pipelines/:id/stages/:stage_name/chat — H3
// ---------------------------------------------------------------------------

describe("GET /v1/pipelines/:id/stages/:stage_name/chat", () => {
  it("returns 401 when auth is missing", async () => {
    const app = await makeApp(null)
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 404 (existence-leak guard) when caller doesn't own the pipeline", async () => {
    pipelineFixture = { user_id: OTHER_USER_ID, mode: "guided" }
    const app = await makeApp()
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("returns 400 for an invalid stage_name", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    const app = await makeApp()
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/not_a_stage/chat`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_stage")
    await app.close()
  })

  it("returns empty list when no stage row exists yet", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = null
    const app = await makeApp()
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ turns: [] })
    await app.close()
  })

  it("returns turns ordered by turn_n ascending", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = {
      id: STAGE_ID,
      status: "awaiting_approval",
      output: { plan: {} },
    }
    // Ascending fixture — the route doesn't re-sort but the underlying query
    // does. This test pins the contract.
    allTurns = [
      {
        id: "t1",
        turn_n: 1,
        role: "user",
        content: "hi",
        proposed_change: null,
        applied_to_attempt_id: null,
        llm_call_id: null,
        created_at: "2026-05-20T00:00:00.000Z",
      },
      {
        id: "t2",
        turn_n: 2,
        role: "assistant",
        content: "hey",
        proposed_change: null,
        applied_to_attempt_id: null,
        llm_call_id: "llm-1",
        created_at: "2026-05-20T00:00:01.000Z",
      },
      {
        id: "t3",
        turn_n: 3,
        role: "user",
        content: "another",
        proposed_change: null,
        applied_to_attempt_id: null,
        llm_call_id: null,
        created_at: "2026-05-20T00:00:02.000Z",
      },
    ]
    const app = await makeApp()
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      turns: Array<{ id: string; turn_n: number }>
    }
    expect(body.turns).toHaveLength(3)
    expect(body.turns.map((t) => t.turn_n)).toEqual([1, 2, 3])
    await app.close()
  })

  it("returns 403 when OAuth dev-app lacks pipelines:read scope", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      ;(req as unknown as { userId: string }).userId = TEST_USER_ID
      ;(
        req as unknown as { appAuthorization: { scopes: string[] } }
      ).appAuthorization = { scopes: [] }
    })
    await app.register(pipelinesRoutes)
    await app.ready()
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${PIPELINE_ID}/stages/script/chat`,
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
