import { vi } from "vitest"

/**
 * A stand-in for the Anthropic SDK's `MessageStream` answering one forced tool
 * call, emitting what the real one emits and in the same order: `streamEvent`
 * for `message_start`, `content_block_start` and every `input_json_delta`
 * (with the message snapshot), plus `inputJson` for each fragment.
 */
export interface FakeAnthropicStreamOptions {
  /** The tool input's raw JSON, as the model streamed it. */
  fragments: readonly string[]
  /** The tool input `finalMessage` reports (the SDK's own parse); defaults to JSON.parse of the fragments. */
  input?: unknown
  stopReason?: string
  usage?: { input_tokens: number; output_tokens: number }
  /** Fail before any event: the request never started. */
  failBeforeStart?: Error
  /** Fail after this many fragments (0 = right after `message_start`). */
  failAfter?: number
  failWith?: Error
  /** Never finish on its own: `finalMessage` settles only once `abort()` is called. */
  hang?: boolean
}

export type FakeAnthropicStream = ReturnType<typeof fakeAnthropicStream>

export function fakeAnthropicStream(opts: FakeAnthropicStreamOptions) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  let aborted = false
  let onAbort: (() => void) | undefined
  const emit = (event: string, ...args: unknown[]): void => {
    for (const cb of listeners.get(event) ?? []) cb(...args)
  }
  const abortError = (): Error => new Error("Request was aborted.")

  const stream = {
    abort: vi.fn(() => {
      aborted = true
      onAbort?.()
    }),
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb])
      return stream
    },
    async finalMessage() {
      await Promise.resolve()
      if (aborted) throw abortError()
      if (opts.failBeforeStart) throw opts.failBeforeStart
      const usage = opts.usage ?? { input_tokens: 1_000, output_tokens: 120 }
      const snapshot = {
        content: [] as Array<Record<string, unknown>>,
        usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
        stop_reason: null as string | null,
      }
      emit("streamEvent", { type: "message_start", message: snapshot }, snapshot)
      const block = { type: "tool_use", id: "tu_1", name: "result", input: {} as unknown }
      snapshot.content.push(block)
      emit("streamEvent", { type: "content_block_start", index: 0, content_block: block }, snapshot)

      let text = ""
      for (let i = 0; i < opts.fragments.length; i++) {
        if (opts.failAfter === i) throw opts.failWith
        text += opts.fragments[i]
        block.input = { partial: text }
        emit(
          "streamEvent",
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: opts.fragments[i] } },
          snapshot,
        )
        emit("inputJson", opts.fragments[i], block.input)
        if (aborted) throw abortError()
      }
      if (opts.failAfter === opts.fragments.length) throw opts.failWith
      if (opts.hang) {
        await new Promise<void>((resolve) => {
          onAbort = resolve
        })
        throw abortError()
      }
      const input = "input" in opts ? opts.input : JSON.parse(text)
      return {
        content: [{ type: "tool_use", id: "tu_1", name: "result", input }],
        usage,
        stop_reason: opts.stopReason ?? "tool_use",
      }
    },
  }
  return stream
}
