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

import { callLLM, CallLLMValidationError } from "../call-llm.js"
import * as AnthropicMod from "../../../../lib/anthropic.js"

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
  beforeEach(() => messagesCreate.mockReset())

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
})
