/**
 * `kieRetryable` — which KIE failures that cost nothing are asked again (the
 * Copilot's K13 ladder and the pipelines' burst window). A transport failure
 * is transient; our own bug is not, and must fail at once instead of being
 * retried for a minute and more.
 */
import { describe, expect, it } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { kieRetryable } from "../lane.js"
import { LlmLaneError } from "../../../lib/llm-errors.js"

const apiError = (status: number | undefined, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers())
/** What the SDK's MessageStream makes of any non-SDK error thrown while it reads the stream. */
const wrappedBySdk = (cause: Error) => Object.assign(new Anthropic.AnthropicError(cause.message), { cause })
const socketDrop = () => Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) })

describe("kieRetryable — transient", () => {
  it.each([
    ["a 429", apiError(429, "rate_limit_error", "slow down")],
    ["a 5xx", apiError(503, "api_error", "Service unavailable")],
    ["KIE's 400 api_error Internal error", apiError(400, "api_error", "Internal error")],
    ["an SDK connection error", new Anthropic.APIConnectionError({ message: "Connection error." })],
    ["an SDK connection timeout", new Anthropic.APIConnectionTimeoutError()],
    ["a stream error frame (an APIError with no status)", apiError(undefined, "overloaded_error", "Overloaded")],
    ["a KIE lane failure with a status", new LlmLaneError("KIE.ai messages x failed (502)", { lane: "kie", httpStatus: 502 })],
    ["a KIE wire failure with no status (no usage)", new LlmLaneError("KIE.ai messages x: structured call returned no decodable payload", { lane: "kie" })],
    ["no_available_account", new LlmLaneError("KIE.ai messages claude-opus-5: no_available_account", { lane: "kie" })],
    ["fetch's network failure", Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }) })],
    ["a body that dropped mid-stream", socketDrop()],
    ["a body that dropped mid-stream, as the SDK's stream wraps it", wrappedBySdk(socketDrop())],
    ["a Node socket error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["KIE's stream error frame on the pipeline wire", new Error("KIE.ai messages stream claude-sonnet-5.5 returned an error event: api_error: Internal error")],
    ["a garbled stream frame (the SDK's JSON.parse SyntaxError, wrapped by its stream)", wrappedBySdk(new SyntaxError("Unexpected token } in JSON at position 12"))],
    ["the SDK's out-of-order stream events", new Anthropic.AnthropicError('Unexpected event order, got content_block_delta before "message_start"')],
    ["the SDK's out-of-order stream events (message_stop)", new Anthropic.AnthropicError('Unexpected event order, got message_delta before receiving "message_stop"')],
  ])("%s", (_label, err) => {
    expect(kieRetryable(err)).toBe(true)
  })
})

describe("kieRetryable — fails at once", () => {
  it.each([
    ["our own TypeError", new TypeError("Cannot read properties of undefined (reading 'content')")],
    ["our own TypeError, as the SDK's stream wraps it", wrappedBySdk(new TypeError("x is not a function"))],
    ["a plain Error that is not a KIE wire failure", new Error("something we threw")],
    ["a RangeError", new RangeError("Invalid array length")],
    ["our own RangeError, as the SDK's stream wraps it", wrappedBySdk(new RangeError("Invalid array length"))],
    ["a SyntaxError from our own code, not wrapped by the SDK's stream", new SyntaxError("Unexpected token")],
    ["the person's own abort", new Anthropic.APIUserAbortError()],
    ["a refused KIE key", apiError(401, "authentication_error", "bad key")],
    ["a 4xx that will not clear", apiError(400, "invalid_request_error", "bad")],
    ["a non-error", "boom"],
  ])("%s", (_label, err) => {
    expect(kieRetryable(err)).toBe(false)
  })
})

describe("kieRetryable — KIE's own wire", () => {
  it("an error frame before any usage, as parseSseStream throws it, is transient", async () => {
    const { parseSseStream } = await import("../../../lib/llm/sse.js")
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"error","error":{"type":"api_error","message":"Internal error"}}\n\n'))
        controller.close()
      },
    })
    const response = new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    const err = await parseSseStream(response, "claude-sonnet-5.5", () => {}, "messages", 1024).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(kieRetryable(err)).toBe(true)
  })
})
