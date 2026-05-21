/**
 * Phase 1D.2b J1 — MCP chat tool unit tests.
 *
 * Three tools:
 *  - chat_pipeline_stage     (pipelines:approve)
 *  - apply_chat_proposal     (pipelines:approve)
 *  - get_pipeline_stage_chat (pipelines:read)
 *
 * Mirrors `routes/__tests__/pipelines-chat.test.ts`: per-table mutable fixture
 * state + vi.mock for the two ee/ service helpers + the pipelineEvents broker.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

// ---------------------------------------------------------------------------
// Service mocks — hoisted before any tool import.
// ---------------------------------------------------------------------------

const runChatRefineShowrunnerMock = vi.fn()
vi.mock("../../../../ee/pipelines/llms/chat-refine-showrunner.js", () => ({
  runChatRefineShowrunner: runChatRefineShowrunnerMock,
}))

const applyStageEditMock = vi.fn()
vi.mock("../../../../ee/pipelines/chat/apply-stage-edit.js", () => ({
  applyStageEdit: applyStageEditMock,
}))

const publishMock = vi.fn()
vi.mock("../../../../ee/pipelines/events.js", () => ({
  pipelineEvents: {
    publish: publishMock,
    subscribe: vi.fn(() => () => undefined),
  },
}))

// ---------------------------------------------------------------------------
// Mutable fixture state — overridable per-test.
// ---------------------------------------------------------------------------

const TEST_USER_ID = "u1"
const PIPELINE_ID = "aaaaaaaa-0000-4000-8000-000000000001"
const STAGE_ID = "bbbbbbbb-0000-4000-8000-000000000001"
const USER_TURN_ID = "cccccccc-0000-4000-8000-000000000001"
const ASSISTANT_TURN_ID = "dddddddd-0000-4000-8000-000000000001"
const APPLYABLE_TURN_ID = "eeeeeeee-0000-4000-8000-000000000001"
const NEW_ATTEMPT_ID = "ffffffff-0000-4000-8000-000000000001"

type PipelineFixture = { user_id: string; mode: string } | null
type StageFixture = {
  id: string
  status: string
  output: Record<string, unknown> | null
} | null
type TurnFixture = {
  id: string
  pipeline_stage_id: string
  role: string
  proposed_change: unknown
  applied_to_attempt_id: string | null
  llm_call_id: string | null
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
let turnFixture: TurnFixture = null
const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []

function resetFixtures() {
  pipelineFixture = null
  stageFixture = null
  userTurnCount = 0
  maxTurnN = null
  allTurns = []
  turnFixture = null
  insertedRows.length = 0
}

// ---------------------------------------------------------------------------
// Supabase mock — supports the per-tool query shapes.
// ---------------------------------------------------------------------------

vi.mock("../../../supabase.js", () => {
  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: pipelineFixture, error: null }),
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
          // Single-row lookup by turn id (apply_chat_proposal).
          return {
            eq: (_col?: string, _val?: string) => ({
              maybeSingle: async () => ({ data: turnFixture, error: null }),
              order: (_col2: string, opts2: { ascending: boolean }) => {
                if (opts2.ascending === false) {
                  return {
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: maxTurnN == null ? null : { turn_n: maxTurnN },
                        error: null,
                      }),
                    }),
                  }
                }
                // ascending = full chat history (load OR GET tool)
                const result = { data: allTurns, error: null }
                return {
                  then: (resolve: (v: typeof result) => unknown) =>
                    resolve(result),
                }
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
                    : { id: ASSISTANT_TURN_ID, turn_n: row.turn_n },
                error: null,
              }),
            }),
          }
        },
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }
  return { supabase: { from } }
})

// ---------------------------------------------------------------------------
// Import the registrar AFTER the supabase + service mocks.
// ---------------------------------------------------------------------------

const { registerPipelineTools } = await import("../pipelines.js")

function pipelineSession(scopes: Scope[]): McpSession {
  return newSession({ userId: TEST_USER_ID, scopes, clientName: "Claude" })
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
      reply: "Sure — here's a tighter title.",
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

// ===========================================================================
// chat_pipeline_stage
// ===========================================================================

describe("chat_pipeline_stage — scope gate", () => {
  it("does NOT register without pipelines:approve scope", async () => {
    const server = buildServer()
    registerPipelineTools({ server, session: pipelineSession([]) })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("chat_pipeline_stage")
  })

  it("registers with pipelines:approve scope", async () => {
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("chat_pipeline_stage")
  })
})

describe("chat_pipeline_stage — happy path", () => {
  it("inserts user + assistant turns and returns the assistant reply", async () => {
    setHappyPathFixtures()
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "chat_pipeline_stage", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      message: "Make the title shorter",
    })
    expect(result.isError).toBeUndefined()

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

    // Response body contains the assistant turn id + reply + proposed_change.
    const text = result.content[0]?.text ?? ""
    expect(text).toContain(ASSISTANT_TURN_ID)
    expect(text).toContain("tighter title")
    expect(text).toContain("edit_artifact")

    // SSE published.
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat:turn",
        pipelineId: PIPELINE_ID,
        stageName: "script",
      }),
    )
  })
})

describe("chat_pipeline_stage — error branches", () => {
  it("returns isError when turn cap is reached (409 equivalent)", async () => {
    setHappyPathFixtures()
    userTurnCount = 20 // script cap = 20

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "chat_pipeline_stage", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      message: "hi",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/cap reached/i)
  })

  it("returns isError when the specialist throws (502 equivalent)", async () => {
    setHappyPathFixtures()
    runChatRefineShowrunnerMock.mockRejectedValueOnce(new Error("upstream down"))

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "chat_pipeline_stage", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      message: "hi",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/llm unavailable/i)
  })

  it("returns isError when pipeline is not in 'guided' mode", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "auto" }
    stageFixture = {
      id: STAGE_ID,
      status: "awaiting_approval",
      output: { plan: {} },
    }
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "chat_pipeline_stage", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      message: "hi",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/guided/i)
  })

  it("returns isError when pipeline is owned by another user", async () => {
    pipelineFixture = { user_id: "other-user", mode: "guided" }
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "chat_pipeline_stage", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      message: "hi",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/i)
  })
})

// ===========================================================================
// apply_chat_proposal
// ===========================================================================

describe("apply_chat_proposal — scope gate", () => {
  it("does NOT register without pipelines:approve scope", async () => {
    const server = buildServer()
    registerPipelineTools({ server, session: pipelineSession([]) })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("apply_chat_proposal")
  })

  it("registers with pipelines:approve scope", async () => {
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("apply_chat_proposal")
  })
})

describe("apply_chat_proposal — happy path", () => {
  it("invokes applyStageEdit and returns applied:true", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    turnFixture = {
      id: APPLYABLE_TURN_ID,
      pipeline_stage_id: STAGE_ID,
      role: "assistant",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: [{ op: "replace", path: "/title", value: "New" }],
        summary: "rename",
      },
      applied_to_attempt_id: null,
      llm_call_id: "llm-call-1",
    }
    applyStageEditMock.mockResolvedValueOnce({
      ok: true,
      newAttemptId: NEW_ATTEMPT_ID,
      newOutput: { title: "New", logline: "L" },
    })

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "apply_chat_proposal", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      turn_id: APPLYABLE_TURN_ID,
    })
    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text ?? ""
    expect(text).toContain('"applied":true')
    expect(text).toContain(NEW_ATTEMPT_ID)

    expect(applyStageEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        stageName: "script",
        stageId: STAGE_ID,
        userId: TEST_USER_ID,
        source: "chat_apply",
        chatTurnId: APPLYABLE_TURN_ID,
      }),
    )
  })
})

describe("apply_chat_proposal — error branches", () => {
  it("returns isError when the turn has already been applied (409)", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    turnFixture = {
      id: APPLYABLE_TURN_ID,
      pipeline_stage_id: STAGE_ID,
      role: "assistant",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: [{ op: "replace", path: "/title", value: "X" }],
        summary: "x",
      },
      applied_to_attempt_id: "prior-attempt",
      llm_call_id: "llm-call-1",
    }

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "apply_chat_proposal", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      turn_id: APPLYABLE_TURN_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/already been applied/i)
    expect(applyStageEditMock).not.toHaveBeenCalled()
  })

  it("returns isError when applyStageEdit reports stage_not_awaiting", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    turnFixture = {
      id: APPLYABLE_TURN_ID,
      pipeline_stage_id: STAGE_ID,
      role: "assistant",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: [{ op: "replace", path: "/title", value: "X" }],
        summary: "x",
      },
      applied_to_attempt_id: null,
      llm_call_id: "llm-call-1",
    }
    applyStageEditMock.mockResolvedValueOnce({
      ok: false,
      reason: "stage_not_awaiting",
    })

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "apply_chat_proposal", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      turn_id: APPLYABLE_TURN_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/no longer awaiting approval/i)
  })

  it("returns isError when the turn is not applyable (suggest_branch)", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    turnFixture = {
      id: APPLYABLE_TURN_ID,
      pipeline_stage_id: STAGE_ID,
      role: "assistant",
      // suggest_branch — not an edit_artifact, so not applyable.
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "script",
        reason: "too big",
      },
      applied_to_attempt_id: null,
      llm_call_id: "llm-call-1",
    }

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:approve"] as Scope[]),
    })
    const result = await callTool(server, "apply_chat_proposal", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
      turn_id: APPLYABLE_TURN_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not applyable/i)
    expect(applyStageEditMock).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// get_pipeline_stage_chat
// ===========================================================================

describe("get_pipeline_stage_chat — scope gate", () => {
  it("does NOT register without pipelines:read scope", async () => {
    const server = buildServer()
    registerPipelineTools({ server, session: pipelineSession([]) })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("get_pipeline_stage_chat")
  })

  it("registers with pipelines:read scope", async () => {
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("get_pipeline_stage_chat")
  })
})

describe("get_pipeline_stage_chat — happy path", () => {
  it("returns turns ordered by turn_n ascending", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = {
      id: STAGE_ID,
      status: "awaiting_approval",
      output: null,
    }
    allTurns = [
      {
        id: "t1",
        turn_n: 1,
        role: "user",
        content: "tighten the title",
        proposed_change: null,
        applied_to_attempt_id: null,
        llm_call_id: null,
        created_at: "2026-05-20T00:00:00Z",
      },
      {
        id: "t2",
        turn_n: 2,
        role: "assistant",
        content: "Sure — here's a patch.",
        proposed_change: {
          change_type: "edit_artifact",
          json_patch: [{ op: "replace", path: "/title", value: "New" }],
          summary: "rename",
        },
        applied_to_attempt_id: null,
        llm_call_id: "llm-call-1",
      },
    ] as unknown as typeof allTurns

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "get_pipeline_stage_chat", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
    })
    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text ?? ""
    expect(text).toContain('"turn_n":1')
    expect(text).toContain('"turn_n":2')
    expect(text).toContain("tighten the title")
    expect(text).toContain("Sure — here's a patch.")
    // Verify ordering: turn 1 appears before turn 2 in the serialized output.
    expect(text.indexOf('"turn_n":1')).toBeLessThan(text.indexOf('"turn_n":2'))
  })

  it("returns empty turns when the stage row does not exist yet", async () => {
    pipelineFixture = { user_id: TEST_USER_ID, mode: "guided" }
    stageFixture = null

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "get_pipeline_stage_chat", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"turns":[]')
  })

  it("returns isError when pipeline is owned by another user", async () => {
    pipelineFixture = { user_id: "other-user", mode: "guided" }

    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "get_pipeline_stage_chat", {
      pipeline_id: PIPELINE_ID,
      stage: "script",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/i)
  })
})
