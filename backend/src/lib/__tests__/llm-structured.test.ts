import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"
import { buildMultiPickerAnalyzerSpec } from "@nodaro/prompts"

// ANTHROPIC_API_KEY set so claude models route to the direct SDK (tool path);
// Gemini/GPT have no directFallbackModel so they always go through KIE.
vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-ant-key", NODE_ENV: "test" },
}))

const anthropicCreate = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/** A Response whose body is an SSE stream yielding the given chunks, then closing. */
function streamResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/** A normal OpenAI-shape (Gemini via KIE) completion carrying `content`. */
function geminiContent(content: string): Response {
  return jsonResponse({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
}

const schema = z.object({ prompt: z.string(), mood: z.string().optional() })

describe("llmCompleteStructured", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    anthropicCreate.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  // ---------------------------------------------------------------------------
  // Transport retry vs validation retry
  //
  // `maxRetries` counts VALIDATION retries: re-asking a provider that already answered, and
  // paying again for a better-shaped answer. The Scene3D planner sets it to 0 deliberately —
  // it will not re-buy a wrong answer. Between 2026-09-08 and 2026-09-13 that ALSO disabled
  // the transport retry, so the planner had none: measured 2026-09-13, a
  // `503 {"type":"server_error"}` and an `upstream_error … "The server is currently being
  // maintained"` frame, both with NO usage, each ended a paid job outright.
  //
  // The rule that replaced the coupling is one line: a call that reported usage is never
  // retried; one that reported none cost nothing and is re-dialed on a bounded ladder
  // (round 7g widened it from one 400 ms attempt to 400 / 2 000 / 6 000 ms, after measuring
  // both attempts of a 400 ms pair 503 two seconds apart on staging job a37e5a64).
  // ---------------------------------------------------------------------------

  /** The failures the provider produced tonight, plus the two shapes that reach the same place. */
  const noUsageFailure: Record<string, () => Promise<Response>> = {
    "connection error": () => Promise.reject(new Error("socket closed")),
    "503 before any stream": () => Promise.resolve(
      new Response('{"type":"server_error","message":"Service temporarily unavailable"}',
        { status: 503, headers: { "Content-Type": "application/json" } }),
    ),
    "error event with no usage": () => Promise.resolve(streamResponse([
      'data: {"type":"error","error":{"type":"upstream_error","message":"The server is currently being maintained"}}\n\n',
    ])),
    "silent close": () => Promise.resolve(streamResponse([
      'data: {"type":"response.created","response":{"id":"response-1"}}\n\n', 'data: [DONE]\n\n',
    ])),
  }

  const astraOk = () => streamResponse([
    'data: {"type":"response.output_text.delta","delta":"{\\"prompt\\":\\"a sunset\\"}"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":4}}}\n\n',
  ])

  it.each(Object.keys(noUsageFailure))(
    "re-dials after a %s — no usage was reported, so nothing was paid for", async (failure) => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      fetchMock
        .mockImplementationOnce(noUsageFailure[failure])
        .mockImplementation(() => Promise.resolve(astraOk()))

      const result = await llmCompleteStructured(
        { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
        schema, { maxRetries: 0 },
      )

      expect(result.output).toEqual({ prompt: "a sunset" })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      // Observable, not silent: the reason and which attempt it is.
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("[llm-kie-stream-retry]"))
      expect(line).toContain("gpt-6-astra attempt 2/6 in 400 ms")
      expect(line).toContain("before any usage was reported")
      warn.mockRestore()
    },
  )

  it("never retries a failure that REPORTED usage — that would be a second bill", async () => {
    const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
    // `response.completed` with usage and no text: the provider answered (badly) and charged
    // for answering. Before the usage-carrying throw, this was a real double-pay path — the
    // empty-output guard threw a plain Error and the retry re-dialled a call already billed.
    fetchMock.mockImplementation(() => Promise.resolve(streamResponse([
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":0}}}\n\n',
    ])))

    const result = llmCompleteStructured(
      { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
      schema, { maxRetries: 0 },
    )

    await expect(result).rejects.toBeInstanceOf(StructuredLlmError)
    // The spend survives the failure: the job is billed for what it really used.
    await expect(result).rejects.toMatchObject({ usage: { inputTokens: 120, outputTokens: 0 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("surfaces the LAST failure unchanged when every attempt on the ladder fails", async () => {
    const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
    fetchMock.mockImplementation(noUsageFailure["503 before any stream"])

    vi.useFakeTimers()
    let result: Promise<unknown>
    try {
      result = llmCompleteStructured(
        { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
        schema, { maxRetries: 0 },
      )
      const settled = result.catch(() => {})
      // Drive the whole 400 / 2 000 / 6 000 / 15 000 / 30 000 ms ladder without sitting out 53.4 s.
      await vi.advanceTimersByTimeAsync(60_000)
      await settled
    } finally {
      vi.useRealTimers()
    }

    // No retry-exhausted wrapper: the provider's own reason is what the caller reads.
    await expect(result).rejects.toBeInstanceOf(StructuredLlmError)
    await expect(result).rejects.toThrow(/503/)
    await expect(result).rejects.toMatchObject({ usage: { inputTokens: 0, outputTokens: 0, complete: false } })
    // Six attempts, and still one failure: the ladder clears a flap or a burst, never an outage.
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it("honours the explicit opt-out: retryStreamOnError false fails on the first attempt", async () => {
    const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
    fetchMock.mockImplementation(noUsageFailure["connection error"])

    const result = llmCompleteStructured(
      { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }],
        retryStreamOnError: false },
      schema, { maxRetries: 0 },
    )

    await expect(result).rejects.toBeInstanceOf(StructuredLlmError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("finishes a completed Astra response without waiting for the socket to close", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
        const events = [
          { type: "response.output_text.delta", delta: '{"prompt":"scene"}' },
          { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } },
        ]
        value.enqueue(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")))
        // The provider has finished its response but leaves the transport open.
      },
      cancel,
    })
    fetchMock.mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))
    let settled = false
    const pending = llmCompleteStructured(
      { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
      schema, { maxRetries: 0 },
    ).then(result => { settled = true; return result })
    try {
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500, interval: 10 })
    } finally {
      if (!cancel.mock.calls.length) controller.close()
    }
    const result = await pending
    expect(result.output).toEqual({ prompt: "scene" })
    expect(result).toMatchObject({ inputTokens: 10, outputTokens: 5, usageComplete: true })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["response.incomplete", "response.failed"])(
    "preserves reported usage and does not retry a terminal %s response", async (type) => {
      const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
      fetchMock.mockImplementation(() => Promise.resolve(streamResponse([
        `data: ${JSON.stringify({ type, response: {
          usage: { input_tokens: 123, output_tokens: 456 }, credits_consumed: 2,
          incomplete_details: { reason: "max_output_tokens" },
        } })}\n\n`,
      ])))
      const result = llmCompleteStructured(
        { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
        schema, { maxRetries: 2 },
      )
      await expect(result).rejects.toBeInstanceOf(StructuredLlmError)
      await expect(result).rejects.toMatchObject({ usage: {
        inputTokens: 123, outputTokens: 456, complete: true, providerCost: 0.01,
      } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ["response.incomplete", { incomplete_details: { reason: "max_output_tokens" } }, "max_output_tokens"],
    ["response.failed", { error: { code: "server_error", message: "upstream refused" } }, "server_error upstream refused"],
    ["response.failed", {}, undefined],
  ])("names the provider's own reason for a terminal %s and logs it once", async (type, extra, reason) => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockImplementation(() => Promise.resolve(streamResponse([
      `data: ${JSON.stringify({ type, response: { usage: { input_tokens: 123, output_tokens: 456 }, ...extra } })}\n\n`,
    ])))
    try {
      // The event NAME alone cannot tell "raise the output budget" from "the endpoint is
      // failing", and before this the throw carried neither the reason nor a log line — so a
      // caller that rewrote the message left no record at all (the Scene3D planner did).
      const expected = new RegExp(`ended with ${type.replace(".", "\\.")}${reason ? `: ${reason}` : ""}`)
      await expect(llmCompleteStructured(
        { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
        schema, { maxRetries: 0 },
      )).rejects.toMatchObject({ message: expect.stringMatching(expected) })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toContain("[llm-kie-stream-terminal]")
      // The usage is in the sentence too: a reader should not need the row to size the answer.
      expect(warn.mock.calls[0]![0]).toContain("in 123 / out 456 tokens")
    } finally { warn.mockRestore() }
  })

  it.each([true, false])("keeps earlier repair usage when a terminal response reports usage=%s", async (reported) => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValueOnce(streamResponse([
      'data: {"type":"response.output_text.delta","delta":"{}"}\n\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5},"credits_consumed":1}}\n\n',
    ])).mockResolvedValueOnce(streamResponse([
      `data: ${JSON.stringify({ type: "response.incomplete", response: reported
        ? { usage: { input_tokens: 20, output_tokens: 10 }, credits_consumed: 2 } : {} })}\n\n`,
    ]))
    const result = llmCompleteStructured(
      { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
      schema, { maxRetries: 2 },
    )
    await expect(result).rejects.toMatchObject({ usage: {
      inputTokens: reported ? 30 : 10, outputTokens: reported ? 15 : 5,
      providerCost: reported ? 0.015 : 0.005, complete: reported,
    } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns validated output on the first valid response (Gemini path)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiContent(JSON.stringify({ prompt: "a sunset", mood: "calm" })))
    const r = await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    expect(r.output).toEqual({ prompt: "a sunset", mood: "calm" })
    expect(r.inputTokens).toBe(10)
    expect(r.outputTokens).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("adds response_format.json_schema to the Gemini KIE body", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiContent('{"prompt":"x"}'))
    await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
      { schemaName: "out" },
    )
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.response_format.type).toBe("json_schema")
    expect(body.response_format.json_schema.name).toBe("out")
    expect(body.response_format.json_schema.strict).toBe(false)
    expect(body.response_format.json_schema.schema.properties.prompt).toBeDefined()
  })

  it("does NOT add response_format for GPT (no native structured mode via KIE)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiContent('{"prompt":"gpt"}'))
    await llmCompleteStructured(
      { modelId: "gpt-5.2", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.response_format).toBeUndefined()
  })

  // KIE's chat-completions validator reads a PROPERTY named `type` as the
  // `type` keyword and refuses the request: `(code 422) $.response_format
  // .json_schema.schema.properties.person.properties.type must be string or
  // array`. The Person analyzer's first dimension is `type`, so every Gemini
  // Describe-to-Picker run failed on this lane.
  describe("a property named like a keyword the KIE validator misreads", () => {
    const personAnswer = { person: { type_: "woman", age: "age-30s" }, gaps: { missingItems: [], missingCategories: [] } }

    it("the Person analyzer is sent under the wire name, and its answer validates on the first attempt", async () => {
      const { llmCompleteStructured, structuredJsonSchema } = await import("../llm-client.js")
      const spec = buildMultiPickerAnalyzerSpec(["person"])
      fetchMock.mockImplementation(async () => geminiContent(JSON.stringify(personAnswer)))
      const r = await llmCompleteStructured(
        { modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: "x" }] },
        spec.schema,
        { schemaName: spec.toolName },
      )
      expect(r.output).toEqual({ person: { type: "woman", age: "age-30s" }, gaps: { missingItems: [], missingCategories: [] } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      const person = body.response_format.json_schema.schema.properties.person
      expect(person.properties.type).toBeUndefined()
      const callerPerson = (structuredJsonSchema(spec.schema).properties as Record<string, { properties: Record<string, unknown> }>).person
      expect(person.properties.type_).toEqual(callerPerson.properties.type)
    })

    it("a schema with no such name goes on the wire byte for byte", async () => {
      const { llmCompleteStructured, structuredJsonSchema } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(geminiContent('{"prompt":"x"}'))
      await llmCompleteStructured(
        { modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: "x" }] },
        schema,
      )
      const sent = (fetchMock.mock.calls[0][1] as { body: string }).body
      expect(sent).toContain(`"schema":${JSON.stringify(structuredJsonSchema(schema))}`)
    })

    it("an answer that is not JSON reaches the caller's validation as the model wrote it", async () => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      const spec = buildMultiPickerAnalyzerSpec(["person"])
      fetchMock
        .mockResolvedValueOnce(geminiContent('{"person":{"type_":"woman"'))
        .mockResolvedValueOnce(geminiContent(JSON.stringify(personAnswer)))
      const r = await llmCompleteStructured(
        { modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: "x" }] },
        spec.schema,
      )
      expect((r.output as { person: unknown }).person).toEqual({ type: "woman", age: "age-30s" })
      const retry = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
      const replayed = retry.messages.find((m: { role: string }) => m.role === "assistant")
      expect(replayed.content).toBe('{"person":{"type_":"woman"')
    })

    // The responses lane (GPT, Grok, Kimi, DeepSeek) takes the same schema as
    // `text.format`; the rename is invisible to the caller either way.
    const responsesAnswer = (text: string) => jsonResponse({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
      usage: { input_tokens: 5, output_tokens: 5 },
    })

    it("the responses lane sends the Person analyzer under the wire name too, and its answer validates", async () => {
      const { llmCompleteStructured, structuredJsonSchema } = await import("../llm-client.js")
      const spec = buildMultiPickerAnalyzerSpec(["person"])
      fetchMock.mockImplementation(async () => responsesAnswer(JSON.stringify(personAnswer)))
      const r = await llmCompleteStructured(
        { modelId: "gpt-5.6-terra", system: "", messages: [{ role: "user", content: "x" }] },
        spec.schema,
        { schemaName: spec.toolName },
      )
      expect(r.output).toEqual({ person: { type: "woman", age: "age-30s" }, gaps: { missingItems: [], missingCategories: [] } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      const person = body.text.format.schema.properties.person
      expect(person.properties.type).toBeUndefined()
      const callerPerson = (structuredJsonSchema(spec.schema).properties as Record<string, { properties: Record<string, unknown> }>).person
      expect(person.properties.type_).toEqual(callerPerson.properties.type)
    })

    it("the responses lane's collapsed stream restores the text it returns", async () => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      const spec = buildMultiPickerAnalyzerSpec(["person"])
      fetchMock.mockImplementation(async () => streamResponse([
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(personAnswer) })}\n\n`,
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":4}}}\n\n',
      ]))
      const r = await llmCompleteStructured(
        { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "x" }] },
        spec.schema,
      )
      expect((r.output as { person: unknown }).person).toEqual({ type: "woman", age: "age-30s" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      expect(body.stream).toBe(true)
      expect(body.text.format.schema.properties.person.properties.type).toBeUndefined()
    })

    it("a schema with no such name goes on the responses wire byte for byte", async () => {
      const { llmCompleteStructured, structuredJsonSchema } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(responsesAnswer('{"prompt":"x"}'))
      await llmCompleteStructured(
        { modelId: "gpt-5.6-terra", system: "", messages: [{ role: "user", content: "x" }] },
        schema,
      )
      const sent = (fetchMock.mock.calls[0][1] as { body: string }).body
      expect(sent).toContain(`"schema":${JSON.stringify(structuredJsonSchema(schema))}`)
    })

    it("the stream path sends the same wire schema and restores the text it returns", async () => {
      const { llmStream } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(streamResponse([
        'data: {"choices":[{"delta":{"content":"{\\"type_\\":"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\"wide\\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ]))
      const tokens: string[] = []
      const res = await llmStream(
        {
          modelId: "gemini-3.8-flash",
          system: "",
          messages: [{ role: "user", content: "x" }],
          jsonSchema: { name: "shot", schema: { type: "object", properties: { type: { type: "string" } } } },
        },
        (t) => tokens.push(t),
      )
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      expect(body.stream).toBe(true)
      expect(Object.keys(body.response_format.json_schema.schema.properties)).toEqual(["type_"])
      expect(JSON.parse(res.text)).toEqual({ type: "wide" })
      // Chunks reach the caller as they arrive, so they carry the wire name.
      expect(tokens.join("")).toBe('{"type_":"wide"}')
    })
  })

  it("retries on invalid JSON, then succeeds", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock
      .mockResolvedValueOnce(geminiContent("not json"))
      .mockResolvedValueOnce(geminiContent("still not json"))
      .mockResolvedValueOnce(geminiContent('{"prompt":"ok"}'))
    const r = await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    expect(r.output).toEqual({ prompt: "ok" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries on schema mismatch (valid JSON, wrong shape), then succeeds", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock
      .mockResolvedValueOnce(geminiContent('{"wrong":"field"}'))
      .mockResolvedValueOnce(geminiContent('{"prompt":"fixed"}'))
    const r = await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    expect(r.output.prompt).toBe("fixed")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Usage accumulates across ALL attempts (each call is billed), not just the
    // winning one — 2 attempts × {in:10, out:5} from geminiContent.
    expect(r.inputTokens).toBe(20)
    expect(r.outputTokens).toBe(10)
  })

  it("throws after exhausting retries on persistently invalid output", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(() => geminiContent("never json"))
    await expect(
      llmCompleteStructured(
        { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
        schema,
        { maxRetries: 1 },
      ),
    ).rejects.toThrow(/llm-structured: validation failed after 2 attempt/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /** Verbatim KIE Claude-proxy wire shape (live-captured 2026-07-14): a forced
   *  tool call arrives as ONE text block wrapping a <tool_calls> pseudo-tag
   *  whose tool object's closing brace is MISSING — never a real tool_use block. */
  function kieClaudeToolTag(inputJson: string): Response {
    const text = `<tool_calls>[{"type":"tool_use","id":"toolu_01x","name":"out","input":${inputJson}]</tool_calls>`
    return jsonResponse({
      role: "assistant", type: "message", model: "claude-opus-4-7", stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 12, output_tokens: 9 },
    })
  }

  it("structured Claude with an effort goes straight to the direct SDK (KIE ignores Claude effort)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    // KIE would decode fine here; the point is that it is never asked. While
    // KIE_CLAUDE_NONSTREAM_VERIFIED is false, spending a round-trip on a
    // guaranteed 500 before falling back is pure latency.
    fetchMock.mockResolvedValue(kieClaudeToolTag('{"prompt":"from-kie-tag"}'))
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "out", input: { prompt: "from-direct" } }],
      usage: { input_tokens: 7, output_tokens: 3 },
    })
    const r = await llmCompleteStructured(
      { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }], reasoningEffort: "low" },
      schema,
      { schemaName: "out" },
    )
    expect(r.output).toEqual({ prompt: "from-direct" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(anthropicCreate).toHaveBeenCalledTimes(1)
  })

  /**
   * A deployment with no ANTHROPIC_API_KEY has no direct lane, so Claude is
   * served entirely by KIE — over the COLLAPSED STREAM, since KIE's
   * non-streaming Claude endpoint 500s unconditionally
   * (KIE_CLAUDE_NONSTREAM_VERIFIED = false). Before that switch this
   * configuration could not complete a single Claude call.
   *
   * The `<tool_calls>` pseudo-tag decoder that the non-streaming path needs is
   * covered directly in `json-utils.test.ts` (extractKieToolCallInput); it stays
   * in the code for when the flag flips back.
   */
  describe("KIE-only deployment (no ANTHROPIC_API_KEY)", () => {
    let restore: string | undefined
    beforeEach(async () => {
      const { config } = await import("../config.js")
      const c = config as unknown as Record<string, unknown>
      restore = c.ANTHROPIC_API_KEY as string | undefined
      c.ANTHROPIC_API_KEY = undefined
    })
    afterEach(async () => {
      const { config } = await import("../config.js")
      ;(config as unknown as Record<string, unknown>).ANTHROPIC_API_KEY = restore
    })

    /** SSE carrying a forced-tool call as real input_json_delta fragments. */
    function toolUseSse(inputJson: string): Response {
      const mid = Math.ceil(inputJson.length / 2)
      return streamResponse([
        `data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: "out" } })}\n`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: inputJson.slice(0, mid) } })}\n`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: inputJson.slice(mid) } })}\n`,
        `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: 12, output_tokens: 9 } })}\n`,
      ])
    }

    it("serves a structured Claude call over the collapsed stream", async () => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(toolUseSse('{"prompt":"from-kie-stream"}'))
      const r = await llmCompleteStructured(
        { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }] },
        schema,
        { schemaName: "out" },
      )
      expect(r.output).toEqual({ prompt: "from-kie-stream" })
      expect(anthropicCreate).not.toHaveBeenCalled()
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      // The forced tool must be on the wire, and it must use the wire that works.
      expect(body.tool_choice).toEqual({ type: "tool", name: "out" })
      expect(body.stream).toBe(true)
    })

    it("throws rather than inventing a result when KIE fails outright", async () => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      // With no direct lane configured there is no backstop, so the error must
      // reach the caller instead of degrading into a retry loop on garbage.
      fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
      vi.useFakeTimers()
      try {
        const call = llmCompleteStructured(
          { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }] },
          schema,
          { schemaName: "out", maxRetries: 0 },
        )
        const assertion = expect(call).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(60_000)
        await assertion
      } finally {
        vi.useRealTimers()
      }
      expect(anthropicCreate).not.toHaveBeenCalled()
      // Six times, not once: KIE's `{"code":500}` envelope reports no usage, so the transport
      // ladder is free and runs even at `maxRetries: 0`. What must NOT happen is an UNBOUNDED
      // retry loop on garbage or a fabricated result — both still hold.
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    // The Claude lane is where an error frame can arrive AFTER usage: `message_delta` reports
    // it mid-stream, unlike the responses dialect where usage rides the terminal event. So
    // this is the shape that would have double-paid, and the one place that can tell is
    // `parseSseStream` — it knows whether any usage arrived before the frame did.
    it("does not retry a messages-lane error frame that arrives after usage was reported", async () => {
      const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
      fetchMock.mockImplementation(() => Promise.resolve(streamResponse([
        `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: 400, output_tokens: 12 } })}\n`,
        `data: ${JSON.stringify({ type: "error", error: { type: "upstream_error", message: "The server is currently being maintained" } })}\n`,
      ])))

      const result = llmCompleteStructured(
        { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }] },
        schema, { schemaName: "out", maxRetries: 0 },
      )

      await expect(result).rejects.toBeInstanceOf(StructuredLlmError)
      await expect(result).rejects.toMatchObject({ usage: { inputTokens: 400, outputTokens: 12 } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it("adds text.format json_schema to the KIE responses body (GPT-5.6)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"prompt":"terra"}' }] }],
      usage: { input_tokens: 5, output_tokens: 5 },
    }))
    const r = await llmCompleteStructured(
      { modelId: "gpt-5.6-terra", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
      { schemaName: "plan" },
    )
    expect(r.output).toEqual({ prompt: "terra" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.text.format.type).toBe("json_schema")
    expect(body.text.format.name).toBe("plan")
    expect(body.text.format.strict).toBe(false)
    expect(body.text.format.schema.properties.prompt).toBeDefined()
  })

  it("forces a tool on the Anthropic path and returns the tool input as output", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "out", input: { prompt: "from-tool" } }],
      usage: { input_tokens: 7, output_tokens: 3 },
    })
    const r = await llmCompleteStructured(
      { modelId: "claude-haiku-4.5", system: "sys", messages: [{ role: "user", content: "x" }], requireLane: "direct" },
      schema,
      { schemaName: "out" },
    )
    expect(r.output).toEqual({ prompt: "from-tool" })
    const callArgs = anthropicCreate.mock.calls[0][0] as { tool_choice: unknown; tools: Array<{ name: string }> }
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "out" })
    expect(callArgs.tools[0].name).toBe("out")
    expect(fetchMock).not.toHaveBeenCalled() // anthropic-direct, never touches KIE
  })
})
