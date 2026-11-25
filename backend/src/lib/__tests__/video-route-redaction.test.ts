import { describe, expect, it } from "vitest"
import { redactPrivateJobData } from "../public-job-data.js"
import { VIDEO_ROUTE_STAMP_KEY } from "../video-route-decision.js"
import { ALTERNATE_ROUTE_KEY } from "../alternate-route-request.js"

/**
 * The routing records on a job hold the route's own figures (its quote in USD,
 * its task reference): no job a read returns may carry them. Every job
 * serializer — the job routes, the MCP job tools, the webhook event and the
 * SSE updates — goes through `redactPrivateJobData`, which drops the
 * server-only `__` keys of `input_data`.
 */
describe("routing records never leave the server", () => {
  const row = {
    id: "j",
    input_data: {
      prompt: "a cat",
      [VIDEO_ROUTE_STAMP_KEY]: { route: "alternate", quotedUsd: 0.5, sig: "s" },
      __videoRouteOutcome: { route: "alternate" },
      [ALTERNATE_ROUTE_KEY]: { state: "running", taskRef: "t" },
    },
  }

  it("drops them from a row, a list of rows and an envelope", () => {
    for (const value of [row, [row], { data: { job: row } }]) {
      const out = JSON.stringify(redactPrivateJobData(value))
      expect(out).not.toContain(VIDEO_ROUTE_STAMP_KEY)
      expect(out).not.toContain("__videoRouteOutcome")
      expect(out).not.toContain(ALTERNATE_ROUTE_KEY)
      expect(out).toContain("a cat")
    }
  })
})
