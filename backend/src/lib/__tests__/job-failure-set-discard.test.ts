// @test-watches backend/src/lib/job-failure.ts
/**
 * Every failure of a SET job deletes the pictures its stores wrote, whatever
 * failed it (a worker, the reconcile giving up, a sweep): the one failure
 * funnel, `markJobFailedDetailed`, runs the set discard after every flip, so
 * a new failure path cannot forget it (every failure write goes through the
 * funnel: job-policy-result-totality).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("the failure funnel discards an ended set's pictures", () => {
  it("markJobFailedDetailed runs discardEndedSetImages once the row is flipped", () => {
    const src = readFileSync(join(__dirname, "..", "job-failure.ts"), "utf8")
    const fn = src.slice(src.indexOf("export async function markJobFailedDetailed("))
    const body = fn.slice(0, fn.indexOf("\n}\n"))
    const discard = body.indexOf("discardEndedSetImages(jobId)")
    expect(discard, "markJobFailedDetailed no longer discards an ended set's pictures").toBeGreaterThan(-1)
    // After the row is flipped (the missed write returns before it).
    expect(discard).toBeGreaterThan(body.indexOf('return "missed"'))
    expect(discard).toBeLessThan(body.lastIndexOf('return "flipped"'))
  })
})
