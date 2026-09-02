/**
 * §11.3 "Transient-KIE-500 count". 12 G1 rows are plain upstream 500s and are
 * dismissed as no-defect — retrying IS the right action. This file pins that
 * verdict so the safety-vocabulary widening in the classifier follow-up (and
 * anything after it) cannot silently reclassify a transient 500 as a permanent
 * content block, which would tell the model and the UI to stop retrying.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

import {
  classifyContentPolicy,
  classifyContentPolicyClass,
  createSanitizedError,
} from "../client.js"
import { isContentRejection, isRetryableFailure } from "@/lib/mcp/tools/_job-error.js"
import {
  TRANSIENT_UPSTREAM_500_MESSAGES,
  PARAMETER_REJECT_MESSAGES,
} from "./__fixtures__/log-pull-fail-messages.js"

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("transient upstream 500s (12 G1 rows, dismissed)", () => {
  it.each(TRANSIENT_UPSTREAM_500_MESSAGES)("%s is not a content block", (failMsg) => {
    expect(classifyContentPolicyClass(failMsg)).toBeNull()
    expect(classifyContentPolicy(failMsg)).toBe(false)
  })

  it.each(TRANSIENT_UPSTREAM_500_MESSAGES)("%s keeps the generic retry message", (failMsg) => {
    const err = createSanitizedError(failMsg, "Generation", true)
    expect(err.message).toContain("Please try again")
    expect(err.message).not.toContain("Content policy violation")
    expect(err.message).not.toContain("Invalid input parameters")
  })

  it.each(TRANSIENT_UPSTREAM_500_MESSAGES)("%s stays retryable for MCP callers", (failMsg) => {
    const userMessage = createSanitizedError(failMsg, "Generation", true).message
    expect(isContentRejection(userMessage)).toBe(false)
    expect(isRetryableFailure(userMessage)).toBe(true)
  })
})

describe("a 500 and a parameter reject stay distinguishable", () => {
  it.each(PARAMETER_REJECT_MESSAGES)("%s is not classified as a content block either", (failMsg) => {
    // Parameter rejects belong to PR 5 (W2). They must not be swept into the
    // safety class by the widening in the classifier follow-up — a permanent
    // "blocked" verdict on a fixable parameter is worse than the status quo.
    expect(classifyContentPolicyClass(failMsg)).toBeNull()
  })

  it("routes a parameter reject to the invalid-parameters message, not the generic retry one", () => {
    const err = createSanitizedError(
      "content[1].video_url: invalid param: video duration 52838 ms, expected [2000, 15000] ms",
      "Generation",
      true,
    )
    expect(err.message).toContain("Invalid input parameters")
  })
})
