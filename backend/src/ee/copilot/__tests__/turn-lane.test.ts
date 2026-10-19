/**
 * The turn picks its lane once, records it, and restarts on KIE when the
 * Anthropic account refuses the first call before any token.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => ({
  loopInputs: [] as Array<Record<string, unknown>>,
  loopScript: [] as Array<() => Promise<unknown>>,
  recordTurnLane: vi.fn(),
  insertAppReport: vi.fn(),
}))

vi.mock("@/workers/shared.js", () => ({ commitJobCredits: vi.fn() }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { credits_actual: 1 } }),
      update: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [] }) })),
    }),
  },
}))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: h.insertAppReport }))
vi.mock("@/lib/mcp/server.js", () => ({ buildMcpServer: async () => ({}) }))
vi.mock("@/lib/mcp/invoke.js", () => ({
  createMcpInvoker: () => ({ listTools: async () => [], callTool: async () => ({ content: [] }), close: async () => undefined }),
}))
vi.mock("../budget.js", () => ({ resolveTurnBudget: async () => ({ limitUsd: 1, reservedCredits: 150 }) }))
vi.mock("../context-snapshot.js", () => ({ buildContextPreamble: async () => "<workflow-context>ctx</workflow-context>" }))
vi.mock("../system-prompt.js", () => ({ buildSystemPrompt: () => "system" }))
vi.mock("../tools/registry.js", () => ({
  buildToolSurface: async () => ({ definitions: [], confirmClasses: new Map(), quotable: new Set() }),
}))
vi.mock("../store.js", () => ({
  appendMessage: vi.fn().mockResolvedValue({ id: "msg1" }),
  bumpThreadActivity: vi.fn(),
  finishTurn: vi.fn(),
  isCancelRequested: async () => false,
  listRecentMessages: async () => [],
  nextSeq: async () => 1,
  touchTurnHeartbeat: vi.fn(),
  updateTurnProgress: vi.fn(),
  recordTurnLane: h.recordTurnLane,
  updateMessageContent: vi.fn(),
  threadAllowsPublishing: () => false,
}))
vi.mock("../agent-loop.js", () => ({
  runAgentLoop: async (input: Record<string, unknown>) => {
    h.loopInputs.push(input)
    const next = h.loopScript.shift()
    if (next) return next()
    return {
      stopReason: "completed",
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ],
      assistantText: "done",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 },
      iterations: 1,
      toolCalls: 0,
    }
  },
}))

const { runCopilotTurn } = await import("../turn-runner.js")
const { CopilotDirectRefusedError } = await import("../lane.js")
const { LlmPlatformExhaustedError } = await import("../../../lib/llm-errors.js")
const { __resetPlatformExhaustionAlerts } = await import("../../../lib/llm-platform-exhaustion.js")
const { config } = await import("../../../lib/config.js")

const input = () => ({
  req: { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as never,
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
  firstParty: false,
})

const saved = { anthropic: config.ANTHROPIC_API_KEY, kie: config.KIE_API_KEY }
beforeEach(() => {
  h.loopInputs.length = 0
  h.loopScript.length = 0
  h.recordTurnLane.mockReset()
  h.insertAppReport.mockReset()
  __resetPlatformExhaustionAlerts()
  config.ANTHROPIC_API_KEY = "sk-ant-test"
  config.KIE_API_KEY = "kie-test"
})
afterEach(() => {
  config.ANTHROPIC_API_KEY = saved.anthropic
  config.KIE_API_KEY = saved.kie
})

describe("the turn's lane", () => {
  it("is direct while the Anthropic account is usable, and is recorded", async () => {
    await runCopilotTurn(input())
    expect(h.loopInputs.map((i) => i.lane)).toEqual(["direct"])
    expect(h.recordTurnLane).toHaveBeenCalledWith("turn1", "direct")
  })

  it("is KIE when the key is empty", async () => {
    config.ANTHROPIC_API_KEY = ""
    await runCopilotTurn(input())
    expect(h.loopInputs.map((i) => i.lane)).toEqual(["kie"])
    expect(h.recordTurnLane).toHaveBeenCalledWith("turn1", "kie")
  })

  it("restarts once on KIE when the account refused the first call before any token", async () => {
    h.loopScript.push(() =>
      Promise.reject(
        new CopilotDirectRefusedError(new LlmPlatformExhaustedError("refused", { lane: "direct", provider: "anthropic", exhaustion: "billing" })),
      ),
    )
    const outcome = await runCopilotTurn(input())
    expect(h.loopInputs.map((i) => i.lane)).toEqual(["direct", "kie"])
    expect(outcome.status).toBe("completed")
    expect(h.recordTurnLane).toHaveBeenLastCalledWith("turn1", "kie")
    expect(h.insertAppReport).not.toHaveBeenCalled()
    // The restart runs on what is left of the same wall clock.
    expect(typeof h.loopInputs[0]!.startedAt).toBe("number")
    expect(h.loopInputs[1]!.startedAt).toBe(h.loopInputs[0]!.startedAt)
  })

  it("with no KIE key, a refusal ends the turn as today — no restart, no KIE call", async () => {
    config.KIE_API_KEY = ""
    const refusal = new LlmPlatformExhaustedError("refused", { lane: "direct", provider: "anthropic", exhaustion: "billing" })
    h.loopScript.push(() => Promise.reject(new CopilotDirectRefusedError(refusal)))
    const req = input()
    const outcome = await runCopilotTurn(req)
    expect(h.loopInputs.map((i) => i.lane)).toEqual(["direct"])
    expect(outcome.status).toBe("failed")
    expect(outcome.error?.code).toBe("llm_error")
    // The refusal itself is what fails the turn, as it did before the restart existed.
    const logged = (req.req as unknown as { log: { error: ReturnType<typeof vi.fn> } }).log.error.mock.calls[0]![0] as { err: unknown }
    expect(logged.err).toBe(refusal)
    expect(h.recordTurnLane).toHaveBeenCalledWith("turn1", "direct")
  })

  it("any other loop failure ends the turn as today — no restart", async () => {
    h.loopScript.push(() => Promise.reject(new Error("boom")))
    const outcome = await runCopilotTurn(input())
    expect(h.loopInputs).toHaveLength(1)
    expect(outcome.error?.code).toBe("llm_error")
  })
})
