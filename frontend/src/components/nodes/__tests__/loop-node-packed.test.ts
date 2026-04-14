import { describe, it, expect } from "vitest"
import { packedMin, computePackedLayout } from "../loop-node"
import type { LoopColumn } from "@/types/nodes"

const col = (type: LoopColumn["type"]): LoopColumn => ({
  id: "x", name: "x", handleId: "col_x", type,
})

describe("packedMin", () => {
  it("returns 100 when no columns", () => {
    expect(packedMin([])).toBe(100)
  })
  it("returns the type's min for single-column", () => {
    expect(packedMin([col("image-url")])).toBe(60)
    expect(packedMin([col("audio-url")])).toBe(220)
    expect(packedMin([col("text")])).toBe(100)
    expect(packedMin([col("video-url")])).toBe(80)
  })
  it("returns max across mixed columns", () => {
    expect(packedMin([col("image-url"), col("audio-url"), col("text")])).toBe(220)
    expect(packedMin([col("image-url"), col("text")])).toBe(100)
  })
  it("treats missing type as text", () => {
    const colNoType = { id: "x", name: "x", handleId: "col_x" } as unknown as LoopColumn
    expect(packedMin([colNoType])).toBe(100)
  })
})

describe("computePackedLayout", () => {
  it("packs to the max cols the min-width floor allows (min=60 → 5 cols)", () => {
    // W=376, gap=4 → maxColsByMin = floor(380 / 64) = 5
    const r = computePackedLayout({ count: 20, min: 60 })
    expect(r.cols).toBe(5)
    // tileW = floor((376 - 16) / 5) = 72
    expect(r.tileW).toBe(72)
    // tileH = max(48, round(72/(5/3))) = max(48, 43) = 48
    expect(r.tileH).toBe(48)
    // rows = ceil(20/5) = 4
    expect(r.rows).toBe(4)
  })

  it("uses fewer cols when count < maxCols", () => {
    const r = computePackedLayout({ count: 3, min: 60 })
    expect(r.cols).toBe(3)
    // tileW = floor((376 - 8) / 3) = 122
    expect(r.tileW).toBe(122)
  })

  it("respects a larger min (min=100 → 3 cols)", () => {
    // maxColsByMin = floor(380 / 104) = 3
    const r = computePackedLayout({ count: 12, min: 100 })
    expect(r.cols).toBe(3)
    expect(r.tileW).toBe(122)
  })

  it("derives tileH from PACKED_ASPECT (5/3)", () => {
    // min=60, count=4 → cols=4 (clamped to count), tileW = floor((376-12)/4) = 91
    const r = computePackedLayout({ count: 4, min: 60 })
    expect(r.cols).toBe(4)
    expect(r.tileW).toBe(91)
    // tileH = round(91 / (5/3)) = round(54.6) = 55
    expect(r.tileH).toBe(55)
  })

  it("returns at least 1 col even when min exceeds container", () => {
    const r = computePackedLayout({ count: 1, min: 500 })
    expect(r.cols).toBe(1)
  })

  it("flags overflow when content exceeds container height", () => {
    // 100 items at min=100 → cols=3, rows=34, tileH=73 → totalH > 400
    const r = computePackedLayout({ count: 100, min: 100 })
    expect(r.overflow).toBe(true)
  })

  it("does not flag overflow when items fit", () => {
    // 4 items, min=60 → cols=4, rows=1, tileH=55 → totalH=55
    const r = computePackedLayout({ count: 4, min: 60 })
    expect(r.overflow).toBe(false)
  })
})
