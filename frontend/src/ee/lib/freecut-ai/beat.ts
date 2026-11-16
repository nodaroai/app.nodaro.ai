/**
 * The beat of a music track, found in the browser from its samples: how fast it
 * goes (BPM) and where its beats fall. Pure, so it is tested on synthetic beats.
 *
 * An onset envelope (where the sound gets louder, frame by frame) is
 * autocorrelated over the tempos music is usually played at; the beat grid is
 * then laid where the onsets agree with it best.
 */

export interface BeatGrid {
  readonly bpm: number
  /** Beat times in seconds, from the first beat on. */
  readonly beats: readonly number[]
}

const HOP = 512
const MIN_BPM = 70
const MAX_BPM = 180

/** Where the sound gets louder, one value per hop: half-wave rectified energy rises. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): { readonly envelope: Float32Array; readonly rate: number } {
  const frames = Math.max(0, Math.floor(samples.length / HOP))
  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const start = f * HOP
    for (let i = 0; i < HOP; i++) {
      const v = samples[start + i] ?? 0
      sum += v * v
    }
    energy[f] = Math.sqrt(sum / HOP)
  }
  const envelope = new Float32Array(frames)
  for (let f = 1; f < frames; f++) envelope[f] = Math.max(0, energy[f]! - energy[f - 1]!)
  return { envelope, rate: sampleRate / HOP }
}

/** The tempo and the beat grid of a track; null when there is no clear beat (or too little sound). */
export function findBeat(samples: Float32Array, sampleRate: number): BeatGrid | null {
  const { envelope, rate } = onsetEnvelope(samples, sampleRate)
  if (envelope.length < rate * 4) return null
  const mean = envelope.reduce((s, v) => s + v, 0) / envelope.length
  if (!(mean > 0)) return null
  const centered = envelope.map((v) => v - mean)
  const minLag = Math.floor((60 / MAX_BPM) * rate)
  const maxLag = Math.ceil((60 / MIN_BPM) * rate)
  const scoreOf = (lag: number) => {
    let score = 0
    for (let i = lag; i < centered.length; i++) score += centered[i]! * centered[i - lag]!
    // A gentle preference for the tempos most music sits at, so a half or double tempo does not win by noise.
    const bpm = (60 * rate) / lag
    return score * Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.6) ** 2)
  }
  let bestLag = 0
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = scoreOf(lag)
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (bestLag === 0 || !(bestScore > 0)) return null
  // A beat rarely lasts a whole number of hops, and a grid a little off drifts
  // off the beat along the track: the beat's length and where it falls are
  // found together, to a fraction of a hop, as the comb that sits best on the onsets.
  const at = (x: number) => {
    const i = Math.floor(x)
    const f = x - i
    return (envelope[i] ?? 0) * (1 - f) + (envelope[i + 1] ?? 0) * f
  }
  let best = { lag: bestLag, phase: 0, score: -Infinity }
  for (let lag = bestLag - 1; lag <= bestLag + 1; lag += 0.05) {
    for (let phase = 0; phase < lag; phase += 0.25) {
      let sum = 0
      let teeth = 0
      for (let x = phase; x < envelope.length - 1; x += lag) {
        sum += at(x)
        teeth += 1
      }
      const score = teeth > 0 ? sum / teeth : 0
      if (score > best.score) best = { lag, phase, score }
    }
  }
  const period = best.lag / rate
  const beats: number[] = []
  for (let t = best.phase / rate; t < envelope.length / rate; t += period) beats.push(Math.round(t * 1000) / 1000)
  return { bpm: Math.round((60 / period) * 10) / 10, beats }
}

/**
 * Where in the track to start, so a beat lands on the first spoken word: the
 * first beat at or after the word's time in the track, moved back by that time.
 */
export function startOnBeat(grid: BeatGrid, firstWordSeconds: number): number {
  const beat = grid.beats.find((b) => b >= firstWordSeconds) ?? grid.beats[0] ?? 0
  return Math.max(0, beat - firstWordSeconds)
}
