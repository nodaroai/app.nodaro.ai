/**
 * A turn on KIE sends each image as its description: this turn's images and
 * earlier undescribed ones are described first, in one batch inside the
 * turn's wall clock, stored on their image block, and their cost is the
 * turn's from the start. On direct nothing is described and no stored
 * description is sent.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const IMG_ID = "11111111-2222-4333-8444-555555555555"
const h = vi.hoisted(() => ({
  loopInputs: [] as Array<Record<string, unknown>>,
  loopScript: [] as Array<() => Promise<unknown>>,
  priorRows: [] as unknown[],
  updateMessageContent: vi.fn(),
  callKie: vi.fn(),
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
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn() }))
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
vi.mock("../tools/asset-refs.js", () => ({
  resolveCopilotAssetRefs: async () => new Map([[IMG_ID, { kind: "image", url: "https://r2.example/a.png", mimeType: "image/png" }]]),
}))
vi.mock("@/lib/llm/kie-lane.js", () => ({ callKie: h.callKie }))
vi.mock("@/lib/anthropic-image.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/anthropic-image.js")>()),
  prefetchAsBase64: async () => ({ type: "image_base64", mediaType: "image/png", data: "QUJD" }),
}))
vi.mock("../store.js", () => ({
  appendMessage: vi.fn().mockResolvedValue({ id: "msg1" }),
  bumpThreadActivity: vi.fn(),
  finishTurn: vi.fn(),
  isCancelRequested: async () => false,
  listRecentMessages: async () => h.priorRows,
  nextSeq: async () => 1,
  touchTurnHeartbeat: vi.fn(),
  updateTurnProgress: vi.fn(),
  recordTurnLane: vi.fn(),
  updateMessageContent: h.updateMessageContent,
  threadAllowsPublishing: () => false,
}))
vi.mock("../agent-loop.js", () => ({
  runAgentLoop: async (input: Record<string, unknown>) => {
    h.loopInputs.push(input)
    const next = h.loopScript.shift()
    if (next) return next()
    return {
      stopReason: "completed",
      messages: [{ role: "user", content: [] }, { role: "assistant", content: [{ type: "text", text: "done" }] }],
      assistantText: "done",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 },
      iterations: 1,
      toolCalls: 0,
    }
  },
}))

const { runCopilotTurn } = await import("../turn-runner.js")
const { CopilotDirectRefusedError } = await import("../lane.js")
const { IMAGE_DESCRIPTION_KEY } = await import("../image-descriptions.js")
const { LlmPlatformExhaustedError } = await import("../../../lib/llm-errors.js")
const { __resetPlatformExhaustionAlerts } = await import("../../../lib/llm-platform-exhaustion.js")
const { config } = await import("../../../lib/config.js")

const withImage = `make it warmer\n\n[references] image file "a.png" (id: ${IMG_ID})`
const input = (message = withImage, signal: AbortSignal = new AbortController().signal) => ({
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
  message,
  tier: "standard" as const,
  caps: { maxIterations: 12, maxToolCalls: 24, wallClockMs: 8 * 60_000, hardTimeoutMs: 9 * 60_000 },
  usageLogId: "log1",
  reservedCredits: 150,
  emit: vi.fn(),
  signal,
  firstParty: false,
})
const kieAnswer = (text: string, creditsUsd?: number) => ({
  text, usage: { inputTokens: 2, outputTokens: 10 }, model: "claude-sonnet-5", lane: "kie", ...(creditsUsd !== undefined ? { creditsUsd } : {}),
})
const priorImageRow = (description?: string) => ({
  id: "prior1", thread_id: "th1", turn_id: "t0", seq: 1, role: "user", context_preamble: null, text_preview: null, created_at: "2026-10-18T10:00:00Z",
  content: [{ type: "text", text: "see" }, { type: "image", source: { type: "url", url: "https://r2.example/old.png" }, ...(description ? { [IMAGE_DESCRIPTION_KEY]: description } : {}) }],
})
const priorReply = { id: "prior2", thread_id: "th1", turn_id: "t0", seq: 2, role: "assistant", context_preamble: null, text_preview: null, created_at: "2026-10-18T10:00:01Z", content: [{ type: "text", text: "ok" }] }

const saved = { anthropic: config.ANTHROPIC_API_KEY, kie: config.KIE_API_KEY }
beforeEach(() => {
  h.loopInputs.length = 0
  h.loopScript.length = 0
  h.priorRows = []
  h.updateMessageContent.mockReset()
  h.callKie.mockReset()
  __resetPlatformExhaustionAlerts()
  config.ANTHROPIC_API_KEY = ""
  config.KIE_API_KEY = "kie-test"
})
afterEach(() => {
  config.ANTHROPIC_API_KEY = saved.anthropic
  config.KIE_API_KEY = saved.kie
})

describe("a KIE turn with an image", () => {
  it("describes it first, stores the description on the image block, sends the description, and counts its cost", async () => {
    h.callKie.mockResolvedValue(kieAnswer("A red square on white.", 0.001))
    await runCopilotTurn(input())
    expect(h.updateMessageContent).toHaveBeenCalledTimes(1)
    const [rowId, stored] = h.updateMessageContent.mock.calls[0]! as [string, Array<Record<string, unknown>>]
    expect(rowId).toBe("msg1")
    expect(stored[1]).toMatchObject({ type: "image", source: { url: "https://r2.example/a.png" }, [IMAGE_DESCRIPTION_KEY]: "A red square on white." })
    const sent = JSON.stringify(h.loopInputs[0]!.userContent)
    expect(sent).toContain("[Image 1 — description: A red square on white.]")
    expect(sent).not.toContain('"type":"image"')
    expect(h.loopInputs[0]!.priorCostUsd).toBe(0.001)
  })

  it("describes inside the turn's wall clock: the loop's clock started before the descriptions", async () => {
    let describedAt = 0
    h.callKie.mockImplementation(async () => {
      describedAt = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 20))
      return kieAnswer("A red square.")
    })
    await runCopilotTurn(input())
    expect(h.loopInputs[0]!.startedAt as number).toBeLessThanOrEqual(describedAt)
  })

  it("the turn's cancel reaches the description calls", async () => {
    const ctrl = new AbortController()
    let seen: AbortSignal | undefined
    // Cancel while the description is in flight (the turn's own listener is live only during the turn).
    h.callKie.mockImplementation(async (_model: unknown, _req: unknown, signal: AbortSignal) => {
      seen = signal
      ctrl.abort()
      return kieAnswer("A red square.")
    })
    await runCopilotTurn(input(withImage, ctrl.signal))
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen!.aborted).toBe(true)
  })

  it("a failed description becomes the could-not-be-read marker and the turn goes on", async () => {
    h.callKie.mockRejectedValue(new Error("KIE 503"))
    await runCopilotTurn(input())
    expect(h.updateMessageContent).not.toHaveBeenCalled()
    expect(JSON.stringify(h.loopInputs[0]!.userContent)).toContain("[Image 1 — could not be read]")
    expect(h.loopInputs).toHaveLength(1)
  })

  it("describes an earlier turn's image in the same batch, stores it, then replays it as its description", async () => {
    h.priorRows = [priorImageRow(), priorReply]
    h.callKie.mockResolvedValue(kieAnswer("A blue circle.", 0.002))
    await runCopilotTurn(input("make it warmer"))
    expect(h.updateMessageContent).toHaveBeenCalledWith("prior1", expect.arrayContaining([expect.objectContaining({ [IMAGE_DESCRIPTION_KEY]: "A blue circle." })]))
    expect(JSON.stringify(h.loopInputs[0]!.history)).toContain("[Image 1 — description: A blue circle.]")
    expect(h.loopInputs[0]!.priorCostUsd).toBe(0.002)
  })
})

describe("a direct turn", () => {
  it("describes nothing and never sends a stored description", async () => {
    config.ANTHROPIC_API_KEY = "sk-ant-test"
    h.priorRows = [priorImageRow("An old description."), priorReply]
    await runCopilotTurn(input())
    expect(h.callKie).not.toHaveBeenCalled()
    const history = JSON.stringify(h.loopInputs[0]!.history)
    expect(history).toContain('"type":"image"')
    expect(history).not.toContain(IMAGE_DESCRIPTION_KEY)
  })

  it("a refusal before the first token restarts on KIE, and describe-first runs then", async () => {
    config.ANTHROPIC_API_KEY = "sk-ant-test"
    h.loopScript.push(() =>
      Promise.reject(new CopilotDirectRefusedError(new LlmPlatformExhaustedError("refused", { lane: "direct", provider: "anthropic", exhaustion: "billing" }))),
    )
    h.callKie.mockResolvedValue(kieAnswer("A red square."))
    await runCopilotTurn(input())
    expect(h.loopInputs.map((i) => i.lane)).toEqual(["direct", "kie"])
    expect(JSON.stringify(h.loopInputs[0]!.userContent)).toContain('"type":"image"')
    expect(JSON.stringify(h.loopInputs[1]!.userContent)).toContain("[Image 1 — description: A red square.]")
    expect(h.callKie).toHaveBeenCalledTimes(1)
  })
})
