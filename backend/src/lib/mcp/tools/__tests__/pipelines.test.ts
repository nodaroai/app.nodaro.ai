/**
 * Phase 1D.3 — branch_pipeline MCP tool unit tests.
 *
 * Mirrors the pattern in `workflows.test.ts` and `jobs.test.ts`:
 *  - vi.mock the supabase module so DB calls are controlled
 *  - vi.mock the branch-pipeline service so we don't spin up BullMQ
 *  - Use _helpers.ts `buildServer` / `callTool` / `listTools`
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import { supabase } from "../../../supabase.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

// Mock the branchPipeline service so the tool doesn't touch the DB or queue.
const mockBranchPipeline = vi.fn()
const MockBranchPipelineError = class BranchPipelineError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "BranchPipelineError"
  }
}

vi.mock("../../../../ee/pipelines/branch-pipeline.js", () => ({
  branchPipeline: (...args: unknown[]) => mockBranchPipeline(...args),
  BranchPipelineError: MockBranchPipelineError,
}))

// Mock the createPipeline service (Phase 2 start_pipeline tool) so the tool
// doesn't touch the DB or queue.
const mockCreatePipeline = vi.fn()
vi.mock("../../../../ee/pipelines/create-pipeline.js", () => ({
  createPipeline: (...args: unknown[]) => mockCreatePipeline(...args),
}))

const { registerPipelineTools } = await import("../pipelines.js")

const PIPELINE_ID = "aaaaaaaa-0000-4000-8000-000000000001"
const NEW_PIPELINE_ID = "bbbbbbbb-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
})

function pipelineSession(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

// ── scope gate ───────────────────────────────────────────────────────────────

describe("branch_pipeline scope gate", () => {
  it("does NOT register without pipelines:execute scope", async () => {
    const server = buildServer()
    registerPipelineTools({ server, session: pipelineSession([]) })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("branch_pipeline")
  })

  it("registers with pipelines:execute scope", async () => {
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("branch_pipeline")
  })
})

// ── successful branch ─────────────────────────────────────────────────────────

describe("branch_pipeline tool — success", () => {
  it("invokes branchPipeline service with the correct args", async () => {
    mockBranchPipeline.mockResolvedValueOnce({
      newPipelineId: NEW_PIPELINE_ID,
      clonedStages: ["script"],
      clonedEntities: 5,
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    await callTool(server, "branch_pipeline", {
      pipeline_id: PIPELINE_ID,
      from_stage: "characters",
    })
    expect(mockBranchPipeline).toHaveBeenCalledOnce()
    const callArgs = mockBranchPipeline.mock.calls[0][0]
    expect(callArgs.originalPipelineId).toBe(PIPELINE_ID)
    expect(callArgs.fromStage).toBe("characters")
    expect(callArgs.userId).toBe("u1")
  })

  it("returns descriptive text content with the new pipeline id and counts", async () => {
    mockBranchPipeline.mockResolvedValueOnce({
      newPipelineId: NEW_PIPELINE_ID,
      clonedStages: ["script", "characters"],
      clonedEntities: 7,
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const result = await callTool(server, "branch_pipeline", {
      pipeline_id: PIPELINE_ID,
      from_stage: "locations",
    })
    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text ?? ""
    expect(text).toContain(NEW_PIPELINE_ID)
    expect(text).toContain("2 stages")
    expect(text).toContain("7 entities")
  })
})

// ── service error handling ────────────────────────────────────────────────────

describe("branch_pipeline tool — BranchPipelineError handling", () => {
  it("returns isError=true on pipeline_not_found", async () => {
    mockBranchPipeline.mockRejectedValueOnce(
      new MockBranchPipelineError("pipeline_not_found", "Pipeline not found"),
    )
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const result = await callTool(server, "branch_pipeline", {
      pipeline_id: PIPELINE_ID,
      from_stage: "script",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })

  it("returns isError=true on pipeline_not_completed", async () => {
    mockBranchPipeline.mockRejectedValueOnce(
      new MockBranchPipelineError("pipeline_not_completed", "Pipeline is not completed"),
    )
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const result = await callTool(server, "branch_pipeline", {
      pipeline_id: PIPELINE_ID,
      from_stage: "script",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not completed")
  })

  it("returns isError=true on forbidden", async () => {
    mockBranchPipeline.mockRejectedValueOnce(
      new MockBranchPipelineError("forbidden", "Pipeline belongs to a different user"),
    )
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const result = await callTool(server, "branch_pipeline", {
      pipeline_id: PIPELINE_ID,
      from_stage: "script",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("permission")
  })
})

// ── start_pipeline ─────────────────────────────────────────────────────────────

const START_ARGS = {
  story_prompt: "A lighthouse keeper at dawn",
  target_duration_seconds: 15,
  format: "reel",
  mode: "auto",
  output_resolution: "720p",
  music_enabled: true,
  narration_enabled: false,
  lipsync_enabled: false,
}

describe("start_pipeline scope gate", () => {
  it("does NOT register without pipelines:execute scope", async () => {
    const server = buildServer()
    registerPipelineTools({ server, session: pipelineSession([]) })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("start_pipeline")
  })

  it("registers with pipelines:execute scope", async () => {
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("start_pipeline")
  })
})

describe("start_pipeline tool — success", () => {
  it("parses input (synthetic root_node_id) + calls createPipeline + returns the new id", async () => {
    mockCreatePipeline.mockResolvedValueOnce({ ok: true, pipelineId: NEW_PIPELINE_ID })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const result = await callTool(server, "start_pipeline", START_ARGS)
    expect(result.isError).toBeUndefined()
    expect(mockCreatePipeline).toHaveBeenCalledOnce()
    const callArgs = mockCreatePipeline.mock.calls[0][0]
    expect(callArgs.userId).toBe("u1")
    expect(callArgs.input.story_prompt).toBe("A lighthouse keeper at dawn")
    expect(callArgs.input.mode).toBe("auto")
    expect(callArgs.input.pipeline_type).toBe("story_to_video")
    expect(typeof callArgs.input.root_node_id).toBe("string")
    expect(callArgs.input.root_node_id.length).toBeGreaterThan(0)
    expect(result.content[0]?.text).toContain(NEW_PIPELINE_ID)
  })
})

describe("start_pipeline tool — failure", () => {
  it("returns isError=true with the service error code", async () => {
    mockCreatePipeline.mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: "model_pin_forbidden",
      model: "veo3",
      message: "You can't pin 'veo3' on this plan.",
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:execute"] as Scope[]),
    })
    const result = await callTool(server, "start_pipeline", START_ARGS)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("model_pin_forbidden")
  })
})

// ── Phase 2: read-only monitoring tools ───────────────────────────────────────

const mockFrom = supabase.from as unknown as {
  mockReturnValue: (v: unknown) => unknown
  mockImplementation: (fn: (table?: string) => unknown) => unknown
}

describe("get_pipeline_status (pipelines:read)", () => {
  it("does NOT register without pipelines:read scope", async () => {
    const server = buildServer()
    registerPipelineTools({ server, session: pipelineSession([]) })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("get_pipeline_status")
  })

  it("returns the owner-scoped record with user_id stripped", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: PIPELINE_ID,
              status: "running",
              current_stage: "characters",
              user_id: "u1",
            },
            error: null,
          }),
        }),
      }),
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "get_pipeline_status", {
      pipeline_id: PIPELINE_ID,
    })
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text as string)
    expect(payload.status).toBe("running")
    expect(payload.current_stage).toBe("characters")
    expect(payload.user_id).toBeUndefined()
  })

  it("returns not-found when the pipeline belongs to another user", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: PIPELINE_ID, status: "running", user_id: "someone-else" },
            error: null,
          }),
        }),
      }),
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "get_pipeline_status", {
      pipeline_id: PIPELINE_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })
})

describe("pipeline_pending_approvals (pipelines:read)", () => {
  it("lists stages awaiting approval", async () => {
    mockFrom.mockImplementation((table?: string) => {
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { user_id: "u1" }, error: null }),
            }),
          }),
        }
      }
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [{ stage_name: "script", output: { plan: {} } }],
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "pipeline_pending_approvals", {
      pipeline_id: PIPELINE_ID,
    })
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text as string)
    expect(payload.pending).toHaveLength(1)
    expect(payload.pending[0].stage_name).toBe("script")
  })

  it("returns not-found for a non-owned pipeline (no stage query)", async () => {
    mockFrom.mockImplementation((table?: string) => {
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { user_id: "other" }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`should not query ${table} for a non-owned pipeline`)
    })
    const server = buildServer()
    registerPipelineTools({
      server,
      session: pipelineSession(["pipelines:read"] as Scope[]),
    })
    const result = await callTool(server, "pipeline_pending_approvals", {
      pipeline_id: PIPELINE_ID,
    })
    expect(result.isError).toBe(true)
  })
})
