import { describe, it, expect } from "vitest"
import { resolvePanels, type EntityBuckets } from "../resolve-panels.js"
import type { SheetFlavour } from "@nodaro/shared"
const fl: SheetFlavour = { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }

describe("resolvePanels", () => {
  it("resolves present panels by name===variant", () => {
    const buckets: EntityBuckets = { expressions: [{ name: "smile", url: "u/smile" }, { name: "neutral", url: "u/neutral" }] }
    const r = resolvePanels("character", [{ kind: "expression-board", entries: [{ kind: "preset", variant: "smile" }, { kind: "preset", variant: "neutral" }] }], fl, buckets)
    expect(r.present.map((p) => p.url)).toEqual(["u/smile", "u/neutral"])
    expect(r.missing).toHaveLength(0)
  })
  it("reports unmatched panels as missing", () => {
    const r = resolvePanels("character", [{ kind: "expression-board", entries: [{ kind: "preset", variant: "smile" }, { kind: "preset", variant: "angry" }] }], fl, { expressions: [{ name: "smile", url: "u/smile" }] })
    expect(r.present).toHaveLength(1); expect(r.missing[0].variant).toBe("angry")
  })
  it("maps head-turnaround to the 'angles' column", () => {
    const r = resolvePanels("character", [{ kind: "head-turnaround", entries: [{ kind: "preset", variant: "front" }] }], fl, { angles: [{ name: "front", url: "u/front" }] })
    expect(r.present[0].url).toBe("u/front")
  })
  it("ignores bucket items with no url", () => {
    const r = resolvePanels("character", [{ kind: "expression-board", entries: [{ kind: "preset", variant: "smile" }] }], fl, { expressions: [{ name: "smile" }] })
    expect(r.present).toHaveLength(0); expect(r.missing).toHaveLength(1)
  })
})
