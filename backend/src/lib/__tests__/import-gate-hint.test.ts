/**
 * A gate refusal in a worker is final: both gate errors are deterministic job
 * errors (lib/deterministic-job-error.ts), on their own and as a cause, so a
 * refused import fails on its first attempt instead of three times. (Its
 * code on the failed job's `error_hint` is a later change: the hint union is
 * mirrored in the SDK and the plugin contract.)
 */
import { describe, it, expect } from "vitest"
import { ImportSourceError } from "../import-source-policy.js"
import { ContentRightsError } from "../content-rights.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

describe("a gate refusal in a worker", () => {
  it("is final: both gate errors are deterministic, on their own and as a cause", () => {
    expect(isDeterministicJobError(new ImportSourceError())).toBe(true)
    expect(isDeterministicJobError(new ContentRightsError("rights_confirmation_required", "x"))).toBe(true)
    expect(isDeterministicJobError(new Error("wrapped", { cause: new ImportSourceError() }))).toBe(true)
    expect(isDeterministicJobError(new Error("yt-dlp failed"))).toBe(false)
  })
})
