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
 *
 * TWIN WARNING: packages/shared/src/selector.ts carries its own private
 * mulberry32 (cosmetically different — `| 0` seed masking — but the same
 * sequence). The two are deliberately INDEPENDENT and both frozen: THIS copy
 * seeds every reverb IR the committed characterization goldens are pinned
 * to, so any change to its sequence silently invalidates the goldens and
 * shifts every rendered reverb waveform. Do NOT "deduplicate" into a shared
 * export or "sync" one copy to match the other.
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
 * lifetime). ONLY SUCCESSES are memoised: a failed probe rejects the job and
 * is retried fresh on the next one — caching a failure would poison every
 * later job of that preset for the worker's lifetime over one transient
 * hiccup.
 *
 * FAILURE POLICY — throw, never guess. There is no fallback value that is
 * safe on every binary: a flat guess is what shipped the 22 dB-hot reverb on
 * 5.1, and under ffmpeg 8's per-IR ℓ1 normalization ANY flat guess renders
 * the wet leg 20–37 dB off (near-silence billed to a customer). A failed
 * probe therefore fails the job loudly — the worker's failure path refunds
 * the credits and the error names this probe — instead of silently rendering
 * garbage. One in-place retry absorbs transient spawn/disk blips first.
 */
/** Minimum probe headroom beyond the IR. The probe window must absorb afir's
 *  algorithmic latency (measured 1–3 samples on 5.1 and 8, but partition
 *  sizes — and therefore worst-case latency — grow with IR length), or the
 *  cropped tail skews the energy ratio and falsely trips the flatness check.
 *  The window therefore SCALES with the IR (see probeAfirEffectiveGain) —
 *  this floor alone must not be trusted for long IRs; it was sized for
 *  today's ≤3 s presets while AFIR_GAIN_MIN deliberately leaves room for
 *  minutes-long ones. */
const AFIR_PROBE_TAIL_SAMPLES = 4800
/** A measured gain outside this band is not a gain, it's a broken probe (a
 *  silent output, a truncated render). The band is wide on purpose: ×2 flat
 *  (ffmpeg 5.1) at the top, and at the bottom enough headroom below the
 *  longest current IR's ℓ1 gain (church, 3 s → ≈1/75) that a much longer
 *  future preset (≈2 minutes of IR before 1/4096 trips) still measures
 *  rather than funneling into a spurious failure. */
const AFIR_GAIN_MIN = 1 / 4096
const AFIR_GAIN_MAX = 8
/** The wet-leg compensation model assumes afir's gain is a FLAT scalar. The
 *  probe verifies that assumption instead of trusting one number: for a flat
 *  gain, peak ratio and energy ratio agree exactly (measured: to 4 decimals
 *  on every preset × both binaries); disagreement beyond this many dB means
 *  some future ffmpeg applies non-flat processing (spectral shaping, a
 *  peak-shifting latency) that a scalar CANNOT cancel — fail rather than
 *  miscompensate and let a re-bless enshrine the wrong output. */
const AFIR_FLATNESS_TOLERANCE_DB = 0.5

const afirGainByPreset = new Map<string, Promise<number>>()

/** FNV-1a over the IR's raw float bits — one cheap pass. The memo key carries
 *  this so a caller reusing a preset NAME with different IR content (the
 *  export invites forensics/tooling callers) measures its own gain instead of
 *  silently inheriting the first IR's. Production is unaffected: the seeded
 *  generator makes each preset's IR — and so its fingerprint — constant. */
function irFingerprint(ir: Float32Array): string {
  const bits = new Uint32Array(ir.buffer, ir.byteOffset, ir.length)
  let hash = 0x811c9dc5
  for (let i = 0; i < bits.length; i++) {
    hash ^= bits[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return `${ir.length}:${(hash >>> 0).toString(16)}`
}

/**
 * Memoised per (preset, IR content, process) — one probe per preset per
 * worker; failures are evicted so the next job retries instead of inheriting
 * a poisoned entry. Exported for the unit tests that pin exactly these
 * semantics.
 */
export function afirEffectiveGain(preset: string, ir: Float32Array): Promise<number> {
  const memoKey = `${preset}#${irFingerprint(ir)}`
  let pending = afirGainByPreset.get(memoKey)
  if (!pending) {
    pending = resolveAfirEffectiveGain(preset, ir)
    afirGainByPreset.set(memoKey, pending)
    pending.catch(() => afirGainByPreset.delete(memoKey))
  }
  return pending
}

/**
 * A probe failure WE diagnosed from the measurement itself (silent IR,
 * implausible gain, non-flat gain). For a given (binary, IR) these reproduce
 * bit-for-bit, so an in-place retry is a wasted spawn and "retry the job" is
 * misleading advice — the fix is code, not persistence. Spawn/IO failures
 * (anything runFfmpeg or the filesystem throws) stay retryable: those are the
 * transient blips the retry exists to absorb. The queue's own bounded retries
 * remain on top of both classes as the net for freak cases (e.g. a partial
 * output file that read as an implausible gain).
 */
class DeterministicProbeError extends Error {}

async function resolveAfirEffectiveGain(preset: string, ir: Float32Array): Promise<number> {
  const failures: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const gain = await probeAfirEffectiveGain(ir)
      console.log(`[audio-fx] afir effective gain for "${preset}": ×${gain.toFixed(6)}`)
      return gain
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[audio-fx] afir gain probe attempt ${attempt + 1} failed for "${preset}": ${msg}`)
      if (err instanceof DeterministicProbeError) {
        // No guessing, no pointless retry: see the FAILURE POLICY above. This
        // rejection fails the job (worker refunds credits) and the memo entry
        // self-evicts.
        throw new Error(
          `afir gain probe failed for reverb preset "${preset}": ${msg} — this result is ` +
          `deterministic for this ffmpeg binary and IR, so retrying will not change it; ` +
          `the reverb graph needs a code fix for this ffmpeg`,
        )
      }
      failures.push(msg)
    }
  }
  // Transient class, both attempts failed. Surface every attempt's message —
  // the later one is usually the more representative of a persisting cause.
  throw new Error(
    `afir gain probe failed for reverb preset "${preset}" (${failures.join("; then ")}) — ` +
    `refusing to render the reverb at a guessed level; retry the job`,
  )
}

async function probeAfirEffectiveGain(ir: Float32Array): Promise<number> {
  const workDir = await createWorkDir("afir-probe")
  try {
    const impulsePath = join(workDir, "impulse.f32")
    const irPath = join(workDir, "ir.f32")
    const outPath = join(workDir, "out.f32")

    // The impulse must be at least as long as the IR: afir's output length
    // follows the INPUT, and a unit-impulse convolution reproduces the IR —
    // truncate it and the peak may fall outside the rendered window. The
    // tail headroom scales with the IR (an eighth, floored at 0.1 s) so
    // partition latency on a future long preset can't crop the response and
    // masquerade as a flatness violation.
    const tailSamples = Math.max(AFIR_PROBE_TAIL_SAMPLES, Math.ceil(ir.length / 8))
    const impulse = unitImpulse(ir.length + tailSamples)
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
    let sumSqOut = 0
    for (let i = 0; i + 4 <= raw.length; i += 4) {
      const v = raw.readFloatLE(i)
      peakOut = Math.max(peakOut, Math.abs(v))
      sumSqOut += v * v
    }
    let peakIr = 0
    let sumSqIr = 0
    for (let i = 0; i < ir.length; i++) {
      peakIr = Math.max(peakIr, Math.abs(ir[i]))
      sumSqIr += ir[i] * ir[i]
    }
    if (peakIr <= 0 || sumSqIr <= 0) throw new DeterministicProbeError("IR is silent")

    const gain = peakOut / peakIr
    if (!Number.isFinite(gain) || gain < AFIR_GAIN_MIN || gain > AFIR_GAIN_MAX) {
      throw new DeterministicProbeError(
        `implausible gain ${gain} (expected within [${AFIR_GAIN_MIN}, ${AFIR_GAIN_MAX}])`,
      )
    }

    // Flatness invariant: a flat scalar g scales the peak by g and the energy
    // by g², so the two independent gain estimates must agree. Divergence
    // means the compensation MODEL is broken, not just the number — fail.
    const energyGain = Math.sqrt(sumSqOut / sumSqIr)
    const flatnessDriftDb = Math.abs(20 * Math.log10(gain / energyGain))
    if (!Number.isFinite(flatnessDriftDb) || flatnessDriftDb > AFIR_FLATNESS_TOLERANCE_DB) {
      throw new DeterministicProbeError(
        `afir gain is not a flat scalar (peak ratio ×${gain.toFixed(6)} vs energy ratio ` +
        `×${energyGain.toFixed(6)}, ${flatnessDriftDb.toFixed(2)} dB apart) — the wet-leg ` +
        `scalar compensation cannot cancel non-flat processing`,
      )
    }
    return gain
  } finally {
    await cleanupWorkDir(workDir)
  }
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
/** IR + serialized bytes per preset. buildReverbIr is seeded-deterministic,
 *  so this trades ~5 MB per worker (all nine presets resident, worst case)
 *  for skipping three full passes over up to 144k floats plus a 576 KB
 *  serialize on EVERY reverb job. The per-job disk write remains — each
 *  job's ffmpeg reads the IR from its own work dir. The cached Float32Array
 *  is shared: callers treat it as immutable. */
const reverbIrByPreset = new Map<string, { ir: Float32Array; bytes: Buffer }>()

export async function writeReverbIr(preset: string, irPath: string): Promise<Float32Array> {
  const r = REVERB[preset] ?? REVERB.room
  let entry = reverbIrByPreset.get(preset)
  if (!entry) {
    const ir = buildReverbIr(r.dur)
    entry = { ir, bytes: floatsToF32le(ir) }
    reverbIrByPreset.set(preset, entry)
  }
  await fs.writeFile(irPath, entry.bytes)
  return entry.ir
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
 *  - `afir` ALSO applies its own gain on top of the convolution, and both the
 *    amount and the mechanism are version-dependent (flat ×2 on 5.1; per-IR ℓ1
 *    normalization via `irnorm`'s default on ffmpeg 8). See `afirEffectiveGain`.
 *  - `irnorm` is NOT an option on ffmpeg 5.1 (`gtype` runs -1..2 and that is all).
 *    Passing it does not degrade — it ERRORS OUT, and every reverb job dies with
 *    it. Do not reach for it; the measured `afirGain` compensation below handles
 *    every version without version-conditional args.
 *
 * So: `gtype=none`. The IR arrives carrying the browser's normalisation and is
 * otherwise UNCOMPENSATED — deliberately. afir's gain on ffmpeg 8 is norm-based
 * and therefore SCALE-INVARIANT: dividing the IR by any measured factor changes
 * its norm by the same factor and cancels nothing. The cancellation must sit
 * OUTSIDE the convolution, which is why it lives in the wet leg's `volume`
 * node via the `afirGain` parameter (a scalar after a convolution is the same
 * signal — LTI — wherever it is applied).
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
