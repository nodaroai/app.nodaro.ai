import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

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

import { callLLM } from "../call-llm.js"
import { pipelineContext } from "../../pipeline-context.js"

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
const successResp = {
  content: [{ type: "tool_use", name: "emit", input: { greeting: "hi" } }],
  usage: { input_tokens: 10, output_tokens: 5 },
}

beforeEach(() => vi.clearAllMocks())

describe("callLLM — AbortSignal threading from pipeline-context", () => {
  it("passes the pipeline signal to messages.create when set", async () => {
    messagesCreate.mockResolvedValueOnce(successResp)
    const ctrl = new AbortController()
    const { client } = fakeSupabase()

    await pipelineContext.run(
      { signal: ctrl.signal, pipelineId: "p1" },
      async () => {
        await callLLM({
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
      },
    )

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    const [, opts] = messagesCreate.mock.calls[0] as [unknown, { signal?: AbortSignal }]
    expect(opts?.signal).toBe(ctrl.signal)
  })

  it("does NOT pass any options object when called outside a pipeline context", async () => {
    // Other LLM callers (admin routes, tests, etc.) don't have a pipeline
    // context. The Anthropic SDK MUST be invoked exactly as before, with
    // no `{ signal }` option, so we don't change behavior for those paths.
    messagesCreate.mockResolvedValueOnce(successResp)
    const { client } = fakeSupabase()

    await callLLM({
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

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate.mock.calls[0]?.[1]).toBeUndefined()
  })

  it("aborts the stream when the pipeline signal fires (streaming path)", async () => {
    // Streaming path: instead of {signal} option, the SDK exposes
    // stream.abort(). callLLM should register signal.addEventListener
    // → stream.abort(). Simulate the abort then assert stream.abort()
    // was invoked.
    const streamAbort = vi.fn()
    const handlers: Record<string, Array<(arg: unknown) => void>> = {}
    let resolveFinal!: (msg: unknown) => void
    const fakeStream = {
      on(event: string, cb: (arg: unknown) => void) {
        if (!handlers[event]) handlers[event] = []
        handlers[event].push(cb)
        return this
      },
      finalMessage: () =>
        new Promise((resolve, reject) => {
          resolveFinal = resolve
          // If aborted, the SDK would reject; mimic that.
          if (streamAbort.mock.calls.length > 0) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          }
        }),
      abort: streamAbort,
    }
    messagesStream.mockReturnValueOnce(fakeStream)
    const { client } = fakeSupabase()
    const ctrl = new AbortController()

    const callPromise = pipelineContext.run(
      { signal: ctrl.signal, pipelineId: "p1" },
      () =>
        callLLM({
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
        }),
    )

    // Wait a tick so the addEventListener is wired before we abort.
    await new Promise((r) => setTimeout(r, 0))

    // Fire the cancel. callLLM should propagate via stream.abort().
    ctrl.abort()

    // streamAbort was called by the signal listener.
    expect(streamAbort).toHaveBeenCalledTimes(1)

    // Unblock finalMessage so the test promise can settle.
    resolveFinal(successResp)
    // The test passes as long as we got here without hanging — the
    // abort wiring is what matters; downstream handling of the
    // AbortError is exercised by the pipeline-worker tests.
    await callPromise.catch(() => undefined)
  })
})
