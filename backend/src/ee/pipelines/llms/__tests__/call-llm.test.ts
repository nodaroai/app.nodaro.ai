import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

vi.mock("../../../../lib/anthropic.js", () => {
  const messagesCreate = vi.fn()
  return {
    getAnthropicClient: () => ({ messages: { create: messagesCreate } }),
    CLAUDE_MODEL: "claude-sonnet-4-5-20250929",
    __mocked: { messagesCreate },
  }
})

import { callLLM, CallLLMRefusalError, CallLLMTruncatedError, CallLLMValidationError } from "../call-llm.js"
import { LLM_CONTENT_REFUSAL_MESSAGE, LlmContentRefusalError } from "../../../../lib/llm-errors.js"
import * as AnthropicMod from "../../../../lib/anthropic.js"
import { config } from "../../../../lib/config.js"
import { __resetPlatformExhaustionAlerts } from "../../../../lib/llm-platform-exhaustion.js"

const { messagesCreate } = (AnthropicMod as unknown as { __mocked: { messagesCreate: ReturnType<typeof vi.fn> } }).__mocked

function fakeSupabase() {
  const inserts: unknown[] = []
  const client = {
    from: (_table: string) => ({
      insert: (row: unknown) => {
        inserts.push(row)
        return {
          select: () => ({
            single: async () => ({ data: { id: "llm-call-1" }, error: null }),
          }),
        }
      },
    }),
  }
  return { client: client as never, inserts }
}

const schema = z.object({ greeting: z.string() })

describe("callLLM", () => {
  beforeEach(() => {
    messagesCreate.mockReset()
    // The lane comes from the live key (pickClaudeLane): pin the direct lane.
    config.ANTHROPIC_API_KEY = "sk-ant-test"
    __resetPlatformExhaustionAlerts()
  })

  it("returns parsed output on first success", async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "emit", input: { greeting: "hello" } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const { client, inserts } = fakeSupabase()
    const result = await callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "detection",
      task: "detection",
      modelId: "claude-haiku-4-5",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
    })
    expect(result.output).toEqual({ greeting: "hello" })
    expect(inserts).toHaveLength(1)
  })

  it("retries on schema-invalid then succeeds", async () => {
    messagesCreate
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", name: "emit", input: { wrong: "field" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", name: "emit", input: { greeting: "fixed" } }],
        usage: { input_tokens: 12, output_tokens: 6 },
      })
    const { client } = fakeSupabase()
    const result = await callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "detection",
      task: "detection",
      modelId: "claude-haiku-4-5",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      maxRetries: 1,
    })
    expect(result.output.greeting).toBe("fixed")
    expect(messagesCreate).toHaveBeenCalledTimes(2)
  })

  it("throws CallLLMValidationError after retries exhausted", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "emit", input: { wrong: "field" } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const { client } = fakeSupabase()
    await expect(
      callLLM({
        supabase: client,
        pipelineId: "p1",
        stageId: null,
        userId: "u1",
        role: "detection",
        task: "detection",
        modelId: "claude-haiku-4-5",
        systemPrompt: "test",
        userPrompt: "hi",
        schema,
        maxRetries: 1,
      }),
    ).rejects.toBeInstanceOf(CallLLMValidationError)
  })

  it("estimates cost using disjoint Anthropic usage fields (input + cacheCreate + cacheRead all charged)", async () => {
    // Haiku pricing per million tokens: input=$1.0, output=$5.0, cacheWrite=$1.25, cacheRead=$0.10.
    // usage: input_tokens=100, output_tokens=50, cache_creation_input_tokens=1000, cache_read_input_tokens=2000.
    // Expected cost: (100*1.0 + 50*5.0 + 1000*1.25 + 2000*0.10) / 1_000_000 = (100+250+1250+200)/1_000_000 = 1800/1_000_000 = 0.0018 USD.
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "emit", input: { greeting: "hello" } }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000,
      },
    })
    const { client } = fakeSupabase()
    const result = await callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "detection",
      task: "detection",
      modelId: "claude-haiku-4-5",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
    })
    expect(result.costUsd).toBeCloseTo(0.0018, 10)
  })

  it("normalizes dated model IDs ('claude-haiku-4-5-20251001' -> 'claude-haiku-4-5') for pricing lookup", async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "emit", input: { greeting: "hello" } }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    const { client } = fakeSupabase()
    const result = await callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "detection",
      task: "detection",
      modelId: "claude-haiku-4-5-20251001",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
    })
    // Haiku: (100*1.0 + 50*5.0) / 1_000_000 = 350 / 1_000_000 = 0.00035 USD.
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.costUsd).toBeCloseTo(0.00035, 10)
  })

  it("retries when model returns text instead of calling the emit tool", async () => {
    messagesCreate
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "I cannot do that." }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", name: "emit", input: { greeting: "recovered" } }],
        usage: { input_tokens: 12, output_tokens: 6 },
      })
    const { client } = fakeSupabase()
    const result = await callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "detection",
      task: "detection",
      modelId: "claude-haiku-4-5",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      maxRetries: 1,
    })
    expect(result.output.greeting).toBe("recovered")
    expect(messagesCreate).toHaveBeenCalledTimes(2)
  })

  describe("tool_choice by model", () => {
    const baseArgs = (modelId: string) => ({
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "critic" as const,
      task: "critic",
      modelId,
      temperature: 0.2,
      systemPrompt: "SYSTEM",
      userPrompt: "hi",
      schema,
      maxRetries: 0,
    })

    it("asks Sonnet 5.5 with tool_choice auto, a strict tool, the tool named in the system prompt, no temperature, the reasoning cap", async () => {
      messagesCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", name: "emit", input: { greeting: "hi" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      const { client } = fakeSupabase()
      await callLLM({ supabase: client, ...baseArgs("claude-sonnet-5-5") })
      const params = messagesCreate.mock.calls[0]![0]
      expect(params.tool_choice).toEqual({ type: "auto" })
      expect(params.tools).toHaveLength(1)
      expect(params.tools[0].name).toBe("emit")
      expect(params.tools[0].strict).toBe(true)
      expect(params.system[0].text).toMatch(/^SYSTEM\n\nRespond by calling the `emit` tool/)
      expect(params.system[0].cache_control).toEqual({ type: "ephemeral" })
      expect(params).not.toHaveProperty("temperature")
      expect(params.max_tokens).toBe(32768)
    })

    it("keeps the forced shape for Sonnet 4.6, byte for byte", async () => {
      messagesCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", name: "emit", input: { greeting: "hi" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      const { client } = fakeSupabase()
      await callLLM({ supabase: client, ...baseArgs("claude-sonnet-4-6") })
      const params = messagesCreate.mock.calls[0]![0]
      expect(params.tool_choice).toEqual({ type: "tool", name: "emit" })
      expect(params.tools[0]).not.toHaveProperty("strict")
      expect(params.system[0].text).toBe("SYSTEM")
      expect(params.temperature).toBe(0.2)
      expect(params.max_tokens).toBe(8192)
    })

    it("reads Sonnet 5.5's JSON answered as text instead of a tool call, without a retry", async () => {
      messagesCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: '```json\n{"greeting":"from text"}\n```' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      const { client } = fakeSupabase()
      const result = await callLLM({ supabase: client, ...baseArgs("claude-sonnet-5-5") })
      expect(result.output.greeting).toBe("from text")
      expect(messagesCreate).toHaveBeenCalledTimes(1)
    })

    it("still refuses a text answer from a forced-choice model", async () => {
      messagesCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: '{"greeting":"from text"}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      const { client } = fakeSupabase()
      await expect(callLLM({ supabase: client, ...baseArgs("claude-sonnet-4-6") })).rejects.toBeInstanceOf(
        CallLLMValidationError,
      )
    })
  })

  describe.each([
    ["forced path (Sonnet 4.6)", "claude-sonnet-4-6"],
    ["auto path (Sonnet 5.5)", "claude-sonnet-5-5"],
  ])("stop reasons on the %s", (_label, modelId) => {
    const args = (client: never, maxRetries = 2) => ({
      supabase: client,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      role: "critic" as const,
      task: "script_critic",
      modelId,
      systemPrompt: "SYSTEM",
      userPrompt: "hi",
      schema,
      maxRetries,
    })
    const reply = (stop_reason: string, content: unknown[] = [{ type: "text", text: "" }]) => ({
      content,
      stop_reason,
      usage: { input_tokens: 100, output_tokens: 40 },
    })

    it("a refusal fails at once with the content-policy sentence, and its llm_calls row keeps the tokens", async () => {
      messagesCreate.mockResolvedValueOnce(reply("refusal", [{ type: "text", text: "I can't help with that." }]))
      const { client, inserts } = fakeSupabase()
      const err = await callLLM(args(client)).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CallLLMRefusalError)
      expect((err as Error).message).toBe(LLM_CONTENT_REFUSAL_MESSAGE)
      expect((err as Error).cause).toBeInstanceOf(LlmContentRefusalError)
      expect(((err as Error).cause as LlmContentRefusalError).usage).toMatchObject({ inputTokens: 100, outputTokens: 40 })
      expect(messagesCreate).toHaveBeenCalledTimes(1)
      expect(inserts).toHaveLength(1)
      expect(inserts[0]).toMatchObject({ success: false, input_tokens: 100, output_tokens: 40 })
      expect((inserts[0] as { error: string }).error).toMatch(/^refusal:/)
    })

    it("a cut-off answer is retried once and recovers", async () => {
      messagesCreate
        .mockResolvedValueOnce(reply("max_tokens"))
        .mockResolvedValueOnce(reply("end_turn", [{ type: "tool_use", name: "emit", input: { greeting: "ok" } }]))
      const { client } = fakeSupabase()
      const result = await callLLM(args(client))
      expect(result.output.greeting).toBe("ok")
      expect(messagesCreate).toHaveBeenCalledTimes(2)
      const retryText = messagesCreate.mock.calls[1]![0].messages[0].content[0].text
      expect(retryText).toMatch(/cut off at the output token cap/)
    })

    it("a second cut-off answer fails with the token-cap error, not 'did not call the emit tool', even with retries left", async () => {
      messagesCreate.mockResolvedValueOnce(reply("max_tokens")).mockResolvedValueOnce(
        reply("max_tokens", [{ type: "tool_use", name: "emit", input: { greet: "fragm" } }]),
      )
      const { client, inserts } = fakeSupabase()
      const err = await callLLM(args(client, 2)).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CallLLMTruncatedError)
      expect((err as Error).message).toMatch(/^script_critic: the answer was cut off at the token cap/)
      expect(messagesCreate).toHaveBeenCalledTimes(2)
      expect(inserts).toHaveLength(1)
      expect(inserts[0]).toMatchObject({ success: false, input_tokens: 200, output_tokens: 80 })
    })

    it("a cut-off answer on the last attempt fails with the token-cap error", async () => {
      messagesCreate.mockResolvedValueOnce(reply("max_tokens"))
      const { client } = fakeSupabase()
      await expect(callLLM(args(client, 0))).rejects.toBeInstanceOf(CallLLMTruncatedError)
      expect(messagesCreate).toHaveBeenCalledTimes(1)
    })
  })
})
