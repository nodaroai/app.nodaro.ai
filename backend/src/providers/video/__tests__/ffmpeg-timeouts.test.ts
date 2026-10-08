// The video proxy's per-span ceilings. A span's encode and the frame-time probe
// of the segment it wrote are bounded by the span's own length, so a proxy of
// 270 short spans is not charged 270 three-hour ceilings (and a hung spawn on a
// 24-second span is killed in minutes, not in 45).
import { describe, it, expect } from "vitest"
import {
  DEFAULT_FFMPEG_TIMEOUT_MS,
  MEDIA_PROXY_FFMPEG_TIMEOUT_MS,
  PROXY_SPAN_TIMEOUT_FLOOR_MS,
  proxySpanEncodeTimeoutMs,
  proxySpanProbeTimeoutMs,
} from "../ffmpeg-timeouts.js"

const MIN = 60_000

describe("proxySpanEncodeTimeoutMs", () => {
  it("is the floor plus the span's length at real time, capped at the whole-proxy ceiling", () => {
    expect(PROXY_SPAN_TIMEOUT_FLOOR_MS).toBe(5 * MIN)
    expect(proxySpanEncodeTimeoutMs(24_000)).toBe(5 * MIN + 24_000)
    expect(proxySpanEncodeTimeoutMs(30 * MIN)).toBe(35 * MIN)
    expect(proxySpanEncodeTimeoutMs(40 * MIN)).toBe(MEDIA_PROXY_FFMPEG_TIMEOUT_MS)
    expect(proxySpanEncodeTimeoutMs(180 * MIN)).toBe(MEDIA_PROXY_FFMPEG_TIMEOUT_MS)
  })

  it("never below the floor, never above the ceiling, and the ceiling for a length it cannot read", () => {
    expect(proxySpanEncodeTimeoutMs(0)).toBe(PROXY_SPAN_TIMEOUT_FLOOR_MS)
    expect(proxySpanEncodeTimeoutMs(-5)).toBe(PROXY_SPAN_TIMEOUT_FLOOR_MS)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) expect(proxySpanEncodeTimeoutMs(bad)).toBe(MEDIA_PROXY_FFMPEG_TIMEOUT_MS)
  })

  it("is monotone and subadditive — what lets a budget over separate spans cover their merge", () => {
    const lens = [0, 1, 500, 24_000, 4 * MIN, 39 * MIN, 41 * MIN, 120 * MIN]
    for (const a of lens) {
      for (const b of lens) {
        if (a <= b) expect(proxySpanEncodeTimeoutMs(a)).toBeLessThanOrEqual(proxySpanEncodeTimeoutMs(b))
        // A merge also takes in the gap between them (under one frame period).
        expect(proxySpanEncodeTimeoutMs(a + 500 + b)).toBeLessThanOrEqual(proxySpanEncodeTimeoutMs(a) + proxySpanEncodeTimeoutMs(b))
      }
    }
  })
})

describe("proxySpanProbeTimeoutMs", () => {
  it("the span's ceiling, never longer than the default probe ceiling it replaces", () => {
    expect(proxySpanProbeTimeoutMs(24_000)).toBe(5 * MIN + 24_000)
    expect(proxySpanProbeTimeoutMs(30 * MIN)).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(proxySpanProbeTimeoutMs(Number.NaN)).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
  })
})
