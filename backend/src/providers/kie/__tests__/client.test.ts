import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  KieError,
  createSanitizedError,
  pollDelay,
} from "../client.js"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KieError", () => {
  it("has correct properties", () => {
    const error = new KieError(
      "Something went wrong",
      "raw kie.ai error details",
      "Image generation"
    )

    expect(error.message).toBe("Something went wrong")
    expect(error.internalDetails).toBe("raw kie.ai error details")
    expect(error.context).toBe("Image generation")
    expect(error.name).toBe("KieError")
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(KieError)
  })

  it("getFullMessage returns formatted string", () => {
    const error = new KieError(
      "User-friendly message",
      "internal details here",
      "Video generation"
    )

    expect(error.getFullMessage()).toBe(
      "[Video generation] User-friendly message | Internal: internal details here"
    )
  })
})

describe("createSanitizedError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("maps aspect_ratio errors to sanitized message", () => {
    const error = createSanitizedError(
      "Invalid aspect_ratio value: 3:2",
      "Image generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe(
      "Invalid aspect ratio setting. Please try a different option."
    )
    expect(error.internalDetails).toBe("Invalid aspect_ratio value: 3:2")
    expect(error.context).toBe("Image generation")
  })

  it("maps unknown errors to generic fallback message", () => {
    const error = createSanitizedError(
      "NSFW content detected in output",
      "Image generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe(
      "Image generation failed. Please try again or contact support if the issue persists."
    )
    expect(error.internalDetails).toBe("NSFW content detected in output")
  })

  it("maps timeout errors to timed out message", () => {
    const error = createSanitizedError(
      "Request timed out after 30s",
      "Video generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe("Generation timed out. Please try again.")
    expect(error.internalDetails).toBe("Request timed out after 30s")
    expect(error.context).toBe("Video generation")
  })
})

describe("pollDelay", () => {
  it("returns correct delays for various attempt numbers", () => {
    // First 5 attempts: fixed 2000ms
    expect(pollDelay(1)).toBe(2000)
    expect(pollDelay(5)).toBe(2000)

    // Attempts 6-15: ramp from 2000 toward 10000
    // attempt 10: 2000 + (10-5)*1000 = 7000
    expect(pollDelay(10)).toBe(7000)

    // Attempts > 15: capped at 10000
    expect(pollDelay(20)).toBe(10000)
  })
})
