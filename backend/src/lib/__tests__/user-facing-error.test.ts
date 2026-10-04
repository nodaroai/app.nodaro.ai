import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { LlmLaneError, LlmOutputTruncatedError, LlmStreamResponseError, outputCappedMessage } from "../llm-errors.js"
import { providerDetailOf } from "../provider-error-detail.js"
import { userFacingMessage } from "../user-facing-error.js"

// A model-lane failure reached the person running a Video Analysis node as
// "KIE.ai chat-completions gemini-3-flash failed (code 422): The channel is
// not …" — a vendor name and an internal model id on the product's screen.
// The diagnostic stays in `message` (logs and the private plugins' retry
// classifier read it) and in `error_detail`; the person reads `userMessage`.

const RAW = "KIE.ai chat-completions gemini-3-flash failed (code 422): The channel is not available"
const usage = { inputTokens: 10, outputTokens: 5, complete: false }

describe("LlmLaneError.userMessage", () => {
  it.each([
    [{ httpStatus: 429 }, "busy"],
    [{ httpStatus: 503 }, "unavailable"],
    [{ bodyCode: 422 }, "unavailable"],
    [{ httpStatus: 400 }, "rejected the request (400)"],
    [{}, "could not be read"],
  ])("%j → a sentence that says it is %s", (opts, words) => {
    const err = new LlmLaneError(RAW, { lane: "kie", ...opts })
    expect(err.userMessage).toContain(words)
  })

  it("names no vendor, lane or internal model id, and keeps the diagnostic as the message", () => {
    for (const opts of [{ httpStatus: 429 }, { httpStatus: 502 }, { bodyCode: 422 }, { httpStatus: 404 }, {}]) {
      const err = new LlmLaneError(RAW, { lane: "kie", ...opts })
      expect(err.userMessage).not.toMatch(/kie|chat-completions|gemini-3-flash/i)
      expect(err.message).toBe(RAW)
      expect(err.internalDetails).toBe(RAW)
    }
  })

  it("is still a plain Error to the retry and fallback rules", () => {
    const err = new LlmLaneError("KIE.ai responses gpt-5.5 failed (503): busy", { lane: "kie", httpStatus: 503 })
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(LlmStreamResponseError)
    // The private plugins' transport classifier reads the message text.
    expect(/failed \((?:429|5\d\d)\)/.test(err.message)).toBe(true)
  })
})

describe("userFacingMessage", () => {
  it("reads a lane error's user message, also through a wrapping error's cause", () => {
    const lane = new LlmLaneError(RAW, { lane: "kie", bodyCode: 422 })
    expect(userFacingMessage(lane, "x")).toBe(lane.userMessage)
    const wrapped = new Error("video-analysis: roll failed", { cause: lane })
    expect(userFacingMessage(wrapped, "x")).toBe(lane.userMessage)
  })

  it("a usage-carrying stream failure reads a generic sentence; a truncation keeps what to change", () => {
    expect(userFacingMessage(new LlmStreamResponseError("KIE.ai responses stream gpt-5.5 returned an error event: x", usage), "x"))
      .not.toMatch(/kie/i)
    const truncated = new LlmOutputTruncatedError(`${outputCappedMessage()} (KIE.ai responses stream gpt-5.5 stopped)`, usage)
    expect(userFacingMessage(truncated, "x")).toBe(outputCappedMessage())
  })

  it("any other error keeps its own message; a non-error gets the fallback", () => {
    expect(userFacingMessage(new Error("Upload a video first."), "x")).toBe("Upload a video first.")
    expect(userFacingMessage("boom", "Something failed")).toBe("Something failed")
  })
})

describe("providerDetailOf", () => {
  it("finds the lane error's diagnostic through a cause chain, redacted", () => {
    const wrapped = new Error("roll failed", { cause: new LlmLaneError(RAW, { lane: "kie", bodyCode: 422 }) })
    expect(providerDetailOf(wrapped)).toBe(RAW)
  })
})

describe("llm-client throws typed lane errors", () => {
  it("no provider failure in llm-client.ts is a plain Error naming its lane", () => {
    const src = readFileSync(resolve(__dirname, "../llm-client.ts"), "utf8")
    expect(src).not.toMatch(/throw new Error\(\s*`KIE\.ai/)
  })
})
