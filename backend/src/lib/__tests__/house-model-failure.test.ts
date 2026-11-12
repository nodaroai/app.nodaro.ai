/**
 * The ONE mapper from a house model's upstream failure to the job's error
 * (lib/house-model-failure.ts): the flags reach `error_hint` through the
 * same mapping a plugin handler's error goes through; the person reads a
 * fixed sentence; `error_detail` gets a neutral sentence; the upstream's words
 * reach one log line and nothing else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { houseModelFailureError, houseModelFailureOf, HouseModelRunError } from "../house-model-failure.js"
import { providerDetailOf } from "../provider-error-detail.js"
import { userFacingMessage } from "../user-facing-error.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"
import {
  inputImageRefusedOf,
  inputVideoRefusedOf,
  promptRefusedOf,
  refusalHintFor,
  requestRefusedHintOf,
  safetyBlockOf,
  sentVideoInput,
} from "../safety-block.js"

const CTX = { id: "house-fixture", jobId: "job-9" }
const WORDS = "UPSTREAM-WORDS-7f3: refused, see https://upstream.example/task?token=abc123"

/** The worker's own mapping (workers/video-worker.ts), applied to an error and the job's payload. */
function workerHint(err: unknown, data: Record<string, unknown>) {
  return refusalHintFor(
    safetyBlockOf(err, "house-fixture"),
    false,
    inputVideoRefusedOf(err) && sentVideoInput(data),
    inputImageRefusedOf(err),
    requestRefusedHintOf(err, data),
    promptRefusedOf(err),
    false,
  )
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("houseModelFailureOf", () => {
  it("reads a rejected start's Error (flags as own properties) and a failed poll (flags as fields)", () => {
    const fromError = houseModelFailureOf(Object.assign(new Error(WORDS), { requestRefused: true, requestRefusedSubject: "input_video", promptRefused: "yes" }))
    expect(fromError).toEqual({ message: WORDS, requestRefused: true, requestRefusedSubject: "input_video" })
    expect(houseModelFailureOf({ state: "failed", message: "x", contentPolicy: true, deterministic: true })).toEqual({ message: "x", contentPolicy: true, deterministic: true })
    expect(houseModelFailureOf(undefined)).toEqual({ message: "" })
  })
})

describe("houseModelFailureError", () => {
  it("the person reads a fixed sentence and error_detail a neutral one — never the upstream's words, never as a cause", () => {
    const err = houseModelFailureError({ message: WORDS }, CTX)
    expect(err).toBeInstanceOf(HouseModelRunError)
    expect(userFacingMessage(err, "fallback")).toBe("This model could not complete this run.")
    expect(providerDetailOf(err)).toBe("House model run failed.")
    expect(err.cause).toBeUndefined()
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain("UPSTREAM-WORDS-7f3")
  })

  it("logs the upstream's words once, with the job id, redacted of URLs and secrets", () => {
    houseModelFailureError({ message: WORDS, requestRefused: true }, CTX)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]![0])
    expect(line).toContain("job job-9 (house-fixture)")
    expect(line).toContain("UPSTREAM-WORDS-7f3")
    expect(line).toContain("[requestRefused]")
    expect(line).not.toContain("abc123")
  })

  it("a content-policy failure is a safety block, final and hinted as the worker hints it", () => {
    const err = houseModelFailureError({ message: WORDS, contentPolicy: true, promptRefused: true }, CTX)
    expect(err.contentPolicyClass).toBe("safety")
    expect(safetyBlockOf(err, "house-fixture")).toMatchObject({ class: "safety" })
    expect(workerHint(err, {})).toMatchObject({ kind: "safety-block", class: "safety", subject: "prompt" })
  })

  it("a refused request is hinted as one, with the clip as its subject when the job sent one", () => {
    const err = houseModelFailureError({ message: WORDS, requestRefused: true, requestRefusedSubject: "input_video", deterministic: true }, CTX)
    expect(err.message).toBe("This model refused this request as it was sent.")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(workerHint(err, { videoUrl: "https://in.example/clip.mp4" })).toEqual({ kind: "request-refused", subject: "input_video" })
    expect(workerHint(err, {})).toEqual({ kind: "request-refused" })
  })

  it("deterministic is copied as given and never read as a refused request (a final content block stays a safety block)", () => {
    const err = houseModelFailureError({ message: WORDS, contentPolicy: true, deterministic: true }, CTX)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(err.requestRefused).toBeUndefined()
    expect(err.message).toBe("This model could not complete this run.")
    expect(workerHint(err, {})).toMatchObject({ kind: "safety-block", class: "safety" })
    const refusedInput = houseModelFailureError({ message: WORDS, inputImageRefused: true, deterministic: true }, CTX)
    expect(refusedInput.requestRefused).toBeUndefined()
    expect(isDeterministicJobError(refusedInput)).toBe(true)
  })

  it("a refused input video without a class is the input-refused hint; a plain failure has none", () => {
    const refused = houseModelFailureError({ message: WORDS, inputVideoRefused: true }, CTX)
    expect(workerHint(refused, { videoUrl: "https://in.example/clip.mp4" })).toEqual({ kind: "input-refused", subject: "input_video" })
    expect(workerHint(houseModelFailureError({ message: WORDS }, CTX), {})).toBeNull()
    expect(isDeterministicJobError(houseModelFailureError({ message: WORDS }, CTX))).toBe(false)
  })
})
