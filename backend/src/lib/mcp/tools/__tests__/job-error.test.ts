import { describe, it, expect } from "vitest"
import { isRetryableFailure } from "../_job-error.js"

describe("isRetryableFailure", () => {
  it("marks content-policy / safety failures NON-retryable", () => {
    expect(
      isRetryableFailure(
        "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
      ),
    ).toBe(false)
    expect(isRetryableFailure("Request flagged for moderation")).toBe(false)
    expect(isRetryableFailure("NSFW content detected")).toBe(false)
    expect(isRetryableFailure("prompt violates our content policy")).toBe(false)
  })

  it("marks input-shape-limit failures NON-retryable", () => {
    expect(
      isRetryableFailure(
        "Input file exceeds the size or duration limit. Please use a shorter or smaller file.",
      ),
    ).toBe(false)
    expect(isRetryableFailure("Image too large")).toBe(false)
  })

  it("treats transient / unknown failures as retryable", () => {
    expect(
      isRetryableFailure("Generation failed. Please try again or contact support."),
    ).toBe(true)
    expect(isRetryableFailure("Provider timeout after 30s")).toBe(true)
    expect(isRetryableFailure("Internal server error (502)")).toBe(true)
    expect(isRetryableFailure(null)).toBe(true)
    expect(isRetryableFailure(undefined)).toBe(true)
    expect(isRetryableFailure("")).toBe(true)
  })
})
