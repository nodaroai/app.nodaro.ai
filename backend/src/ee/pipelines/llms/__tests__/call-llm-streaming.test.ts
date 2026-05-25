import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

// ─── Mock Anthropic client with a streamable shim ──────────────────────────

// Helper that builds a fake MessageStream — has .on(event, cb) + .finalMessage().
// Tests can call `triggerJsonDelta(delta)` to simulate input_json deltas
// arriving from Anthropic; `resolveFinal(message)` resolves the stream's
// finalMessage() promise.
function buildFakeStream() {
  const handlers: Record<string, Array<(arg: unknown) => void>> = {}
  let resolveFinal!: (msg: unknown) => void
  const finalPromise = new Promise<unknown>((resolve) => {
    resolveFinal = resolve
  })
  return {
    stream: {
      on(event: string, cb: (arg: unknown) => void) {
        if (!handlers[event]) handlers[event] = []
        handlers[event].push(cb)
        return this
      },
      finalMessage: () => finalPromise,
    },
    triggerJsonDelta(delta: string) {
      for (const cb of handlers.inputJson ?? []) cb(delta)
    },
    resolveFinal: (msg: unknown) => resolveFinal(msg),
  }
}

const { messagesCreate, messagesStream } = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  messagesStream: vi.fn(),
}))

vi.mock("../../../../lib/anthropic.js", () => ({
  getAnthropicClient: () => ({
    messages: { create: messagesCreate, stream: messagesStream },
  }),
  CLAUDE_MODEL: "claude-sonnet-4-6",
}))

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { callLLM, type ProgressUpdate } from "../call-llm.js"

function fakeSupabase() {
  return {
    client: {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: "llm-call-1" }, error: null }),
          }),
        }),
      }),
    } as never,
  }
}

const schema = z.object({ greeting: z.string() })

const finalMessageFixture = {
  content: [{ type: "tool_use", name: "emit", input: { greeting: "hello" } }],
  usage: { input_tokens: 10, output_tokens: 5 },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("callLLM — streaming path (onProgress)", () => {
  it("uses messages.stream when onProgress is provided; messages.create is NOT called", async () => {
    const fake = buildFakeStream()
    messagesStream.mockReturnValue(fake.stream)

    const { client } = fakeSupabase()
    const callPromise = callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "showrunner",
      task: "script",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      onProgress: () => {},
    })

    // Resolve the stream so the test doesn't hang.
    fake.resolveFinal(finalMessageFixture)
    await callPromise

    expect(messagesStream).toHaveBeenCalledTimes(1)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it("emits starting → drafting (throttled) → finalizing in order with cumulative bytesSoFar", async () => {
    const fake = buildFakeStream()
    messagesStream.mockReturnValue(fake.stream)

    const updates: ProgressUpdate[] = []
    const { client } = fakeSupabase()
    const callPromise = callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "showrunner",
      task: "script",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      onProgress: (u) => updates.push(u),
      // Use 0ms throttle so every delta emits — the throttle test is below.
      progressMinIntervalMs: 0,
    })

    // Push three deltas BEFORE resolving final so they all observe before the
    // finalizing event.
    fake.triggerJsonDelta('{"greeting":"')
    fake.triggerJsonDelta('hel')
    fake.triggerJsonDelta('lo"}')
    fake.resolveFinal(finalMessageFixture)
    await callPromise

    expect(updates[0]).toEqual({ phase: "starting" })

    const draftings = updates.filter((u) => u.phase === "drafting")
    expect(draftings.length).toBe(3)
    // bytesSoFar is cumulative — strictly non-decreasing.
    for (let i = 1; i < draftings.length; i++) {
      const prev = draftings[i - 1] as { bytesSoFar: number }
      const curr = draftings[i] as { bytesSoFar: number }
      expect(curr.bytesSoFar).toBeGreaterThanOrEqual(prev.bytesSoFar)
    }

    expect(updates[updates.length - 1]?.phase).toBe("finalizing")
  })

  it("throttles drafting events to one per progressMinIntervalMs", async () => {
    const fake = buildFakeStream()
    messagesStream.mockReturnValue(fake.stream)

    const updates: ProgressUpdate[] = []
    const { client } = fakeSupabase()
    const callPromise = callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "showrunner",
      task: "script",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      onProgress: (u) => updates.push(u),
      progressMinIntervalMs: 10_000, // long enough that subsequent deltas are dropped
    })

    // 5 fast deltas — only the first should produce a drafting event.
    fake.triggerJsonDelta('a')
    fake.triggerJsonDelta('b')
    fake.triggerJsonDelta('c')
    fake.triggerJsonDelta('d')
    fake.triggerJsonDelta('e')
    fake.resolveFinal(finalMessageFixture)
    await callPromise

    const draftings = updates.filter((u) => u.phase === "drafting")
    expect(draftings.length).toBe(1)
  })

  it("swallows + logs onProgress callback exceptions; LLM call still completes", async () => {
    const fake = buildFakeStream()
    messagesStream.mockReturnValue(fake.stream)
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { client } = fakeSupabase()
    const callPromise = callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "showrunner",
      task: "script",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      onProgress: () => {
        throw new Error("buggy callback")
      },
    })

    fake.resolveFinal(finalMessageFixture)
    const result = await callPromise

    expect(result.output).toEqual({ greeting: "hello" })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("non-streaming path is unchanged when onProgress is omitted (uses messages.create)", async () => {
    messagesCreate.mockResolvedValueOnce(finalMessageFixture)

    const { client } = fakeSupabase()
    const result = await callLLM({
      supabase: client,
      pipelineId: "p1",
      stageId: null,
      userId: "u1",
      role: "showrunner",
      task: "script",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "test",
      userPrompt: "hi",
      schema,
      // no onProgress
    })

    expect(result.output).toEqual({ greeting: "hello" })
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesStream).not.toHaveBeenCalled()
  })
})
