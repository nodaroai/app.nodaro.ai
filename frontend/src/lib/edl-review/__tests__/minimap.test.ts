import { describe, expect, it } from "vitest"
import { normalizeEdl } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { keptSetOf } from "../kept-set"
import { indexAtMs, minimapColumns, minimapMsAt } from "../minimap"

// 0–4 s kept, 4–5 s filler, 5–8 s kept, 8–10 s tangent.
const BASE = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "u", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 4000, video: "cam" }, { id: "s1", inMs: 5000, outMs: 8000, video: "cam" }],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }, { inMs: 8000, outMs: 10_000, reason: "tangent" }],
})

const stateOf = (c: ReturnType<typeof minimapColumns>[number]) => (c.state === "cut" ? `cut:${c.reason}` : c.state)

describe("the minimap: each column takes its dominant state", () => {
  it("kept time is neutral and cut time takes its reason's colour", () => {
    const kept = keptSetOf(BASE)
    const cols = minimapColumns({ base: BASE, edited: BASE, kept, sourceMs: 10_000, columns: 10 })
    expect(cols.map(stateOf)).toEqual(["kept", "kept", "kept", "kept", "cut:filler", "kept", "kept", "kept", "cut:tangent", "cut:tangent"])
  })

  it("restored time (planned cut, now kept) is its own state", () => {
    const kept = [{ inMs: 0, outMs: 8000 }]
    const edited = buildEdited(BASE, kept)
    const cols = minimapColumns({ base: BASE, edited, kept, sourceMs: 10_000, columns: 10 })
    expect(stateOf(cols[4]!)).toBe("restored")
    expect(stateOf(cols[3]!)).toBe("kept")
  })

  it("a reviewer's own cut is a manual cut", () => {
    const kept = [{ inMs: 0, outMs: 2000 }, { inMs: 5000, outMs: 8000 }]
    const edited = buildEdited(BASE, kept)
    const cols = minimapColumns({ base: BASE, edited, kept, sourceMs: 10_000, columns: 10 })
    expect(stateOf(cols[2]!)).toBe("cut:manual")
  })

  it("a column shared by two states takes the one holding more of it", () => {
    const kept = keptSetOf(BASE)
    // Column 0 is 0–2.5 s… column 1 is 2.5–5 s: 1.5 s kept, 1 s filler.
    const cols = minimapColumns({ base: BASE, edited: BASE, kept, sourceMs: 10_000, columns: 4 })
    expect(stateOf(cols[1]!)).toBe("kept")
    // Column 3 is 7.5–10 s: 0.5 s kept, 2 s tangent.
    expect(stateOf(cols[3]!)).toBe("cut:tangent")
  })

  it("time nothing covers is empty, and no columns come of no width or no source", () => {
    const cols = minimapColumns({ base: BASE, edited: BASE, kept: keptSetOf(BASE), sourceMs: 20_000, columns: 4 })
    expect(stateOf(cols[3]!)).toBe("none")
    expect(minimapColumns({ base: BASE, edited: BASE, kept: [], sourceMs: 0, columns: 4 })).toEqual([])
    expect(minimapColumns({ base: BASE, edited: BASE, kept: [], sourceMs: 10_000, columns: 0 })).toEqual([])
  })
})

describe("a point on the minimap is a master instant", () => {
  it("scales the x position over the source, clamped to it", () => {
    expect(minimapMsAt(50, 200, 10_000)).toBe(2500)
    expect(minimapMsAt(-5, 200, 10_000)).toBe(0)
    expect(minimapMsAt(500, 200, 10_000)).toBe(10_000)
    expect(minimapMsAt(10, 0, 10_000)).toBe(0)
  })
})

describe("the row a minimap click scrolls to", () => {
  const rows = [{ inMs: 0 }, { inMs: 1000 }, { inMs: 5000 }]
  it("is the last row starting at or before the instant, the first before any", () => {
    expect(indexAtMs(rows, 4999)).toBe(1)
    expect(indexAtMs(rows, 5000)).toBe(2)
    expect(indexAtMs(rows, -1)).toBe(0)
    expect(indexAtMs([], 10)).toBe(-1)
  })
})
