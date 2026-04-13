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
  it("uses hint for cols when provided", () => {
    const r = computePackedLayout({ count: 9, min: 60, hint: 3 })
    expect(r.cols).toBe(3)
    expect(r.rows).toBe(3)
  })

  it("falls back to sqrt-packing when no hint", () => {
    const r = computePackedLayout({ count: 16, min: 60 })
    // sqrt(16 * 376 / 400) = sqrt(15.04) ≈ 3.88 → rounds to 4
    expect(r.cols).toBe(4)
  })

  it("clamps tileSize to min when candidate is smaller", () => {
    // hint 6, container 376, gap 4 → candidateW = (376 - 20) / 6 = 59.33 → 59
    // min 100 → tileSize = 100
    const r = computePackedLayout({ count: 12, min: 100, hint: 6 })
    expect(r.tileSize).toBe(100)
    // cols recomputed from tileSize: floor((376 + 4)/(100 + 4)) = floor(380/104) = 3
    expect(r.cols).toBe(3)
  })

  it("returns at least 1 col even when items don't fit", () => {
    const r = computePackedLayout({ count: 1, min: 500, hint: 3 })
    expect(r.cols).toBe(1)
  })

  it("flags overflow when rows*tileSize exceeds container height", () => {
    // 100 items, min 100 → tileSize ≥ 100, cols ~3, rows ~34 → totalH ~3400 > 400
    const r = computePackedLayout({ count: 100, min: 100, hint: 3 })
    expect(r.overflow).toBe(true)
  })

  it("does not flag overflow when items fit", () => {
    // 4 items at min 60, hint 2 → tileSize ~186, rows 2, totalH ~376 < 400
    const r = computePackedLayout({ count: 4, min: 60, hint: 2 })
    expect(r.overflow).toBe(false)
  })
})
