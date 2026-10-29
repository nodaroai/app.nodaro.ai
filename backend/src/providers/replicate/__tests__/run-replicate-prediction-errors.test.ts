/**
 * The shared Replicate dispatcher never lets the SDK's ApiError (API address +
 * response body in its message) escape as the job's message: on create AND on
 * wait it is the status-chosen sentence with the raw text on `internalDetails`.
 * A prediction that fails inside the model (a plain Error from `wait`) is left
 * to the caller, as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCreate, mockWait, mockFire } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockWait: vi.fn(),
  mockFire: vi.fn(async () => {}),
}))

vi.mock("replicate", () => ({
  default: class {
    predictions = { create: mockCreate }
    wait = mockWait
  },
}))
vi.mock("@/lib/config.js", () => ({ config: { REPLICATE_API_TOKEN: "test-token" } }))
vi.mock("@/lib/reconcile/fire-on-task-created.js", () => ({ fireOnTaskCreated: mockFire }))

import { runReplicatePrediction } from "../client.js"
import { REPLICATE_BUSY_MESSAGE, REPLICATE_REJECTED_MESSAGE, ReplicateSanitizedError } from "../failure-messages.js"

const RAW_429 =
  "Request to https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions failed with status 429 Too Many Requests: " +
  '{"detail":"Request was throttled … while you have less than $5.0 in credit …","status":429,"retry_after":7}'

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { name: "ApiError", request: {}, response: { status } })
}

beforeEach(() => {
  mockCreate.mockReset()
  mockWait.mockReset()
  mockFire.mockReset()
  mockFire.mockResolvedValue(undefined)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("runReplicatePrediction — a failed API call", () => {
  it("create refused (the production 429): the user reads 'busy', the operator the raw text; nothing is registered for reconcile", async () => {
    mockCreate.mockRejectedValue(apiError(429, RAW_429))
    const err = await runReplicatePrediction({ model: "owner/model", input: { prompt: "hi" }, label: "[replicate:img]" }).catch((e) => e)
    expect(err).toBeInstanceOf(ReplicateSanitizedError)
    expect(err.message).toBe(REPLICATE_BUSY_MESSAGE)
    expect(err.message).not.toContain("replicate.com")
    expect(err.internalDetails).toBe(RAW_429)
    expect(mockFire).not.toHaveBeenCalled()
    expect(mockWait).not.toHaveBeenCalled()
  })

  it("wait refused with a 4xx: the 'rejected these settings' sentence", async () => {
    mockCreate.mockResolvedValue({ id: "p1" })
    mockWait.mockRejectedValue(apiError(422, "Request to https://api.replicate.com/v1/predictions/p1 failed with status 422 Unprocessable Entity: {}"))
    const err = await runReplicatePrediction({ version: "v1", input: {}, label: "[x]" }).catch((e) => e)
    expect(err).toBeInstanceOf(ReplicateSanitizedError)
    expect(err.message).toBe(REPLICATE_REJECTED_MESSAGE)
    expect(mockFire).toHaveBeenCalledTimes(1)
  })

  it("a prediction that failed inside the model is rethrown untouched (the callers' own normalizers read it)", async () => {
    mockCreate.mockResolvedValue({ id: "p1" })
    const modelFailure = new Error("Prediction failed: cannot reshape tensor of 0 elements")
    mockWait.mockRejectedValue(modelFailure)
    await expect(runReplicatePrediction({ version: "v1", input: {}, label: "[x]" })).rejects.toBe(modelFailure)
  })
})
