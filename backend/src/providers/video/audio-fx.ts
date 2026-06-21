import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { AUDIO_FX_REVERB_PRESETS, type AudioFxPreset } from "@nodaro/shared"

export interface AudioFxOptions {
  readonly audioUrl: string
  readonly preset: AudioFxPreset
  /** Wet/dry mix 0–100 (reverb presets). Defaults to the preset's tuned value. */
  readonly mix?: number
  /** Custom / echo: delay time in ms. */
  readonly delayMs?: number
  /** Custom / echo: decay 0–1. */
  readonly decay?: number
  /** Custom: low-shelf gain dB. */
  readonly eqLow?: number
  /** Custom: high-shelf gain dB. */
  readonly eqHigh?: number
}

/**
 * Reverb scenarios → inline-synth IR params. The IR is a decaying pink-noise
 * burst (DUR seconds) band-shaped per space; convolved with the voice via
 * `afir`. `mix` is the default wet/dry (0–100) when the caller doesn't override.
 * Values are tuned by ear post-ship — see the design doc Open Items.
 */
const REVERB: Record<string, { dur: number; shape: string; mix: number }> = {
  room:           { dur: 0.4,  shape: "lowpass=f=6000",                mix: 28 },
  bathroom:       { dur: 0.7,  shape: "highpass=f=250,lowpass=f=9000", mix: 38 },
  car:            { dur: 0.18, shape: "lowpass=f=4500",                mix: 18 },
  hall:           { dur: 1.2,  shape: "lowpass=f=6000",                mix: 30 },
  "concert-hall": { dur: 2.0,  shape: "lowpass=f=8000",                mix: 34 },
  church:         { dur: 3.0,  shape: "highpass=f=120,lowpass=f=4000", mix: 38 },
  cave:           { dur: 2.5,  shape: "lowpass=f=3000",                mix: 42 },
  arena:          { dur: 1.8,  shape: "lowpass=f=5000",                mix: 40 },
  outdoor:        { dur: 0.15, shape: "lowpass=f=8000",                mix: 10 },
}

function clampNum(v: number | undefined, lo: number, hi: number, fallback: number): number {
  if (v == null || Number.isNaN(v)) return fallback
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Build the post-input ffmpeg args for a preset. Reverb presets synthesize the
 * IR inline and convolve via `afir` (filter_complex + `-map [out]`); the rest
 * use a plain `-af` chain on the single input.
 */
export function buildAudioFxArgs(opts: AudioFxOptions): string[] {
  const p = opts.preset

  if (AUDIO_FX_REVERB_PRESETS.has(p)) {
    const r = REVERB[p] ?? REVERB.room
    // afir's OWN dry/wet gains do NOT pass the dry input through (`dry=1:wet=0`
    // outputs silence — verified). So we split the input, convolve one copy
    // (the wet/reverb), and amix it back with the dry copy.
    //
    // dry/wet is a COMPLEMENTARY crossfade so the output level stays ~constant
    // regardless of mix. Two bugs were here before:
    //   1. the dry passed through at FULL volume while the wet was SUMMED on top
    //      (`amix=normalize=0` sums) → louder the higher the mix;
    //   2. the wet was boosted ×8 → 100% wet clipped (too loud / corrupt).
    // `afir=gtype=gn` gain-normalizes the IR, so the convolved wet is already
    // ~unity (≈ the dry level) — no boost is needed. We scale each leg
    // ourselves: dry by (1 − mix), wet by mix. At mix=0 → pure dry; mix=100 →
    // pure wet (≈ original loudness); in between the two unity legs sum to ~1.
    // A final alimiter is a hard safety against constructive peaks (no clipping
    // / corruption regardless of mix).
    const mixPct = clampNum(opts.mix, 0, 100, r.mix)
    const wetGain = (mixPct / 100).toFixed(3)
    const dryGain = ((100 - mixPct) / 100).toFixed(3)
    const ir = `anoisesrc=r=48000:d=${r.dur}:c=pink:a=0.8,afade=t=out:st=0:d=${r.dur}:curve=exp,${r.shape}[ir]`
    const complex =
      `[0:a]aresample=48000,asplit=2[d][w];` +
      `${ir};` +
      `[w][ir]afir=gtype=gn[wc];` +
      `[wc]volume=${wetGain}[wg];` +
      `[d]volume=${dryGain}[dg];` +
      `[dg][wg]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[out]`
    return ["-filter_complex", complex, "-map", "[out]"]
  }

  switch (p) {
    case "telephone":
      return ["-af", "highpass=f=300,lowpass=f=3400,equalizer=f=1500:t=q:w=1.2:g=4"]
    case "megaphone":
      return ["-af", "highpass=f=500,lowpass=f=4000,equalizer=f=2000:t=q:w=1:g=4,acrusher=bits=8:mix=0.25,volume=1.5"]
    case "echo": {
      const d = clampNum(opts.delayMs, 20, 2000, 250)
      const decay = clampNum(opts.decay, 0.1, 0.9, 0.4)
      return ["-af", `aecho=0.8:0.88:${d}:${decay}`]
    }
    case "custom": {
      const chain: string[] = []
      if (opts.eqLow) chain.push(`bass=g=${clampNum(opts.eqLow, -20, 20, 0)}`)
      if (opts.eqHigh) chain.push(`treble=g=${clampNum(opts.eqHigh, -20, 20, 0)}`)
      if (opts.delayMs) {
        const d = clampNum(opts.delayMs, 20, 2000, 250)
        const decay = clampNum(opts.decay, 0.1, 0.9, 0.3)
        chain.push(`aecho=0.8:0.85:${d}:${decay}`)
      }
      return ["-af", chain.length ? chain.join(",") : "anull"]
    }
    default:
      return ["-af", "anull"]
  }
}

/**
 * Apply a preset audio effect to `audioUrl` via FFmpeg. Returns the local
 * output path; the caller (worker) uploads it then cleans up the work dir
 * (mirrors `adjustVolume`). Cleans up itself only on failure.
 */
export async function applyAudioFx(opts: AudioFxOptions): Promise<{ outputPath: string }> {
  const workDir = await createWorkDir("audio-fx")
  try {
    const inputPath = join(workDir, "input.mp3")
    const outputPath = join(workDir, "output.mp3")
    console.log(`[applyAudioFx] Downloading audio (preset: ${opts.preset})`)
    await downloadFile(opts.audioUrl, inputPath)

    await runFfmpeg(["-y", "-i", inputPath, ...buildAudioFxArgs(opts), outputPath])

    console.log(`[applyAudioFx] Output: ${outputPath}`)
    return { outputPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
