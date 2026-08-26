/**
 * The loop's contract, driven by a scripted fake Anthropic client:
 * parallel tool results in ONE user message, the caps, the identical-call
 * short circuit, cancel, and the run proposal ending the turn.
 */
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"

const { streamMock, dispatchMock } = vi.hoisted(() => ({ streamMock: vi.fn(), dispatchMock: vi.fn() }))

vi.mock("@/lib/anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { stream: streamMock } }),
}))

vi.mock("../tools/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools/registry.js")>()
  return { ...actual, dispatchTool: dispatchMock }
})

const { runAgentLoop } = await import("../agent-loop.js")

/** A text block as the SDK types it (a `TextBlock` carries `citations`). */
function textBlock(text: string): Anthropic.Messages.ContentBlock {
  return { type: "text", text, citations: null } as Anthropic.Messages.ContentBlock
}

/** A stream stub that replays one scripted final message. */
function scriptStream(final: Partial<Anthropic.Messages.Message>, text = "") {
  const handlers: Record<string, (chunk: string) => void> = {}
  return {
    on: (event: string, handler: (chunk: string) => void) => {
      handlers[event] = handler
      return undefined
    },
    abort: vi.fn(),
    finalMessage: async () => {
      if (text && handlers.text) handlers.text(text)
      return {
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
        ...final,
      } as Anthropic.Messages.Message
    },
  }
}

const baseInput = () => ({
  system: "system",
  tools: [],
  history: [],
  userContent: [{ type: "text" as const, text: "hi" }],
  budget: { limitUsd: 10, reservedCredits: 150 },
  signal: new AbortController().signal,
  deps: { ctx: {} as never, invoker: {} as never, addedNodeTypes: new Set<string>(), wiredAssets: [], created: { count: 0 } },
  events: { onToken: vi.fn(), onToolCall: vi.fn(), onIteration: vi.fn() },
  isCancelRequested: async () => false,
})

beforeEach(() => {
  streamMock.mockReset()
  dispatchMock.mockReset()
  dispatchMock.mockResolvedValue({ text: "ok", isError: false })
})

describe("runAgentLoop", () => {
  it("streams prose and stops at end_turn", async () => {
    streamMock.mockReturnValue(scriptStream({ content: [textBlock("done")] }, "done"))
    const input = baseInput()
    const result = await runAgentLoop(input)
    expect(result.stopReason).toBe("completed")
    expect(result.assistantText).toBe("done")
    expect(input.events.onToken).toHaveBeenCalledWith("done")
    expect(result.iterations).toBe(1)
  })

  it("answers EVERY tool_use of one message in a single user message", async () => {
    streamMock
      .mockReturnValueOnce(
        scriptStream({
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", id: "t1", name: "get_graph", input: {} },
            { type: "tool_use", id: "t2", name: "list_models", input: {} },
          ],
        }),
      )
      .mockReturnValueOnce(scriptStream({ content: [textBlock("ok")] }))

    const result = await runAgentLoop(baseInput())
    expect(result.toolCalls).toBe(2)
    const toolResultMessage = result.messages.find(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => (b as { type: string }).type === "tool_result"),
    )
    const blocks = (toolResultMessage!.content as Array<{ type: string; tool_use_id: string }>).filter(
      (b) => b.type === "tool_result",
    )
    expect(blocks.map((b) => b.tool_use_id)).toEqual(["t1", "t2"])
  })

  it("short-circuits an identical call instead of running it a fourth time", async () => {
    const call = () =>
      scriptStream({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "get_graph", input: {} }] })
    streamMock.mockReturnValue(call())
    streamMock.mockImplementation(() => call())

    const result = await runAgentLoop(baseInput())
    expect(result.stopReason).toBe("capped")
    // 3 real dispatches; every later identical call is answered without running it.
    expect(dispatchMock).toHaveBeenCalledTimes(3)
  })

  it("stops when the next call would break the USD budget", async () => {
    streamMock.mockReturnValue(scriptStream({ content: [textBlock("x")] }))
    const input = { ...baseInput(), budget: { limitUsd: 0, reservedCredits: 1 } }
    const result = await runAgentLoop(input)
    expect(result.stopReason).toBe("budget")
    expect(streamMock).not.toHaveBeenCalled()
  })

  it("ends the turn on a run proposal so the user decides", async () => {
    dispatchMock.mockResolvedValue({ text: "proposed", isError: false, proposal: { addedNodeTypes: ["generate-image"] } })
    streamMock.mockReturnValue(
      scriptStream({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "r1", name: "run_workflow", input: {} }] }),
    )
    const result = await runAgentLoop(baseInput())
    expect(result.stopReason).toBe("run_proposed")
    expect(result.proposal?.addedNodeTypes).toEqual(["generate-image"])
    // The pending tool_use was answered before stopping — the stored
    // conversation stays replayable.
    const last = result.messages[result.messages.length - 1]!
    expect(last.role).toBe("user")
  })

  it("returns cancelled when the DB cancel flag is set", async () => {
    streamMock.mockReturnValue(
      scriptStream({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "get_graph", input: {} }] }),
    )
    const result = await runAgentLoop({ ...baseInput(), isCancelRequested: async () => true })
    expect(result.stopReason).toBe("cancelled")
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it("accounts cache tokens in the turn's cost", async () => {
    streamMock.mockReturnValue(
      scriptStream({
        content: [textBlock("x")],
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          cache_read_input_tokens: 20_000,
          cache_creation_input_tokens: 5_000,
        } as unknown as Anthropic.Messages.Usage,
      }),
    )
    const result = await runAgentLoop(baseInput())
    expect(result.usage.cacheReadTokens).toBe(20_000)
    expect(result.usage.cacheWriteTokens).toBe(5_000)
    expect(result.usage.costUsd).toBeGreaterThan(0)
  })
})

describe("the model ladder in the loop", () => {
  it("premium streams Opus at xhigh; economy streams Haiku with NO thinking block", async () => {
    const { COPILOT_TIERS } = await import("../constants.js")

    streamMock.mockReturnValue(scriptStream({ content: [textBlock("done")] }, "done"))
    await runAgentLoop({ ...baseInput(), tier: COPILOT_TIERS.premium })
    const premiumParams = streamMock.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(premiumParams.model).toBe(COPILOT_TIERS.premium.anthropicModelId)
    expect(premiumParams.output_config).toEqual({ effort: "xhigh" })

    streamMock.mockReturnValue(scriptStream({ content: [textBlock("done")] }, "done"))
    await runAgentLoop({ ...baseInput(), tier: COPILOT_TIERS.economy })
    const economyParams = streamMock.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(economyParams.model).toBe(COPILOT_TIERS.economy.anthropicModelId)
    // Haiku declares no efforts — sending thinking/output_config is an API error.
    expect(economyParams.thinking).toBeUndefined()
    expect(economyParams.output_config).toBeUndefined()
  })

  it("defaults to the standard rung when no tier is passed — every old caller unchanged", async () => {
    const { COPILOT_TIERS } = await import("../constants.js")
    streamMock.mockReturnValue(scriptStream({ content: [textBlock("done")] }, "done"))
    await runAgentLoop(baseInput())
    const params = streamMock.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(params.model).toBe(COPILOT_TIERS.standard.anthropicModelId)
    expect(params.output_config).toEqual({ effort: "high" })
  })
})

describe("per-tier caps", () => {
  let COPILOT_TIERS: typeof import("../constants.js").COPILOT_TIERS
  beforeAll(async () => { ({ COPILOT_TIERS } = await import("../constants.js")) })


  // A stream that ALWAYS proposes one distinct tool call, so the loop only
  // ever stops when it hits a cap — never on end_turn. Distinct args each
  // iteration so the identical-call short-circuit never fires first.
  const neverEnds = () => {
    let n = 0
    streamMock.mockImplementation(() =>
      scriptStream({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: `t${n}`, name: "get_graph", input: { i: n++ } }],
      }),
    )
  }

  it("stops economy at its OWN iteration cap", async () => {
    // One tool call per round, so `iterations` is the binding cap (it is the
    // smaller of the two for every tier). What matters is that economy stops
    // at economy's number, not a shared one.
    neverEnds()
    const result = await runAgentLoop({ ...baseInput(), tier: COPILOT_TIERS.economy })
    expect(result.stopReason).toBe("capped")
    expect(result.iterations).toBe(COPILOT_TIERS.economy.caps.maxIterations)
  })

  it("lets premium run STRICTLY further than economy on the same runaway stream", async () => {
    // The whole point of the change: paying for the stronger tier buys more
    // room. Same infinite stream, different ceilings.
    neverEnds()
    const economy = await runAgentLoop({ ...baseInput(), tier: COPILOT_TIERS.economy })
    neverEnds()
    const premium = await runAgentLoop({ ...baseInput(), tier: COPILOT_TIERS.premium })
    expect(premium.iterations).toBe(COPILOT_TIERS.premium.caps.maxIterations)
    expect(premium.iterations).toBeGreaterThan(economy.iterations)
  })

  it("the caps STRICTLY increase economy < standard < premium", () => {
    // The product promise, at the config level: a higher tier is never merely
    // equal. A mutation collapsing premium onto standard passes a test that
    // only compares premium to economy — this is the one that catches it.
    const e = COPILOT_TIERS.economy.caps
    const s = COPILOT_TIERS.standard.caps
    const p = COPILOT_TIERS.premium.caps
    expect(e.maxIterations).toBeLessThan(s.maxIterations)
    expect(s.maxIterations).toBeLessThan(p.maxIterations)
    expect(e.maxToolCalls).toBeLessThan(s.maxToolCalls)
    expect(s.maxToolCalls).toBeLessThan(p.maxToolCalls)
    expect(e.wallClockMs).toBeLessThan(s.wallClockMs)
    expect(s.wallClockMs).toBeLessThan(p.wallClockMs)
  })

  it("every tier's hard timeout is strictly greater than its wall clock", async () => {
    // The soft wall-clock stop must land BEFORE the hard timer, or a turn is
    // cut off mid-write instead of reporting 'capped'.
    for (const tier of Object.values(COPILOT_TIERS)) {
      expect(tier.caps.hardTimeoutMs).toBeGreaterThan(tier.caps.wallClockMs)
    }
  })
})
