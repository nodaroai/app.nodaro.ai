import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
  hasCredits: () => true,
}))

import { createSanitizedError } from "../client.js"

describe("createSanitizedError — honors a structural user-safe mark (A10)", () => {
  it("passes a marked message through verbatim, skipping the heuristic", () => {
    const err = createSanitizedError(
      "createTask error (code 400): raw provider internals with טקסט",
      "Generation",
      false,
      false,
      { userSafeMessage: "Your prompt was rejected: it names a public figure." },
    )
    expect(err.message).toBe("Your prompt was rejected: it names a public figure.")
    // internal details are still preserved for logging
    expect(err.internalDetails).toContain("raw provider internals")
  })

  it("a blank mark is NOT honored — falls back to the heuristic (byte-identical to today)", () => {
    const baseline = createSanitizedError("task timed out after 60 attempts", "Generation")
    const withBlank = createSanitizedError("task timed out after 60 attempts", "Generation", false, false, {
      userSafeMessage: "   ",
    })
    expect(withBlank.message).toBe(baseline.message)
  })

  it("no opts at all is byte-identical to today's sanitizer", () => {
    const err = createSanitizedError("aspect_ratio invalid", "Generation")
    expect(err.message).toBe("Invalid aspect ratio setting. Please try a different option.")
  })
})
