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
