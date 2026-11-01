// The cap on any queued time read from a row (lib/concurrency-lanes/execution-wait.ts)
// is the longest queue timeout an admin can set: core cannot import the Admin
// range, so this holds the two together.
import { describe, expect, it } from "vitest"
import { LANE_QUEUE_TIMEOUT_RANGE } from "../plan-sizes.js"
import { MAX_QUEUE_TIMEOUT_MS, MAX_QUEUED_CREDIT_MS } from "../../../lib/concurrency-lanes/execution-wait.js"

describe("the queued-time credit cap", () => {
  it("is the Admin range's longest queue timeout, plus slack", () => {
    expect(MAX_QUEUE_TIMEOUT_MS).toBe(LANE_QUEUE_TIMEOUT_RANGE.max * 60_000)
    expect(MAX_QUEUED_CREDIT_MS).toBeGreaterThan(MAX_QUEUE_TIMEOUT_MS)
  })
})
