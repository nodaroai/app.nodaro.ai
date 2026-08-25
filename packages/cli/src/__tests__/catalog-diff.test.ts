import { describe, it, expect } from "vitest"
import { threeWayMergeCatalog } from "../lib/catalog-diff.js"
import type { CatalogSnapshot } from "../lib/catalog-snapshot.js"

const snap = (entries: Array<[string, string]>, sidecars: CatalogSnapshot["sidecars"] = {}): CatalogSnapshot => ({
  catalogId: "setting",
  kind: "single",
  entries: entries.map(([id, promptHint]) => ({ id, label: id, promptHint })),
  sidecars,
})

describe("threeWayMergeCatalog", () => {
  it("carries an upstream edit for an entry SAI left unmodified, incl. sidecar", () => {
    const baseline = snap([["forest", "in a forest"]])
    const upstream = snap([["forest", "deep in a forest"]], { he: { forest: { label: "יער עבות" } } })
    const pack = snap([["forest", "in a forest"]]) // unmodified vs baseline
    const plan = threeWayMergeCatalog(baseline, upstream, pack)
    expect(plan.carried.map((e) => e.promptHint)).toEqual(["deep in a forest"])
    expect(plan.sidecarsCarried.he).toEqual(["forest"])
    expect(plan.conflicts).toEqual([])
  })

  it("reports a conflict when SAI modified AND upstream changed", () => {
    const baseline = snap([["forest", "in a forest"]])
    const upstream = snap([["forest", "deep in a forest"]])
    const pack = snap([["forest", "in an enchanted forest"]]) // SAI-modified
    const plan = threeWayMergeCatalog(baseline, upstream, pack)
    expect(plan.conflicts.map((c) => c.id)).toEqual(["forest"])
    expect(plan.carried).toEqual([]) // pack kept, not overwritten
  })

  it("lists new upstream entries but NEVER auto-admits them", () => {
    const baseline = snap([["forest", "in a forest"]])
    const upstream = snap([["forest", "in a forest"], ["desert", "in a desert"]])
    const pack = snap([["forest", "in a forest"]])
    const plan = threeWayMergeCatalog(baseline, upstream, pack)
    expect(plan.newUpstream.map((e) => e.id)).toEqual(["desert"])
    expect(plan.carried.map((e) => e.id)).not.toContain("desert")
  })

  it("reports upstream removals without touching the pack", () => {
    const baseline = snap([["forest", "in a forest"], ["swamp", "in a swamp"]])
    const upstream = snap([["forest", "in a forest"]])
    const pack = snap([["forest", "in a forest"], ["swamp", "in a swamp"]])
    const plan = threeWayMergeCatalog(baseline, upstream, pack)
    expect(plan.removedUpstream).toEqual(["swamp"])
  })
})
