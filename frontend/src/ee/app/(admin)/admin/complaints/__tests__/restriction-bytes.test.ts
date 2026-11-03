import { describe, it, expect } from "vitest"
import type { CaseRestriction } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { restrictionBytesSummary } from "../restriction-bytes"

/**
 * The case page's line about a restriction's files reads the record the way
 * the server's sweep does: the phase of its side, every key done or skipped,
 * the edge purged or not purgeable here. Anything else is left; the page
 * offers to finish it only when finishing can change something (a key that
 * waits on another restriction cannot be moved back by trying again).
 */

const base: CaseRestriction = {
  id: "r-1",
  assetId: "a-1",
  jobId: null,
  r2Keys: ["uploads/a.mp4", "thumbs/a.jpg"],
  reason: "x",
  restrictedAt: "2026-11-02T00:00:00Z",
  liftedAt: null,
  liftReason: null,
}
const at = "2026-11-02T00:00:01Z"

describe("restrictionBytesSummary", () => {
  it("a restriction with no record yet is left to do, and can be finished", () => {
    expect(restrictionBytesSummary(base)).toEqual({ settled: false, actionable: true, text: "Files: not yet moved to evidence" })
    expect(restrictionBytesSummary({ ...base, liftedAt: at })).toEqual({ settled: false, actionable: true, text: "Files: not yet moved back" })
  })

  it("every key moved and the edge purged (or not purgeable here) is settled, with nothing to finish", () => {
    const keys = { "uploads/a.mp4": { state: "moved" as const, at }, "thumbs/a.jpg": { state: "skipped" as const, at, why: "nothing was stored at the key" } }
    expect(restrictionBytesSummary({ ...base, bytes: { restrict: { keys, purge: { status: "done", at } } } })).toEqual({ settled: true, actionable: false, text: "Files moved to evidence" })
    expect(restrictionBytesSummary({ ...base, bytes: { restrict: { keys, purge: { status: "not_configured", at } } } })).toEqual({
      settled: true,
      actionable: false,
      text: "Files moved to evidence · edge purge not configured here",
    })
  })

  it("a failed key, a deferred key and a failed purge are each said, and left to do", () => {
    const summary = restrictionBytesSummary({
      ...base,
      liftedAt: at,
      bytes: {
        lift: {
          keys: { "uploads/a.mp4": { state: "failed", at, error: "copy refused" }, "thumbs/a.jpg": { state: "deferred", at, why: "covered" } },
          purge: { status: "failed", at, error: "403" },
        },
      },
    })
    expect(summary).toMatchObject({ settled: false, actionable: true })
    expect(summary.text).toBe("1 file not moved back yet · 1 waiting: another restriction still covers it · the edge did not drop its copies")
  })

  it("files that only wait on another restriction are not settled, and offer nothing to finish", () => {
    const summary = restrictionBytesSummary({
      ...base,
      liftedAt: at,
      bytes: {
        lift: {
          keys: { "uploads/a.mp4": { state: "deferred", at, why: "covered" }, "thumbs/a.jpg": { state: "restored", at } },
          purge: { status: "done", at },
        },
      },
    })
    expect(summary).toEqual({ settled: false, actionable: false, text: "1 waiting: another restriction still covers it" })
  })

  it("a failed purge alone can be finished", () => {
    const keys = { "uploads/a.mp4": { state: "moved" as const, at }, "thumbs/a.jpg": { state: "moved" as const, at } }
    expect(restrictionBytesSummary({ ...base, bytes: { restrict: { keys, purge: { status: "failed", at, error: "timeout" } } } })).toMatchObject({ settled: false, actionable: true })
  })

  it("reads the lift's phase once lifted, never the restriction's", () => {
    const moved = { keys: { "uploads/a.mp4": { state: "moved" as const, at }, "thumbs/a.jpg": { state: "moved" as const, at } }, purge: { status: "done" as const, at } }
    expect(restrictionBytesSummary({ ...base, liftedAt: at, bytes: { restrict: moved } }).settled).toBe(false)
  })
})
