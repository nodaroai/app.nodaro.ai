import { afterEach, describe, expect, it, vi } from "vitest"
import { SyncHttpCallError, genericSyncHttpFailureMessage, syncHttpCallError, syncHttpFailureMessage } from "../sync-http-failure.js"
import { providerDetailOf } from "../../../lib/provider-error-detail.js"

const json = (value: unknown) => JSON.stringify(value)

/** No user-facing string may carry any part of a JSON envelope. */
function expectNoRawJson(message: string, body: string) {
  expect(message).not.toMatch(/[{}]/)
  expect(message).not.toMatch(/"[^"]*"\s*:/)
  if (body.length > 0) expect(message).not.toContain(body)
}

describe("syncHttpFailureMessage", () => {
  it("a JSON body with a plain `error` sentence shows that sentence", () => {
    const body = json({ error: "This workflow is already running." })
    const message = syncHttpFailureMessage(409, body)
    expect(message).toBe("This workflow is already running.")
    expectNoRawJson(message, body)
  })

  it("a JSON body with a nested `error.message` shows the nested message", () => {
    const body = json({ error: { code: "llm_error", message: "The model could not answer right now." } })
    const message = syncHttpFailureMessage(502, body)
    expect(message).toBe("The model could not answer right now.")
    expectNoRawJson(message, body)
  })

  it("an envelope nested one level deeper still yields its message", () => {
    const body = json({ error: { code: "upstream", error: { message: "The upstream service is busy." } } })
    expect(syncHttpFailureMessage(503, body)).toBe("The upstream service is busy.")
  })

  it("Fastify's own reply shows its detail, not the reason phrase", () => {
    const body = json({ statusCode: 400, error: "Bad Request", message: "body must have required property 'prompt'" })
    expect(syncHttpFailureMessage(400, body)).toBe("body must have required property 'prompt'")
  })

  it("a bare code in `error` is not a message, and is kept as the route's code", () => {
    const body = json({ error: "insufficient_credits" })
    expect(syncHttpFailureMessage(402, body)).toBe("Not enough credits to run this step.")
    expect(syncHttpFailureMessage(502, json({ error: { code: "x", message: "LLM_UNAVAILABLE" } }))).toBe(genericSyncHttpFailureMessage(502))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(syncHttpCallError("Sync HTTP call to /v1/x", 402, body).routeCode).toBe("insufficient_credits")
    log.mockRestore()
  })

  it("a bare reason phrase is not a message", () => {
    const body = json({ error: "Bad Gateway" })
    expect(syncHttpFailureMessage(502, body)).toBe(genericSyncHttpFailureMessage(502))
  })

  it("a non-JSON body falls back to the status sentence", () => {
    const body = "<html><body>502 Bad Gateway</body></html>"
    const message = syncHttpFailureMessage(502, body)
    expect(message).toBe("This step failed on the server (502). Try again in a moment.")
    expectNoRawJson(message, body)
    expect(message).not.toContain("<html>")
  })

  it("an empty body falls back to the status sentence", () => {
    expect(syncHttpFailureMessage(502, "")).toBe("This step failed on the server (502). Try again in a moment.")
    expect(syncHttpFailureMessage(429, "")).toBe("Too many requests right now (429). Try again in a moment.")
    expect(syncHttpFailureMessage(400, "")).toBe("This step's request was rejected (400).")
  })

  it("a route message carrying raw JSON, a URL or a stack never reaches the person", () => {
    const cases = [
      json({ error: 'Provider failed: {"code":500,"msg":"upstream exploded"}' }),
      json({ error: { message: "Fetch https://provider.example/v1/task?token=abc failed" } }),
      json({ error: { message: "TypeError: x is undefined\n    at run (/app/dist/x.js:1:2)" } }),
      json({ error: { message: "x".repeat(400) } }),
      json({ error: { code: "llm_unavailable", detail: "raw vendor text" } }),
    ]
    for (const body of cases) {
      const message = syncHttpFailureMessage(502, body)
      expect(message).toBe(genericSyncHttpFailureMessage(502))
      expectNoRawJson(message, body)
      expect(message).not.toContain("upstream exploded")
      expect(message).not.toContain("provider.example")
      expect(message).not.toContain("raw vendor text")
    }
  })

  it("a 500 is always the generic sentence, whatever its body says", () => {
    expect(syncHttpFailureMessage(500, json({ error: { code: "internal_error", message: "column x does not exist" } })))
      .toBe("This step failed on the server (500). Try again in a moment.")
  })

  it("a router 404 (no code) is the not-available sentence; a route's own 404 keeps its message", () => {
    expect(syncHttpFailureMessage(404, json({ message: "Route POST:/v1/x not found", error: "Not Found", statusCode: 404 })))
      .toBe("This step is not available on this deployment (404).")
    expect(syncHttpFailureMessage(404, json({ error: { code: "not_found", message: "That collection is not yours." } })))
      .toBe("That collection is not yours.")
  })
})

describe("syncHttpCallError", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps the raw reply in internalDetails and the log, never in the message", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const body = json({ error: { code: "llm_error", message: "The model could not answer right now." }, trace: "raw-trace-id-42" })
    const err = syncHttpCallError("Sync HTTP call to /v1/x", 502, body, { nodeId: "n1", nodeType: "llm-chat", executionId: "e1" })

    expect(err).toBeInstanceOf(SyncHttpCallError)
    expect(err.message).toBe("The model could not answer right now.")
    expect(err.message).not.toContain("raw-trace-id-42")
    expect(err.status).toBe(502)
    expect(err.routeCode).toBe("llm_error")
    expect(err.internalDetails).toBe(`Sync HTTP call to /v1/x failed (502): ${body}`)
    // The shared provider-detail reader picks it up like a KieError's.
    expect(providerDetailOf(err)).toContain("raw-trace-id-42")

    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]![0])
    expect(line).toContain("Sync HTTP call to /v1/x failed (502)")
    expect(line).toContain("node n1 (llm-chat)")
    expect(line).toContain("execution e1")
    expect(line).toContain("raw-trace-id-42")
  })

  it("an empty body still logs and still reads as the status sentence", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const err = syncHttpCallError("Sync HTTP call to /v1/x", 504, "")
    expect(err.message).toBe("This step timed out (504). Try again.")
    expect(String(log.mock.calls[0]![0])).toContain("body: <empty>")
  })
})
