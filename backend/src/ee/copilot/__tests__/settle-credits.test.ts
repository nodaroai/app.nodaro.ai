/**
 * Settling a turn's credits. The reservation is a CEILING and
 * `commit_credits` charges the full reservation when a metered commit is
 * handed no cost — so "commit whenever the turn did something" billed a
 * user's whole balance for pressing Stop two seconds in. Nothing spent,
 * nothing charged.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"

const { commitMock, refundMock, fromMock, jobPatches, loopResult } = vi.hoisted(() => ({
  commitMock: vi.fn(),
  refundMock: vi.fn(),
  fromMock: vi.fn(),
  jobPatches: [] as Record<string, unknown>[],
  loopResult: {
    value: null as null | Record<string, unknown>,
    error: null as null | Error,
  },
}))

vi.mock("@/workers/shared.js", () => ({ commitJobCredits: commitMock }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: refundMock }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn() }))
vi.mock("@/lib/mcp/server.js", () => ({ buildMcpServer: async () => ({}) }))
vi.mock("@/lib/mcp/invoke.js", () => ({
  createMcpInvoker: () => ({ listTools: async () => [], callTool: async () => ({ content: [] }), close: async () => undefined }),
}))
vi.mock("../budget.js", () => ({ resolveTurnBudget: async () => ({ limitUsd: 1, reservedCredits: 150 }) }))
vi.mock("../context-snapshot.js", () => ({ buildContextPreamble: async () => "<workflow-context>ctx</workflow-context>" }))
vi.mock("../system-prompt.js", () => ({ buildSystemPrompt: () => "system" }))
vi.mock("../tools/registry.js", () => ({ buildToolDefinitions: async () => [] }))
vi.mock("../store.js", () => ({
  appendMessage: vi.fn().mockResolvedValue({ id: "msg1" }),
  bumpThreadActivity: vi.fn(),
  finishTurn: vi.fn(),
  isCancelRequested: async () => false,
  listRecentMessages: async () => [],
  nextSeq: async () => 1,
  touchTurnHeartbeat: vi.fn(),
  updateTurnProgress: vi.fn(),
  // The real one: OFF unless the thread explicitly says otherwise. Stubbing
  // it true here would quietly grant this fixture an exemption it never asked
  // for.
  threadAllowsPublishing: (t: { allow_publishing?: boolean }) => t.allow_publishing === true,
}))
vi.mock("../agent-loop.js", () => ({
  runAgentLoop: async () => {
    if (loopResult.error) throw loopResult.error
    return loopResult.value
  },
}))

const { runCopilotTurn } = await import("../turn-runner.js")

function chain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { credits_actual: 7 } }),
    update: vi.fn((patch: Record<string, unknown>) => {
      jobPatches.push(patch)
      return { eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [] }) }
    }),
  }
}

const input = () => ({
  req: { log: { error: vi.fn() } } as never,
  fastify: {} as never,
  thread: { id: "th1" } as never,
  turn: { id: "turn1", job_id: "job1" } as never,
  userId: "u1",
  workflowId: "wf1",
  projectId: "p1",
  workflowName: "W",
  version: 1,
  nodes: [],
  edges: [],
  message: "hi",
  tier: "standard" as const,
  caps: { maxIterations: 12, maxToolCalls: 24, wallClockMs: 8 * 60_000, hardTimeoutMs: 9 * 60_000 },
  usageLogId: "log1",
  reservedCredits: 150,
  emit: vi.fn(),
  signal: new AbortController().signal,
})

function loop(overrides: Record<string, unknown>) {
  return {
    stopReason: "completed",
    messages: [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ] as Anthropic.Messages.MessageParam[],
    assistantText: "done",
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.02 },
    iterations: 1,
    toolCalls: 0,
    ...overrides,
  }
}

beforeEach(() => {
  commitMock.mockReset()
  refundMock.mockReset()
  fromMock.mockReset()
  fromMock.mockImplementation(chain)
  jobPatches.length = 0
  loopResult.value = loop({})
  loopResult.error = null
})

describe("turn settlement", () => {
  it("commits the metered actual when the model actually cost something", async () => {
    const outcome = await runCopilotTurn(input())
    expect(commitMock).toHaveBeenCalledWith("log1", "job1", 0.02, 0, true, true)
    expect(refundMock).not.toHaveBeenCalled()
    expect(outcome.creditsCharged).toBe(7)
  })

  it("REFUNDS a cancel that produced prose but no completed iteration (cost 0)", async () => {
    loopResult.value = loop({ stopReason: "cancelled", assistantText: "partial", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 } })
    const outcome = await runCopilotTurn(input())
    expect(commitMock).not.toHaveBeenCalled()
    expect(refundMock).toHaveBeenCalledWith("job1")
    expect(outcome.creditsCharged).toBe(0)
    expect(outcome.status).toBe("cancelled")
  })

  it("refunds a turn that failed before any spend", async () => {
    loopResult.error = new Error("anthropic exploded")
    const outcome = await runCopilotTurn(input())
    expect(commitMock).not.toHaveBeenCalled()
    expect(refundMock).toHaveBeenCalledWith("job1")
    expect(outcome.status).toBe("failed")
    expect(outcome.error?.code).toBe("llm_error")
  })

  it("leaves the job row terminal so the reconcile cron does not re-scan every finished turn", async () => {
    await runCopilotTurn(input())
    expect(jobPatches.some((p) => p.status === "completed" && p.completed_at)).toBe(true)
  })
})
