import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * The duration lookup is a list of FIELD NAMES, and a name that no node writes is
 * silently dead — the lookup just falls through and a duration-priced node quotes
 * its ceiling. That is exactly what happened: `generatedVideoDuration` and
 * `uploadedDuration` sat in this list while nothing in the app ever wrote them, so
 * a wired video priced at the `:600s` ceiling (200 credits for a 30s clip).
 *
 * This pins the invariant rather than the list: every key the hook looks up must
 * exist as a field on some node data type. Renaming a field then breaks a test
 * instead of quietly costing a user 6x.
 */
const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8")

describe("useUpstreamVideoDuration candidate keys", () => {
  // The lookup lives in lib/ (the hook and the workflow estimate share it).
  const hook = src("../../lib/upstream-video-duration.ts")
  const nodeTypes = src("../../types/nodes.ts")

  const keys = [...hook.matchAll(/data\.(\w+) as number \| undefined/g)].map((m) => m[1]!)

  it("looks up at least one key (the guard is wired to something)", () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  it("every key it looks up EXISTS as a field on some node data type", () => {
    const missing = keys.filter((k) => !new RegExp(`^\\s+${k}\\??:`, "m").test(nodeTypes))
    expect(missing, `dead lookup keys — nothing writes these: ${missing.join(", ")}`).toEqual([])
  })

  it("does not re-introduce the two keys that were never written", () => {
    // Named explicitly: they read plausibly, so a future reader could add them back.
    expect(keys).not.toContain("generatedVideoDuration")
    expect(keys).not.toContain("uploadedDuration")
  })
})
