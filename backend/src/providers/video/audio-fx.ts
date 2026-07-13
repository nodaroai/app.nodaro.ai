import { promises as fs } from "node:fs"
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

interface ReverbParams {
  readonly dur: number
  readonly highpassHz?: number
  readonly lowpassHz: number
  readonly mix: number
}

/**
 * Reverb scenarios: how long the space rings for, how it is band-shaped, and its
 * tuned default wet/dry (0–100) when the caller doesn't override.
 *
 * MIRRORED IN `vcp.nodaro.ai/src/lib/audio-graph.ts` (its own `REVERB` table, and
 * deliberately the same shape as it: `durSec` / `highpassHz` / `lowpassHz` / `mix`).
 * The browser previews these presets with a Web Audio ConvolverNode and the user
 * auditions THAT before paying for an export — so these numbers are a shared
 * contract, not a local tuning knob. If you change a row here, change the same row
 * there IN THE SAME BREATH, or the preview stops predicting the file.
 *
 * The band shape is applied DOWNSTREAM of the convolution rather than baked into
 * the IR — see `buildAudioFxArgs`.
 */
const REVERB: Record<string, ReverbParams> = {
  room:           { dur: 0.4,                     lowpassHz: 6000, mix: 28 },
  bathroom:       { dur: 0.7,  highpassHz: 250,   lowpassHz: 9000, mix: 38 },
  car:            { dur: 0.18,                    lowpassHz: 4500, mix: 18 },
  hall:           { dur: 1.2,                     lowpassHz: 6000, mix: 30 },
  "concert-hall": { dur: 2.0,                     lowpassHz: 8000, mix: 34 },
  church:         { dur: 3.0,  highpassHz: 120,   lowpassHz: 4000, mix: 38 },
  cave:           { dur: 2.5,                     lowpassHz: 3000, mix: 42 },
  arena:          { dur: 1.8,                     lowpassHz: 5000, mix: 40 },
  outdoor:        { dur: 0.15,                    lowpassHz: 8000, mix: 10 },
}

/**
 * The Q of the reverb's band filters — and it is NOT Butterworth, however much it
 * looks like it should be.
 *
 * The browser sets `BiquadFilterNode.Q = Math.SQRT1_2` and calls the constant
 * `BUTTERWORTH_Q`. It does not get Butterworth. The Web Audio spec reads `Q` **in
 * DECIBELS** for `lowpass` and `highpass` — `alphaQdB = sin(w0) / (2 * 10^(Q/20))`
 * — so 0.7071 *dB* is an effective LINEAR Q of 10^(0.7071/20) = 1.0848: a mildly
 * resonant filter, not the 0.7071 Butterworth the name promises. (Only bandpass /
 * notch / allpass / peaking read Q linearly.)
 *
 * ffmpeg's `lowpass`/`highpass` take a LINEAR Q and default to 0.707. Leaving that
 * default in place — i.e. "matching" the browser's constant by its face value —
 * makes the export's band shape measurably DARKER than the preview's: a uniform
 * ~0.4 dB on the lowpass-only presets, and 1.4–1.6 dB on the two that also
 * highpass (bathroom, church), where the browser's resonant lift sits right in the
 * pink noise's densest region. So we pass the browser's EFFECTIVE linear Q.
 *
 * Verified on the production ffmpeg (5.1.9): with this Q, ffmpeg's `lowpass`/
 * `highpass` reproduce a spec-exact Web Audio biquad to within 0.01 dB of wet-leg
 * energy on all nine presets. With ffmpeg's default Q they do not.
 */
const WEB_AUDIO_BAND_Q = Math.pow(10, Math.SQRT1_2 / 20)

/**
 * The preset's band shape as an ffmpeg filter chain — highpass (when the space has
 * one) then lowpass, the same order the browser chains its BiquadFilterNodes.
 */
function shapeFilters(r: ReverbParams): string {
  const q = `width_type=q:width=${WEB_AUDIO_BAND_Q.toFixed(6)}`
  const filters: string[] = []
  if (r.highpassHz !== undefined) filters.push(`highpass=f=${r.highpassHz}:${q}`)
  filters.push(`lowpass=f=${r.lowpassHz}:${q}`)
  return filters.join(",")
}

/** The IR is synthesised at, and fed to ffmpeg at, this rate; the voice is
 *  `aresample`d to match so `afir`'s two inputs agree. */
export const IR_SAMPLE_RATE = 48000

/** `-40 dB` by the end of the burst — the exponential decay of the tail. */
const IR_DECAY = 4.6
/** The Kellet pink-noise sum runs to roughly ±3.5; this keeps the buffer inside
 *  [-1, 1]. The absolute level is irrelevant (the normalisation below divides it
 *  straight back out) — this is tidiness, not tuning. */
const IR_PINK_SCALE = 0.11

/* Web Audio spec, `calculateNormalizationScale` (the ConvolverNode's
 * `normalize = true` path). These exact constants are what set the browser's
 * reverb level, so they set ours. */
const GAIN_CALIBRATION = 0.00125
const GAIN_CALIBRATION_SAMPLE_RATE = 44100
const MIN_POWER = 0.000125

function clampNum(v: number | undefined, lo: number, hi: number, fallback: number): number {
  if (v == null || Number.isNaN(v)) return fallback
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Deterministic PRNG (mulberry32) for the IR's noise source. The browser
 * draws a fresh `Math.random()` realization on every page load and users
 * approved that sound — WHICH realization plays is perceptually irrelevant
 * for a diffuse reverb, and the normalisation below makes the level exactly
 * realization-independent (the RMS divides straight out). Fixing the server
 * on ONE realization therefore changes nothing audible, but it makes every
 * render bit-reproducible — which the ffmpeg output-characterization harness
 * requires (golden values against unseeded noise flake ±1 dB forever; see
 * `__characterization__/`). This seeded noise source is the single deliberate
 * divergence from the verbatim browser port documented on `buildReverbIr`.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Arbitrary and FIXED FOREVER — changing it changes every reverb render's
 *  exact waveform (not its sound) and invalidates the blessed goldens. */
const IR_NOISE_SEED = 0x52564231

/**
 * The reverb's impulse response: a decaying pink-noise burst, `durSec` long, MONO.
 *
 * A VERBATIM PORT of `impulseResponse()` in `vcp.nodaro.ai/src/lib/audio-graph.ts`
 * — except the noise source, which is SEEDED here (see `mulberry32` above; the
 * browser stays on `Math.random()` by design, it is the approved reference).
 * The browser's reverb is the one the user auditions and approved; this file's job
 * is to reproduce it, not to improve on it. Keep the two in lockstep.
 *
 * Note what this is NOT: it is not ffmpeg's `afade=curve=exp`, which decays to
 * −100 dB and made the export ring ~1.5× longer than the preview. The envelope is
 * an exponential TIMES a linear taper, and the taper is the part that matters at
 * the end — it drives the final sample to ~1/length of its untapered value (−85 dB
 * for a 0.4 s IR), which is what keeps the IR from stopping on a step. An impulse
 * response that ends on a non-zero sample is an audible click on every convolution.
 *
 * (The browser's comment says the taper lands the last sample on "exactly zero".
 * It doesn't, quite: `p = i / length` never reaches 1, so the last sample is
 * `1/length` of the way up rather than 0. The difference is inaudible and we
 * reproduce the browser's arithmetic exactly rather than "fixing" it — a
 * divergence, however tiny, is a drift vector between preview and export.)
 *
 * The BAND SHAPE is NOT baked in here; it hangs off the convolution downstream
 * (see `buildAudioFxArgs`), exactly as the browser hangs BiquadFilterNodes off its
 * ConvolverNode. Convolution and filtering are both LTI, so `x * (h · g)` and
 * `(x * h) · g` are the same signal.
 *
 * Returns the IR already scaled by the Web Audio normalisation (below), i.e. the
 * IR the browser's ConvolverNode actually convolves with. It is NOT yet
 * compensated for `afir`'s intrinsic gain — `writeReverbIr` does that, because
 * that factor is a property of the ffmpeg binary, not of the reverb.
 */
export function buildReverbIr(durSec: number, sampleRate: number = IR_SAMPLE_RATE): Float32Array {
  const length = Math.max(1, Math.floor(sampleRate * durSec))
  const data = new Float32Array(length)

  // Paul Kellet's economy pink-noise filter — three one-pole sections over white
  // noise. The spectral tilt is what gives the tail its body; white noise alone
  // reads as a thin hiss.
  const random = mulberry32(IR_NOISE_SEED)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    const pink = (b0 + b1 + b2 + white * 0.1848) * IR_PINK_SCALE

    const p = i / length
    data[i] = pink * Math.exp(-IR_DECAY * p) * (1 - p)
  }

  const scale = convolverNormalizationScale(data, sampleRate)
  for (let i = 0; i < length; i++) data[i] *= scale
  return data
}

/**
 * The Web Audio spec's `calculateNormalizationScale` — what a ConvolverNode with
 * `normalize = true` (the default, and what the browser uses) multiplies its IR by.
 *
 * THIS IS THE WHOLE BALLGAME. It is the reason the browser's reverb sits ~16 dB
 * under the dry voice while the export's used to sit ON TOP of it: ffmpeg's
 * `afir=gtype=gn` normalises to roughly UNITY gain, the ConvolverNode normalises to
 * a fixed, tiny RMS. Reproducing this constant is what makes the export sound like
 * the preview.
 *
 * Handy invariant, and the one the unit test pins: the scaled IR's RMS is exactly
 * `GAIN_CALIBRATION * (44100 / sampleRate)` — independent of the IR's contents,
 * because the RMS divides straight out. At 48 kHz that is 0.00125 * (44100/48000)
 * = 0.001148…, and the wet leg's energy is therefore fixed by the IR's LENGTH
 * alone (plus whatever the band shape takes back out).
 */
function convolverNormalizationScale(ir: Float32Array, sampleRate: number): number {
  let sumOfSquares = 0
  for (let i = 0; i < ir.length; i++) sumOfSquares += ir[i] * ir[i]

  // Mono IR, so `numberOfChannels` is 1 and drops out of the spec's
  // `sqrt(power / (numberOfChannels * length))`.
  let power = Math.sqrt(sumOfSquares / ir.length)
  if (!Number.isFinite(power) || power < MIN_POWER) power = MIN_POWER

  return (GAIN_CALIBRATION * (GAIN_CALIBRATION_SAMPLE_RATE / sampleRate)) / power
}

/**
 * `afir` applies gain ON TOP of the convolution, and BOTH the amount and the
 * MECHANISM are version-dependent:
 *
 *  - ffmpeg 5.1 (what production ran before the ffmpeg-8 pin): a flat ×2
 *    (+6.02 dB), independent of the IR.
 *  - ffmpeg 8: a new `irnorm` option EXISTS and DEFAULTS TO 1, which divides
 *    the IR by its ℓ1 norm (Σ|coefficients|) INDEPENDENTLY of `gtype` — so
 *    `gtype=none` no longer means "no gain". For our Web-Audio-normalized
 *    reverb IRs that is a −20…−37 dB wet leg (measured; the attenuation
 *    matched 20·log10(ℓ1) to four decimals on every preset — i.e. the paid
 *    reverb effect silently all but disappears). Passing `irnorm=-1` would
 *    disable it there, but the option is a HARD ERROR on 5.1 — a
 *    version-conditional argument trap (see the buildAudioFxArgs notes).
 *
 * The original defense here — convolve a Dirac IR once and divide the real IR
 * by the measured peak — was structurally blind to ffmpeg 8's behavior twice
 * over: a Dirac's ℓ1 norm is 1 (the probe swears ×1 while real IRs get
 * crushed), and norm-based gain is SCALE-INVARIANT (rescaling the IR rescales
 * its norm, so IR pre-division cancels nothing).
 *
 * So we measure the EFFECTIVE gain for THE ACTUAL IR, per preset, at runtime:
 * convolve a unit impulse with the very IR we are about to use and read
 * peak(output)/peak(IR). A unit-impulse convolution reproduces the IR, so any
 * flat per-IR scalar policy — ×2, ℓ1 normalization, whatever a future ffmpeg
 * invents — is captured exactly. The compensation is then applied to the WET
 * LEG'S volume in the filter graph (NOT to the IR — see above): a scalar
 * after a convolution is the same signal (both are LTI), and it cancels the
 * measured gain regardless of its mechanism.
 *
 * Memoised per preset per process (the IR generator is seeded, so a preset's
 * IR — and therefore its measured gain — is identical for the process's
 * lifetime).
 */
const AFIR_PROBE_TAIL_SAMPLES = 4800
/** A measured gain outside this band is not a gain, it's a broken probe (a
 *  silent output, a truncated render). The band is wide on purpose: ×2 flat
 *  (ffmpeg 5.1) at the top, and 1/ℓ1 of the longest Web-Audio-normalized IR
 *  (church, 3 s → ≈1/75) with margin at the bottom. Fall back rather than
 *  wreck the mix. */
const AFIR_GAIN_MIN = 1 / 512
const AFIR_GAIN_MAX = 8

const afirGainByPreset = new Map<string, Promise<number>>()

/** Memoised per (preset, process) — one probe per preset per worker. */
function afirEffectiveGain(preset: string, ir: Float32Array): Promise<number> {
  let pending = afirGainByPreset.get(preset)
  if (!pending) {
    pending = resolveAfirEffectiveGain(preset, ir)
    afirGainByPreset.set(preset, pending)
  }
  return pending
}

async function resolveAfirEffectiveGain(preset: string, ir: Float32Array): Promise<number> {
  try {
    const gain = await probeAfirEffectiveGain(ir)
    console.log(`[audio-fx] afir effective gain for "${preset}": ×${gain.toFixed(6)}`)
    return gain
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const fallback = await afirGainFromVersion()
    // Loud on purpose: we are now GUESSING at the thing that sets the reverb's
    // level. Silently guessing is how the 22 dB-hot export shipped in the first
    // place.
    console.warn(
      `[audio-fx] afir gain probe FAILED for "${preset}" (${msg}) — falling back to ` +
      `×${fallback} inferred from the ffmpeg version. Reverb level may be off if this is wrong.`,
    )
    return fallback
  }
}

async function probeAfirEffectiveGain(ir: Float32Array): Promise<number> {
  const workDir = await createWorkDir("afir-probe")
  try {
    const impulsePath = join(workDir, "impulse.f32")
    const irPath = join(workDir, "ir.f32")
    const outPath = join(workDir, "out.f32")

    // The impulse must be at least as long as the IR: afir's output length
    // follows the INPUT, and a unit-impulse convolution reproduces the IR —
    // truncate it and the peak may fall outside the rendered window.
    const impulse = unitImpulse(ir.length + AFIR_PROBE_TAIL_SAMPLES)
    await fs.writeFile(impulsePath, floatsToF32le(impulse))
    await fs.writeFile(irPath, floatsToF32le(ir))

    await runFfmpeg([
      "-y",
      "-f", "f32le", "-ar", String(IR_SAMPLE_RATE), "-ac", "1", "-i", impulsePath,
      "-f", "f32le", "-ar", String(IR_SAMPLE_RATE), "-ac", "1", "-i", irPath,
      "-filter_complex", "[0:a][1:a]afir=gtype=none[out]",
      "-map", "[out]",
      "-f", "f32le", "-ar", String(IR_SAMPLE_RATE), "-ac", "1", outPath,
    ])

    const raw = await fs.readFile(outPath)
    let peakOut = 0
    for (let i = 0; i + 4 <= raw.length; i += 4) {
      peakOut = Math.max(peakOut, Math.abs(raw.readFloatLE(i)))
    }
    let peakIr = 0
    for (let i = 0; i < ir.length; i++) peakIr = Math.max(peakIr, Math.abs(ir[i]))
    if (peakIr <= 0) throw new Error("IR is silent")

    const gain = peakOut / peakIr
    if (!Number.isFinite(gain) || gain < AFIR_GAIN_MIN || gain > AFIR_GAIN_MAX) {
      throw new Error(`implausible gain ${gain} (expected within [${AFIR_GAIN_MIN}, ${AFIR_GAIN_MAX}])`)
    }
    return gain
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/** Last resort when the probe can't run: ffmpeg < 6 doubles. ≥6 is reported as
 *  ×1 — under ffmpeg 8's default ℓ1 normalization the truthful value would be
 *  IR-dependent and this fallback CANNOT know which normalization the binary
 *  applies, so ×1 (an over-quiet reverb there) is the least-bad guess. The
 *  probe failing at all is the anomaly to fix. */
async function afirGainFromVersion(): Promise<number> {
  try {
    const out = await runFfmpeg(["-hide_banner", "-version"])
    const major = Number(/ffmpeg version n?(\d+)\./.exec(out)?.[1])
    if (Number.isFinite(major)) return major < 6 ? 2 : 1
  } catch {
    /* fall through */
  }
  // Assume the old production image (5.1.9). Guessing ×1 there would ship a
  // +6 dB reverb; guessing ×2 on a newer ffmpeg ships a −6 dB one. Too quiet
  // beats too loud — the loud one is the bug users complained about.
  return 2
}

function unitImpulse(length: number): Float32Array {
  const data = new Float32Array(length)
  data[0] = 1
  return data
}

/** Explicit little-endian so the bytes match ffmpeg's `-f f32le` on any host. */
function floatsToF32le(samples: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(samples.length * 4)
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], i * 4)
  return buf
}

/**
 * Synthesise the preset's IR, normalise it as the browser does, and write it
 * where ffmpeg can read it as a raw f32le input. Returns the IR so the caller
 * can measure `afir`'s effective gain against THESE exact samples.
 *
 * Note the IR is written UNCOMPENSATED: afir's version-dependent gain is
 * norm-based on ffmpeg 8, and norm-based gain is scale-invariant — dividing
 * the IR cancels nothing there. The cancellation lives in the wet leg's
 * `volume` node instead (see buildAudioFxArgs / afirEffectiveGain).
 *
 * Exported so the level can be verified against the real ffmpeg binary end to
 * end (IR + probe + graph), which is the only way to catch a regression in
 * the one number that matters.
 */
export async function writeReverbIr(preset: string, irPath: string): Promise<Float32Array> {
  const r = REVERB[preset] ?? REVERB.room
  const ir = buildReverbIr(r.dur)
  await fs.writeFile(irPath, floatsToF32le(ir))
  return ir
}

export interface AudioFxPaths {
  readonly inputPath: string
  readonly outputPath: string
  /** Raw f32le IR written by `writeReverbIr`. Required for reverb presets. */
  readonly irPath?: string
}

/**
 * Build the full ffmpeg arg vector for a preset.
 *
 * Reverb presets convolve a PRE-BAKED IR (second input, raw f32le) via `afir` and
 * mix it back against the dry voice. Everything else is a plain `-af` chain on the
 * single input.
 *
 * Why the IR is baked in Node rather than synthesised inline:
 *
 *  - The browser previews these presets with a Web Audio ConvolverNode, and its
 *    `normalize = true` scaling is what puts the reverb ~16 dB UNDER the voice.
 *    `afir`'s own normalisers can't reproduce that number. The export used to run
 *    `afir=gtype=gn` and land the wet leg roughly ON TOP of the dry (+6 dB for
 *    `room`, measured) — ~22 dB hotter than the preview the user approved. The
 *    voice drowned in a dark wash. See `convolverNormalizationScale`.
 *  - `afir` also applies a version-dependent intrinsic gain (×2 on the production
 *    ffmpeg 5.1.9). See `afirIntrinsicGain`.
 *  - `irnorm` is NOT an option on ffmpeg 5.1 (`gtype` runs -1..2 and that is all).
 *    Passing it does not degrade — it ERRORS OUT, and every reverb job dies with
 *    it. Do not reach for it.
 *
 * So: `gtype=none`. The IR arrives already carrying the browser's normalisation and
 * already divided by `afir`'s intrinsic gain, and `afir` is left to do nothing but
 * the convolution.
 *
 * The band shape goes DOWNSTREAM of `afir`, not into the IR — the browser applies
 * it as BiquadFilterNodes after the convolver, and convolution and filtering are
 * both LTI, so the two are the same signal. Note that the filters are pinned to the
 * browser's EFFECTIVE Q rather than left on ffmpeg's default; see
 * `WEB_AUDIO_BAND_Q`, which is the one place the two platforms look like they
 * agree and don't.
 *
 * Dry/wet is a COMPLEMENTARY crossfade (dry × (1−mix), wet × mix) so the output
 * level stays put wherever the Amount slider goes — the browser does the same. The
 * trailing `alimiter` is a clip guard for the file being written; it is transparent
 * below 0.95.
 *
 * `afirGain` is the measured effective gain afir applies to THIS preset's IR
 * on THIS binary (see afirEffectiveGain) — the wet volume divides it back
 * out. It defaults to 1 so the pure arg-shape is testable without a probe.
 */
export function buildAudioFxArgs(opts: AudioFxOptions, paths: AudioFxPaths, afirGain = 1): string[] {
  const p = opts.preset

  if (AUDIO_FX_REVERB_PRESETS.has(p)) {
    const r = REVERB[p] ?? REVERB.room
    if (!paths.irPath) {
      throw new Error(`buildAudioFxArgs: reverb preset "${p}" requires an irPath`)
    }
    if (!(afirGain > 0) || !Number.isFinite(afirGain)) {
      throw new Error(`buildAudioFxArgs: implausible afirGain ${afirGain}`)
    }
    const mixPct = clampNum(opts.mix, 0, 100, r.mix)
    // Wet leg: user mix × the reciprocal of afir's measured gain. On ffmpeg 8
    // the reciprocal is large (ℓ1 normalization crushes the IR by 20–37 dB),
    // so 6 decimals keep the small mix×(1/gain) products exact enough.
    const wetGain = ((mixPct / 100) / afirGain).toFixed(6)
    const dryGain = ((100 - mixPct) / 100).toFixed(3)

    // afir's own dry/wet gains do NOT pass the dry input through (`dry=1:wet=0`
    // outputs silence — verified), so we split the voice, convolve one copy, and
    // amix it back against the other.
    const complex =
      `[0:a]aresample=${IR_SAMPLE_RATE},asplit=2[d][w];` +
      `[w][1:a]afir=gtype=none[wc];` +
      `[wc]${shapeFilters(r)},volume=${wetGain}[wg];` +
      `[d]volume=${dryGain}[dg];` +
      `[dg][wg]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[out]`

    return [
      "-y",
      "-i", paths.inputPath,
      "-f", "f32le", "-ar", String(IR_SAMPLE_RATE), "-ac", "1", "-i", paths.irPath,
      "-filter_complex", complex,
      "-map", "[out]",
      paths.outputPath,
    ]
  }

  return ["-y", "-i", paths.inputPath, "-af", buildAudioFxChain(opts), paths.outputPath]
}

/** The non-reverb presets: plain single-input `-af` chains. Unchanged. */
function buildAudioFxChain(opts: AudioFxOptions): string {
  switch (opts.preset) {
    case "telephone":
      return "highpass=f=300,lowpass=f=3400,equalizer=f=1500:t=q:w=1.2:g=4"
    case "megaphone":
      return "highpass=f=500,lowpass=f=4000,equalizer=f=2000:t=q:w=1:g=4,acrusher=bits=8:mix=0.25,volume=1.5"
    case "echo": {
      const d = clampNum(opts.delayMs, 20, 2000, 250)
      const decay = clampNum(opts.decay, 0.1, 0.9, 0.4)
      return `aecho=0.8:0.88:${d}:${decay}`
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
      return chain.length ? chain.join(",") : "anull"
    }
    default:
      return "anull"
  }
}

/**
 * Apply a preset audio effect to `audioUrl` via FFmpeg. Returns the local output
 * path; the caller (worker) uploads it then cleans up the work dir (mirrors
 * `adjustVolume`). Cleans up itself only on failure.
 */
export async function applyAudioFx(opts: AudioFxOptions): Promise<{ outputPath: string }> {
  const workDir = await createWorkDir("audio-fx")
  try {
    const inputPath = join(workDir, "input.mp3")
    const outputPath = join(workDir, "output.mp3")
    console.log(`[applyAudioFx] Downloading audio (preset: ${opts.preset})`)
    await downloadFile(opts.audioUrl, inputPath)

    let irPath: string | undefined
    let afirGain = 1
    if (AUDIO_FX_REVERB_PRESETS.has(opts.preset)) {
      irPath = join(workDir, "reverb-ir.f32")
      const ir = await writeReverbIr(opts.preset, irPath)
      afirGain = await afirEffectiveGain(opts.preset, ir)
    }

    await runFfmpeg(buildAudioFxArgs(opts, { inputPath, outputPath, irPath }, afirGain))

    console.log(`[applyAudioFx] Output: ${outputPath}`)
    return { outputPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
