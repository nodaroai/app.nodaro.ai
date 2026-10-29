/**
 * A failed Replicate API CALL — the SDK's ApiError, whose message names the
 * API address and echoes the response body — reaches the user as a sentence
 * chosen by its status, with the raw text kept for the operator.
 *
 * The 2026-10-28 production case: a `flux-2-pro` run answered
 * `Request to https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions
 * failed with status 429 Too Many Requests: {"detail":"Request was throttled.
 * Your rate limit for creating predictions is reduced to 6 requests per minute
 * with a burst of 1 requests while you have less than $5.0 in credit. …"}` —
 * verbatim, as the job's error message.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import {
  __resetReplicateAlertForTests,
  REPLICATE_BUSY_MESSAGE,
  REPLICATE_PROVIDER_ERROR_MESSAGE,
  REPLICATE_REJECTED_MESSAGE,
  ReplicateSanitizedError,
  replicateApiStatus,
  replicateFailureText,
  replicateRequestFailure,
  withReplicateRequestFailure,
} from "../failure-messages.js"
import { PLATFORM_CAPACITY_MESSAGE } from "@/lib/llm-platform-exhaustion.js"
import { providerDetailOf } from "@/lib/provider-error-detail.js"
import { isPlatformCapacityOutage, isRetryableFailure } from "@/lib/mcp/tools/_job-error.js"

const PROD_429 =
  "Request to https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions failed with status 429 Too Many Requests: " +
  '{"detail":"Request was throttled. Your rate limit for creating predictions is reduced to 6 requests per minute with a burst of 1 requests while you have less than $5.0 in credit. Your rate limit resets in ~7s.","status":429,"retry_after":7}\n.'

/** The shape the SDK throws: an Error with `request` and `response`. */
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { name: "ApiError", request: {}, response: { status } })
}

beforeEach(() => __resetReplicateAlertForTests())
afterEach(() => vi.restoreAllMocks())

describe("replicateRequestFailure", () => {
  it("the production 429: a 'busy' sentence to the user, the raw text for the operator, and an [ALERT] about the credit", () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    const out = replicateRequestFailure(apiError(429, PROD_429), "[replicate:img]")
    expect(out).toBeInstanceOf(ReplicateSanitizedError)
    expect(out!.message).toBe(REPLICATE_BUSY_MESSAGE)
    expect(out!.message).not.toMatch(/replicate\.com|credit|\$/)
    expect(out!.internalDetails).toBe(PROD_429)
    // The operator's record: the worker reads it off `internalDetails`.
    expect(providerDetailOf(out)).toContain("429 Too Many Requests")
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toMatch(/^\[ALERT\] Replicate account credit is low/)
  })

  it("the credit alert fires once a minute, not once a request", () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    replicateRequestFailure(apiError(429, PROD_429), "[a]")
    replicateRequestFailure(apiError(429, PROD_429), "[b]")
    expect(alert).toHaveBeenCalledTimes(1)
  })

  it("a 429 that is not about credit is busy too, with no alert", () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    const out = replicateRequestFailure(apiError(429, "Request to https://api.replicate.com/x failed with status 429 Too Many Requests: {}"), "[x]")
    expect(out!.message).toBe(REPLICATE_BUSY_MESSAGE)
    expect(alert).not.toHaveBeenCalled()
  })

  it("maps the other statuses: 401/402/403 → the shared platform-capacity sentence, 400/422 → rejected settings, other 4xx and 5xx → provider error", () => {
    expect(replicateRequestFailure(apiError(402, "x"), "[x]")!.message).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(replicateRequestFailure(apiError(401, "x"), "[x]")!.message).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(replicateRequestFailure(apiError(422, "x"), "[x]")!.message).toBe(REPLICATE_REJECTED_MESSAGE)
    expect(replicateRequestFailure(apiError(400, "x"), "[x]")!.message).toBe(REPLICATE_REJECTED_MESSAGE)
    expect(replicateRequestFailure(apiError(404, "x"), "[x]")!.message).toBe(REPLICATE_PROVIDER_ERROR_MESSAGE)
    expect(replicateRequestFailure(apiError(502, "x"), "[x]")!.message).toBe(REPLICATE_PROVIDER_ERROR_MESSAGE)
  })

  it("the sentences classify for the MCP as intended: busy and provider error retryable, rejected settings not, the capacity one as the platform's outage", () => {
    expect(isRetryableFailure(REPLICATE_BUSY_MESSAGE)).toBe(true)
    expect(isRetryableFailure(REPLICATE_PROVIDER_ERROR_MESSAGE)).toBe(true)
    expect(isRetryableFailure(REPLICATE_REJECTED_MESSAGE)).toBe(false)
    expect(isPlatformCapacityOutage(PLATFORM_CAPACITY_MESSAGE)).toBe(true)
  })

  it("replicateFailureText keeps the host's wording readable on a sanitized error — a 502 retry predicate still matches", () => {
    const sanitized = replicateRequestFailure(apiError(502, "Request to https://api.replicate.com/x failed with status 502 Bad Gateway: <html>"), "[x]")!
    expect(replicateFailureText(sanitized)).toMatch(/\b502\b/)
    expect(replicateFailureText(new Error("ECONNRESET"))).toBe("ECONNRESET")
  })

  it("withReplicateRequestFailure: an API refusal comes out sanitized, anything else untouched, a success passes through", async () => {
    await expect(withReplicateRequestFailure("[x]", async () => 7)).resolves.toBe(7)
    const plain = new Error("Prediction failed: boom")
    await expect(withReplicateRequestFailure("[x]", async () => { throw plain })).rejects.toBe(plain)
    const err = await withReplicateRequestFailure("[x]", async () => { throw apiError(422, "Request to https://api.replicate.com/x failed with status 422: {}") }).catch((e) => e)
    expect(err).toBeInstanceOf(ReplicateSanitizedError)
    expect(err.message).toBe(REPLICATE_REJECTED_MESSAGE)
  })

  it("is null for anything that is not the SDK's ApiError (a prediction that failed inside the model keeps its own path)", () => {
    expect(replicateRequestFailure(new Error("Prediction failed: cannot reshape tensor of 0 elements"), "[x]")).toBeNull()
    expect(replicateRequestFailure("string", "[x]")).toBeNull()
    expect(replicateRequestFailure(null, "[x]")).toBeNull()
    expect(replicateApiStatus({ response: { status: "429" } })).toBeUndefined()
  })
})
