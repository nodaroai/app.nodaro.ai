/**
 * AUDIO SYNC — the pure signal processing behind `audio-sync` (no ffmpeg, no
 * I/O), so every step is testable against a naive reference.
 *
 * Two recordings of one conversation are aligned by CROSS-CORRELATION: slide
 * one against the other and take the shift where they agree most. Done
 * directly that is O(n²); through the FFT it is O(n log n) — a 3-hour episode's
 * envelope correlates in about a second in plain TypeScript (no native
 * dependency, so the node stays core and keyless).
 *
 * Convention (D19, the EDL clock rule): the REFERENCE recording is the clock.
 * A lag `d` (seconds) means a sound heard at source time `s` is heard at
 * reference time `s + d` — so `d` IS the source's `offsetMs / 1000`
 * (`masterMs = sourceMs + offsetMs`).
 */

/** Smallest power of two ≥ n. */
export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** In-place iterative radix-2 complex FFT. `re`/`im` share a power-of-two
 *  length. `inverse` computes the unnormalized inverse (the caller divides by
 *  the length). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const xr = re[b]! * cr - im[b]! * ci
        const xi = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/**
 * Cross-correlation `g[k] = Σ_i ref[i + k] · src[i]` for every lag
 * k ∈ [−(src.length − 1), ref.length − 1], via the FFT, zero-padded so no lag
 * wraps. Read a lag with `atLag(k)`. If `ref(t) = src(t − d)` the peak is at
 * k = d (samples).
 *
 * `phat`: weight the cross-spectrum by the inverse of its magnitude (GCC-PHAT),
 * so every frequency votes by its PHASE alone. A reverberant room smears the
 * plain correlation's peak toward the reflections (a camera 4 m from the
 * speaker, direct sound 11 dB under the reverb, read 23 ms late at full
 * confidence); PHAT keeps the direct path's sharp peak. Regularized by a tenth
 * of the mean magnitude so a near-empty band (above a mic's roll-off) cannot
 * vote with amplified noise. The values are then no longer a dot product — use
 * the PEAK LOCATION, and measure similarity separately.
 */
export function crossCorrelate(ref: ArrayLike<number>, src: ArrayLike<number>, opts: { readonly phat?: boolean } = {}): { readonly atLag: (k: number) => number; readonly minLag: number; readonly maxLag: number } {
  const n = nextPow2(ref.length + src.length)
  const rr = new Float64Array(n)
  const ri = new Float64Array(n)
  const sr = new Float64Array(n)
  const si = new Float64Array(n)
  for (let i = 0; i < ref.length; i++) rr[i] = ref[i]!
  for (let i = 0; i < src.length; i++) sr[i] = src[i]!
  fft(rr, ri)
  fft(sr, si)
  // R · conj(S)
  for (let i = 0; i < n; i++) {
    const a = rr[i]!, b = ri[i]!, c = sr[i]!, d = -si[i]!
    rr[i] = a * c - b * d
    ri[i] = a * d + b * c
  }
  if (opts.phat) {
    let meanMag = 0
    for (let i = 0; i < n; i++) meanMag += Math.hypot(rr[i]!, ri[i]!)
    meanMag /= n
    const floor = 0.1 * meanMag + 1e-30
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(rr[i]!, ri[i]!) + floor
      rr[i] = rr[i]! / m
      ri[i] = ri[i]! / m
    }
  }
  fft(rr, ri, true)
  const g = rr
  return {
    atLag: (k: number) => g[(k % n + n) % n]! / n,
    minLag: -(src.length - 1),
    maxLag: ref.length - 1,
  }
}

/** The lag of the largest correlation in [lo, hi], refined to a fraction of a
 *  sample by fitting a parabola through the peak and its two neighbours. */
export function peakLag(atLag: (k: number) => number, lo: number, hi: number): { readonly lag: number; readonly value: number; readonly index: number } {
  let best = lo
  let bestVal = -Infinity
  for (let k = lo; k <= hi; k++) {
    const v = atLag(k)
    if (v > bestVal) { bestVal = v; best = k }
  }
  let frac = 0
  if (best > lo && best < hi) {
    const y0 = atLag(best - 1), y1 = bestVal, y2 = atLag(best + 1)
    const den = y0 - 2 * y1 + y2
    if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den))
  }
  return { lag: best + frac, value: bestVal, index: best }
}

/** Peak over the strongest correlation OUTSIDE `exclude` lags of the peak —
 *  how clearly one alignment beats every other. ≥ ~3 is a clean match; near 1
 *  means two alignments fit about equally (ambiguous or no shared sound). */
export function peakToSidelobe(atLag: (k: number) => number, lo: number, hi: number, peakIndex: number, exclude: number): number {
  const peak = atLag(peakIndex)
  let side = 0
  for (let k = lo; k <= hi; k++) {
    if (Math.abs(k - peakIndex) <= exclude) continue
    side = Math.max(side, atLag(k))
  }
  if (peak <= 0) return 0
  return side <= 0 ? Infinity : peak / side
}

/**
 * ONSET envelope, built from streamed PCM: per hop, the rise in log energy
 * (half-wave rectified) — "something started here". Two microphones in one room
 * hear the same syllable onsets whatever their gain, EQ or noise floor, so their
 * onset envelopes correlate where the raw loudness curves (dominated by each
 * mic's level) would not. Finished envelopes are zero-mean, unit-variance.
 */
export class OnsetEnvelope {
  private readonly hop: number
  private acc = 0
  private count = 0
  private prev: number | undefined
  private readonly out: number[] = []

  constructor(hopSamples: number) {
    this.hop = Math.max(1, Math.round(hopSamples))
  }

  push(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]!
      this.acc += x * x
      if (++this.count === this.hop) this.emit()
    }
  }

  private emit(): void {
    const e = Math.log(1e-12 + this.acc / this.count) // floor for digital silence
    this.out.push(this.prev === undefined ? 0 : Math.max(0, e - this.prev))
    this.prev = e
    this.acc = 0
    this.count = 0
  }

  finish(): Float64Array {
    if (this.count > 0) this.emit()
    return standardize(this.out)
  }
}

/** Zero mean, unit variance (all-zero stays all-zero). */
export function standardize(x: ArrayLike<number>): Float64Array {
  const n = x.length
  const out = new Float64Array(n)
  if (n === 0) return out
  let mean = 0
  for (let i = 0; i < n; i++) mean += x[i]!
  mean /= n
  let v = 0
  for (let i = 0; i < n; i++) v += (x[i]! - mean) ** 2
  const sd = Math.sqrt(v / n)
  for (let i = 0; i < n; i++) out[i] = sd > 0 ? (x[i]! - mean) / sd : 0
  return out
}

/** Least-squares line through (t, lag): the lag at time t is `at(t)`; `slope`
 *  is seconds of lag per second — clock drift. One point: a flat line. */
export function fitLine(points: ReadonlyArray<{ readonly t: number; readonly lag: number }>): { readonly at: (t: number) => number; readonly slope: number; readonly maxResidual: number } {
  const n = points.length
  if (n === 0) return { at: () => 0, slope: 0, maxResidual: 0 }
  const mt = points.reduce((a, p) => a + p.t, 0) / n
  const ml = points.reduce((a, p) => a + p.lag, 0) / n
  let sxx = 0, sxy = 0
  for (const p of points) { sxx += (p.t - mt) ** 2; sxy += (p.t - mt) * (p.lag - ml) }
  const slope = n > 1 && sxx > 0 ? sxy / sxx : 0
  const at = (t: number) => ml + slope * (t - mt)
  const maxResidual = points.reduce((a, p) => Math.max(a, Math.abs(p.lag - at(p.t))), 0)
  return { at, slope, maxResidual }
}
