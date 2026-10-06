import { describe, it, expect } from "vitest"
// Through the package index: the review inspector's player reads a take's
// clock through these.
import { edlDurationMs, edlSegmentOutputStarts, normalizeEdl, outputMsToMasterMs, remapMsThroughEdl, type Edl } from "../index.js"

const SRC = { id: "A", url: "https://media.test/a.mp4", kind: "video" as const }

function edlOf(spans: ReadonlyArray<readonly [number, number, number?]>): Edl {
  return normalizeEdl({
    version: 1,
    clock: "master",
    sources: [SRC],
    segments: spans.map(([inMs, outMs, crossfade], i) => ({
      id: `s${i}`,
      inMs,
      outMs,
      video: "A",
      ...(crossfade ? { transition: { type: "crossfade", durationMs: crossfade } } : {}),
    })),
  })
}

describe("edlSegmentOutputStarts — each segment's start on the output clock", () => {
  it("is the running sum of the kept durations", () => {
    expect(edlSegmentOutputStarts(edlOf([[0, 1000], [3000, 4500], [9000, 9500]]))).toEqual([0, 1000, 2500])
  })

  it("pulls a segment back by the crossfade into it", () => {
    const edl = edlOf([[0, 1000], [3000, 4500, 200]])
    expect(edlSegmentOutputStarts(edl)).toEqual([0, 800])
    expect(edlDurationMs(edl)).toBe(2300)
  })

  it("is empty for an EDL with no segments", () => {
    expect(edlSegmentOutputStarts(edlOf([]))).toEqual([])
  })
})

describe("outputMsToMasterMs — the inverse of remapMsThroughEdl", () => {
  it("maps an output instant back to the master time it plays", () => {
    const edl = edlOf([[0, 1000], [3000, 4500], [9000, 9500]])
    expect(outputMsToMasterMs(edl, 0)).toBe(0)
    expect(outputMsToMasterMs(edl, 999)).toBe(999)
    expect(outputMsToMasterMs(edl, 1000)).toBe(3000)
    expect(outputMsToMasterMs(edl, 2499)).toBe(4499)
    expect(outputMsToMasterMs(edl, 2500)).toBe(9000)
  })

  it("inside a crossfade, is the incoming segment's time", () => {
    const edl = edlOf([[0, 1000], [3000, 4500, 200]])
    // Output 800..1000 plays the tail of s0 under the head of s1.
    expect(outputMsToMasterMs(edl, 799)).toBe(799)
    expect(outputMsToMasterMs(edl, 800)).toBe(3000)
    expect(outputMsToMasterMs(edl, 950)).toBe(3150)
  })

  it("is null past the end, before the start, and for a non-finite time", () => {
    const edl = edlOf([[0, 1000], [3000, 4500]])
    expect(outputMsToMasterMs(edl, 2500)).toBeNull()
    expect(outputMsToMasterMs(edl, 99_000)).toBeNull()
    expect(outputMsToMasterMs(edl, -1)).toBeNull()
    expect(outputMsToMasterMs(edl, Number.NaN)).toBeNull()
    expect(outputMsToMasterMs(edlOf([]), 0)).toBeNull()
  })

  // A Tighten base never revisits master time, so every output instant has
  // exactly one master instant that remaps onto it. (A multicam or clip EDL
  // that re-reads a span has two, and remapMsThroughEdl names the first.)
  it("round-trips every output instant of a monotonic EDL, crossfades included", () => {
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let trial = 0; trial < 60; trial++) {
      const spans: Array<[number, number, number?]> = []
      let cursor = rand(500)
      const count = 1 + rand(8)
      for (let i = 0; i < count; i++) {
        const len = 50 + rand(2000)
        const prev = spans.at(-1)
        const prevLen = prev ? prev[1] - prev[0] : 0
        const fade = i > 0 && rand(2) === 0 ? Math.floor(0.9 * Math.min(len, prevLen) * (rand(100) / 100)) : 0
        spans.push([cursor, cursor + len, fade > 0 ? fade : undefined])
        cursor += len + rand(3000)
      }
      const edl = edlOf(spans)
      const total = edlDurationMs(edl)
      for (let t = 0; t < total; t += 1 + rand(37)) {
        const master = outputMsToMasterMs(edl, t)
        expect(master, `trial ${trial} t=${t}`).not.toBeNull()
        expect(remapMsThroughEdl(edl, master as number), `trial ${trial} t=${t}`).toBe(t)
      }
      expect(outputMsToMasterMs(edl, total)).toBeNull()
    }
  })
})
