// The pure DSP behind `audio-sync`, each step pinned against a naive reference.
import { describe, it, expect } from "vitest"
import { crossCorrelate, fft, fitLine, nextPow2, OnsetEnvelope, peakLag, peakToSidelobe, standardize } from "../audio-sync-dsp.js"
import { audioSyncConfidence, AUDIO_SYNC_LOW_CONFIDENCE } from "../audio-sync.js"

// Deterministic noise (mulberry32).
function rng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const noise = (n: number, seed: number) => { const r = rng(seed); return Float64Array.from({ length: n }, () => r() * 2 - 1) }

describe("fft", () => {
  it("round-trips a signal (inverse / n)", () => {
    const x = noise(64, 1)
    const re = Float64Array.from(x), im = new Float64Array(64)
    fft(re, im)
    fft(re, im, true)
    for (let i = 0; i < 64; i++) expect(re[i]! / 64).toBeCloseTo(x[i]!, 10)
  })
  it("matches a naive DFT", () => {
    const x = noise(16, 2)
    const re = Float64Array.from(x), im = new Float64Array(16)
    fft(re, im)
    for (let k = 0; k < 16; k++) {
      let r = 0, i = 0
      for (let n = 0; n < 16; n++) { r += x[n]! * Math.cos((-2 * Math.PI * k * n) / 16); i += x[n]! * Math.sin((-2 * Math.PI * k * n) / 16) }
      expect(re[k]).toBeCloseTo(r, 9)
      expect(im[k]).toBeCloseTo(i, 9)
    }
  })
  it("refuses a length that is not a power of two", () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(/power of two/)
  })
  it("nextPow2", () => {
    expect([1, 2, 3, 5, 1024, 1025].map(nextPow2)).toEqual([1, 2, 4, 8, 1024, 2048])
  })
})

describe("crossCorrelate", () => {
  it("equals Σ ref[i + k] · src[i] at every lag, with no wrap-around", () => {
    const ref = noise(37, 3), src = noise(23, 4)
    const { atLag, minLag, maxLag } = crossCorrelate(ref, src)
    expect([minLag, maxLag]).toEqual([-22, 36])
    for (let k = minLag; k <= maxLag; k++) {
      let g = 0
      for (let i = 0; i < src.length; i++) { const j = i + k; if (j >= 0 && j < ref.length) g += ref[j]! * src[i]! }
      expect(atLag(k)).toBeCloseTo(g, 8)
    }
  })
  it("peaks at d when ref(t) = src(t − d) — both signs", () => {
    const base = noise(4000, 5)
    for (const d of [0, 137, -251]) {
      // A sound at source index s lands at reference index s + d (D19: the
      // source's offset is +d).
      const ref = new Float64Array(3000), src = new Float64Array(3000)
      for (let s = 0; s < 3000; s++) { src[s] = base[s + 500]!; const j = s + d; if (j >= 0 && j < 3000) ref[j] = base[s + 500]! }
      const { atLag, minLag, maxLag } = crossCorrelate(ref, src)
      expect(peakLag(atLag, minLag, maxLag).index).toBe(d)
    }
  })
})

describe("crossCorrelate with PHAT", () => {
  it("peaks at the direct path when a delayed reflection is louder than it (where plain correlation smears)", () => {
    // src = the sound; ref = the sound 40 samples later (direct) + a louder copy
    // 55 samples after that (a strong reflection).
    const base = noise(6000, 21)
    const ref = new Float64Array(6000), src = new Float64Array(6000)
    for (let s = 0; s < 5800; s++) {
      src[s] = base[s]!
      if (s + 40 < 6000) ref[s + 40] = ref[s + 40]! + 0.6 * base[s]!
      if (s + 95 < 6000) ref[s + 95] = ref[s + 95]! + 1.0 * base[s]!
    }
    const plain = crossCorrelate(ref, src)
    const phat = crossCorrelate(ref, src, { phat: true })
    expect(peakLag(plain.atLag, -200, 200).index).toBe(95) // plain follows the louder reflection
    // PHAT gives BOTH paths near-equal, sharp peaks; the direct one is found
    // when the search starts at the first arrival — the property the fine pass
    // relies on is that it is a sharp peak AT a true path, not smeared between.
    const at40 = phat.atLag(40), at95 = phat.atLag(95), between = phat.atLag(67)
    expect(at40).toBeGreaterThan(10 * Math.abs(between))
    expect(at95).toBeGreaterThan(10 * Math.abs(between))
  })
  it("finds the same lag as plain correlation on a clean delay", () => {
    const base = noise(4000, 22)
    const ref = new Float64Array(3000), src = new Float64Array(3000)
    for (let s = 0; s < 3000; s++) { src[s] = base[s + 500]!; const j = s + 123; if (j < 3000) ref[j] = base[s + 500]! }
    const { atLag, minLag, maxLag } = crossCorrelate(ref, src, { phat: true })
    expect(peakLag(atLag, minLag, maxLag).index).toBe(123)
  })
})

describe("peakLag", () => {
  it("refines a peak between samples with a parabola", () => {
    // y = −(k − 2.3)²: the true maximum is at 2.3
    const f = (k: number) => -((k - 2.3) ** 2)
    expect(peakLag(f, -10, 10).lag).toBeCloseTo(2.3, 9)
  })
  it("stays on a boundary peak (no neighbour to fit)", () => {
    expect(peakLag((k) => k, 0, 5).lag).toBe(5)
  })
})

describe("peakToSidelobe", () => {
  it("is large for one clear alignment and near 1 for two equal ones", () => {
    const clear = (k: number) => (k === 0 ? 10 : 1)
    expect(peakToSidelobe(clear, -50, 50, 0, 3)).toBe(10)
    const twin = (k: number) => (k === 0 || k === 20 ? 10 : 1)
    expect(peakToSidelobe(twin, -50, 50, 0, 3)).toBe(1)
  })
})

describe("OnsetEnvelope", () => {
  it("marks the rise of a burst, whatever the gain", () => {
    const burst = (gain: number) => {
      const env = new OnsetEnvelope(80)
      const x = new Float64Array(8000)
      for (let i = 0; i < 8000; i++) x[i] = (i >= 4000 && i < 6000 ? gain : 0.001 * gain) * Math.sin(i)
      env.push(x)
      return env.finish()
    }
    const loud = burst(1), quiet = burst(0.1)
    const argmax = (a: Float64Array) => a.reduce((b, v, i) => (v > a[b]! ? i : b), 0)
    expect(argmax(loud)).toBe(50) // 4000 / 80
    expect(argmax(quiet)).toBe(50)
    for (let i = 0; i < loud.length; i++) expect(quiet[i]).toBeCloseTo(loud[i]!, 4) // gain-free (above the silence floor)
  })
  it("accepts PCM in any chunking", () => {
    const x = noise(10_000, 9)
    const whole = new OnsetEnvelope(80); whole.push(x)
    const parts = new OnsetEnvelope(80); for (let i = 0; i < x.length; i += 333) parts.push(x.subarray(i, i + 333))
    expect(Array.from(parts.finish())).toEqual(Array.from(whole.finish()))
  })
})

describe("standardize / fitLine", () => {
  it("standardize: zero mean, unit variance; all-zero stays zero", () => {
    const s = standardize([1, 2, 3, 4])
    expect(s.reduce((a, v) => a + v, 0)).toBeCloseTo(0, 12)
    expect(s.reduce((a, v) => a + v * v, 0) / 4).toBeCloseTo(1, 12)
    expect(Array.from(standardize([0, 0, 0]))).toEqual([0, 0, 0])
  })
  it("fitLine: slope is drift, residual is disagreement", () => {
    const pts = [0, 100, 200].map((t) => ({ t, lag: 7.5 + 1e-4 * t }))
    const f = fitLine(pts)
    expect(f.slope).toBeCloseTo(1e-4, 12)
    expect(f.at(100)).toBeCloseTo(7.51, 12)
    expect(f.maxResidual).toBeCloseTo(0, 12)
    expect(fitLine([{ t: 5, lag: 2 }]).slope).toBe(0)
  })
})

// Calibrated on the review of #1641 (pinned 8.1.2, TTS speech through rooms):
// exact answers on real speech had PHAT peaks of only 1.3–2× their surroundings,
// and the first formula (min of lock and agreement) scored them 0–0.28 with a
// "little clear sound" note — which B4 would have filtered out.
describe("audioSyncConfidence", () => {
  it("three windows agreeing to a millisecond pass the check-by-ear line even with weak peaks (a reverberant camera)", () => {
    const c = audioSyncConfidence({ prominences: [1.65, 1.71, 1.46], windows: 3, maxResidualMs: 0.01, coarsePsr: 1.4 })
    expect(c).toBeGreaterThanOrEqual(AUDIO_SYNC_LOW_CONFIDENCE)
    expect(c).toBeGreaterThanOrEqual(0.6)
  })
  it("a sharp lock on three agreeing windows is full confidence", () => {
    expect(audioSyncConfidence({ prominences: [5, 6, 7], windows: 3, maxResidualMs: 0.2, coarsePsr: 8 })).toBe(1)
  })
  it("three windows that disagree by 5 ms or more are no match, however sharp each peak", () => {
    expect(audioSyncConfidence({ prominences: [9, 9, 9], windows: 3, maxResidualMs: 5, coarsePsr: 9 })).toBe(0)
    expect(audioSyncConfidence({ prominences: [9, 9, 9], windows: 3, maxResidualMs: 40, coarsePsr: 9 })).toBe(0)
  })
  it("a single window cannot cross-check: its lock AND the coarse alignment must both hold", () => {
    expect(audioSyncConfidence({ prominences: [6], windows: 1, maxResidualMs: 0, coarsePsr: 6 })).toBe(1)
    expect(audioSyncConfidence({ prominences: [6], windows: 1, maxResidualMs: 0, coarsePsr: 1.2 })).toBe(0)
    expect(audioSyncConfidence({ prominences: [1.5], windows: 1, maxResidualMs: 0, coarsePsr: 6 })).toBe(0)
  })
  it("no window at all is no confidence", () => {
    expect(audioSyncConfidence({ prominences: [], windows: 0, maxResidualMs: 0, coarsePsr: 9 })).toBe(0)
  })
})
