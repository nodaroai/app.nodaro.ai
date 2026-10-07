import { describe, it, expect } from "vitest"
import {
  buildSpanMap,
  DETECTION_PROXY,
  DETECTION_SPAN_MARGIN_MS,
  InvalidProxySpansError,
  normalizeProxySpans,
  padSpans,
  proxyFrameToSourceMs,
  proxyMsToSourceMs,
  sourceMsToProxyFrame,
  type ProxySpanMap,
} from "../media-proxy-span-map.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/** A segment as the encoder writes it: CFR at `fps`, `count` frames from its own zero. */
const segment = (seekMs: number, count: number, fps: number, firstPtsMs = 0) => ({
  seekMs,
  framePtsMs: Array.from({ length: count }, (_, k) => firstPtsMs + (k * 1000) / fps),
})

/** The joined proxy's frame times: each segment's frames laid end to end at `fps`. */
const joinedPts = (counts: readonly number[], fps: number) =>
  Array.from({ length: counts.reduce((a, b) => a + b, 0) }, (_, i) => (i * 1000) / fps)

describe("detection defaults (decided 2026-10-06: P3-5, P3-6 (a))", () => {
  it("samples at 2 fps, 540 px tall, with a 2 s margin each side of a kept span", () => {
    expect(DETECTION_PROXY).toEqual({ fps: 2, height: 540 })
    expect(DETECTION_SPAN_MARGIN_MS).toBe(2000)
  })
})

describe("normalizeProxySpans", () => {
  it("sorts, rounds to whole ms and merges overlapping or touching spans", () => {
    expect(normalizeProxySpans([{ startMs: 9000, endMs: 12000 }, { startMs: 1000.4, endMs: 3000.6 }, { startMs: 2500, endMs: 4000 }], 2))
      .toEqual([{ startMs: 1000, endMs: 4000 }, { startMs: 9000, endMs: 12000 }])
    expect(normalizeProxySpans([{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000 }], 2)).toEqual([{ startMs: 0, endMs: 2000 }])
  })

  it("merges spans closer than one sample period: their rows would share a sample on the source clock", () => {
    // 2 fps → 500 ms period: a 400 ms gap merges, a 600 ms gap does not.
    expect(normalizeProxySpans([{ startMs: 0, endMs: 1000 }, { startMs: 1400, endMs: 2000 }], 2)).toEqual([{ startMs: 0, endMs: 2000 }])
    expect(normalizeProxySpans([{ startMs: 0, endMs: 1000 }, { startMs: 1600, endMs: 2000 }], 2)).toHaveLength(2)
  })

  it("clamps a start before the source's zero", () => {
    expect(normalizeProxySpans([{ startMs: -1500, endMs: 1000 }], 2)).toEqual([{ startMs: 0, endMs: 1000 }])
  })

  it("is the same for equivalent inputs (the cache key hashes its output)", () => {
    const a = normalizeProxySpans([{ startMs: 5000, endMs: 6000 }, { startMs: 0, endMs: 1000 }], 2)
    const b = normalizeProxySpans([{ startMs: 0, endMs: 600 }, { startMs: 500, endMs: 1000 }, { startMs: 5000, endMs: 6000 }], 2)
    expect(a).toEqual(b)
  })

  it("refuses empty, non-finite, reversed or zero-length spans as a deterministic error", () => {
    for (const bad of [
      [],
      [{ startMs: Number.NaN, endMs: 1000 }],
      [{ startMs: 0, endMs: Number.POSITIVE_INFINITY }],
      [{ startMs: 2000, endMs: 1000 }],
      [{ startMs: 1000, endMs: 1000 }],
    ]) {
      const err = (() => { try { normalizeProxySpans(bad, 2) } catch (e) { return e } })()
      expect(err).toBeInstanceOf(InvalidProxySpansError)
      expect(err).toBeInstanceOf(DeterministicJobError)
    }
  })
})

describe("padSpans", () => {
  it("widens each span by the margin on both sides, never before zero", () => {
    expect(padSpans([{ startMs: 1000, endMs: 5000 }, { startMs: 60_000, endMs: 61_000 }], DETECTION_SPAN_MARGIN_MS))
      .toEqual([{ startMs: 0, endMs: 7000 }, { startMs: 58_000, endMs: 63_000 }])
  })
})

describe("buildSpanMap — from the frames actually written", () => {
  it("one row per segment that wrote frames, laid on the joined proxy's own frame times", () => {
    const fps = 2
    const segs = [segment(0, 7, fps), segment(10_300, 10, fps), segment(40_777, 15, fps)]
    const map = buildSpanMap(segs, joinedPts([7, 10, 15], fps), fps)
    expect(map).toEqual([
      { proxyStartMs: 0, proxyEndMs: 3500, sourceStartMs: 0, firstFrame: 0, frameCount: 7 },
      { proxyStartMs: 3500, proxyEndMs: 8500, sourceStartMs: 10_300, firstFrame: 7, frameCount: 10 },
      { proxyStartMs: 8500, proxyEndMs: 16_000, sourceStartMs: 40_777, firstFrame: 17, frameCount: 15 },
    ])
  })

  it("takes the segment's first written frame time, not the requested start", () => {
    // A segment whose first frame landed 40 ms after its seek point.
    const map = buildSpanMap([segment(10_000, 3, 2, 40)], [40, 540, 1040], 2)
    expect(map[0]).toMatchObject({ proxyStartMs: 40, sourceStartMs: 10_040 })
  })

  it("skips a segment that wrote no frames (a span past the picture's end)", () => {
    const map = buildSpanMap([segment(0, 4, 2), segment(99_000, 0, 2), segment(5000, 2, 2)], joinedPts([4, 2], 2), 2)
    expect(map.map((r) => r.sourceStartMs)).toEqual([0, 5000])
    expect(map[1].firstFrame).toBe(4)
  })

  it("reads the joined proxy's frames in presentation order (packets arrive in decode order)", () => {
    const map = buildSpanMap([segment(0, 3, 2)], [0, 1000, 500], 2)
    expect(map[0]).toMatchObject({ proxyStartMs: 0, proxyEndMs: 1500 })
  })

  it("refuses a joined proxy whose frame count is not the segments' sum (a segment dropped at the join)", () => {
    expect(() => buildSpanMap([segment(0, 4, 2), segment(5000, 2, 2)], joinedPts([4], 2), 2)).toThrow(/frame/)
  })
})

/** Every frame of a map, with the row it must land in. */
const framesOf = (map: ProxySpanMap) =>
  map.flatMap((row, r) => Array.from({ length: row.frameCount }, (_, k) => ({ frame: row.firstFrame + k, row: r, k })))

describe("the span map is the only clock — round trips", () => {
  // Non-integer rates on purpose: 2.5, 7.5 (133.33… ms) and 29.97 (30000/1001)
  // put frame times on fractions of a millisecond, where a rounded row bound
  // would put a join's frame in the wrong row.
  for (const fps of [2, 2.5, 7.5, 30_000 / 1001]) {
    describe(`at ${fps} fps`, () => {
      const counts = [7, 1, 13, 4]
      const seeks = [0, 10_300.5, 40_777, 3_600_000]
      const map = buildSpanMap(seeks.map((s, i) => segment(s, counts[i], fps)), joinedPts(counts, fps), fps)

      it("frame → source → frame returns the same frame, in its own row", () => {
        for (const { frame, row, k } of framesOf(map)) {
          const sourceMs = proxyFrameToSourceMs(map, fps, frame)
          expect(sourceMs).toBeCloseTo(map[row].sourceStartMs + (k * 1000) / fps, 6)
          expect(sourceMsToProxyFrame(map, fps, sourceMs!)).toBe(frame)
        }
      })

      it("a frame's proxy time maps to the same source time as its index", () => {
        for (const { frame } of framesOf(map)) {
          const proxyMs = (frame * 1000) / fps
          expect(proxyMsToSourceMs(map, proxyMs)).toBeCloseTo(proxyFrameToSourceMs(map, fps, frame)!, 6)
        }
      })

      it("at every join, the last frame stays in its span and the next one opens the next span", () => {
        for (let r = 0; r + 1 < map.length; r++) {
          const last = map[r].firstFrame + map[r].frameCount - 1
          const first = map[r + 1].firstFrame
          expect(first).toBe(last + 1)
          expect(proxyFrameToSourceMs(map, fps, last)).toBeCloseTo(map[r].sourceStartMs + ((map[r].frameCount - 1) * 1000) / fps, 6)
          expect(proxyFrameToSourceMs(map, fps, first)).toBe(map[r + 1].sourceStartMs)
          // by proxy time too: the join's own instant belongs to the NEXT row
          expect(proxyMsToSourceMs(map, map[r + 1].proxyStartMs)).toBe(map[r + 1].sourceStartMs)
        }
      })

      it("a frame outside every row maps to nothing (dropped and counted, never guessed)", () => {
        const total = counts.reduce((a, b) => a + b, 0)
        expect(proxyFrameToSourceMs(map, fps, total)).toBeUndefined()
        expect(proxyFrameToSourceMs(map, fps, -1)).toBeUndefined()
        expect(proxyFrameToSourceMs(map, fps, 1.5)).toBeUndefined()
        expect(proxyMsToSourceMs(map, map[map.length - 1].proxyEndMs)).toBeUndefined()
        expect(proxyMsToSourceMs(map, -0.001)).toBeUndefined()
        // a source time between two spans was never sampled
        expect(sourceMsToProxyFrame(map, fps, 9_000)).toBeUndefined()
      })
    })
  }
})
