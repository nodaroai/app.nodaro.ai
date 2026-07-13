import { promises as fs } from "node:fs"
import { join } from "node:path"
import { createWorkDir, cleanupWorkDir, runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"

/**
 * Decode-to-raw measurement for the characterization harness.
 *
 * THE PRINCIPLE: never measure the encoded artifact — encoders are
 * nondeterministic and version-sensitive, and that noise would swamp the
 * signal. Every metric here is computed on raw decoded samples (f32le audio,
 * gray-plane video), so what we characterize is the DSP graph's output, not
 * the encoder's mood. Corollary: NO exact checksums anywhere.
 */

export interface AudioMetrics {
  readonly kind: "audio"
  readonly sampleRate: number
  readonly channels: number
  /** Per-channel sample count of the mono downmix at native rate. */
  readonly durationSamples: number
  /** Total energy 10*log10(sum x²) of the mono downmix, dB (floor −120). */
  readonly energyDb: number
  /** Peak |sample| in dBFS (floor −120). */
  readonly peakDb: number
  /** Energy per log-spaced band, 60 Hz → 12 kHz, dB. Catches tone/EQ changes
   *  a single RMS number hides. */
  readonly bandsDb: readonly number[]
  /** Energy per 50 ms window, dB. Catches reverb-time / envelope changes. */
  readonly envelopeDb: readonly number[]
}

export interface VideoMetrics {
  readonly kind: "video"
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frames: number
  readonly pixFmt: string
  /** Mean luma (0–255) over all frames. */
  readonly meanLuma: number
  /** Mean luma per frame — a cheap fingerprint of geometry/timing changes. */
  readonly lumaPerFrame: readonly number[]
  /** Metrics of the first audio stream, or null when the file has none. */
  readonly audio: AudioMetrics | null
}

export interface ImageMetrics {
  readonly kind: "image"
  readonly width: number
  readonly height: number
  readonly meanLuma: number
}

export type Metrics = AudioMetrics | VideoMetrics | ImageMetrics

export const AUDIO_BAND_COUNT = 8
const BAND_LO_HZ = 60
const BAND_HI_HZ = 12000
const ENVELOPE_WINDOW_SEC = 0.05
const DB_FLOOR = -120

const round2 = (v: number): number => Math.round(v * 100) / 100

function powerDb(sumOfSquares: number): number {
  if (!(sumOfSquares > 0)) return DB_FLOOR
  return Math.max(DB_FLOOR, 10 * Math.log10(sumOfSquares))
}

/** First line of `ffmpeg -version`, reduced to the bare version token —
 *  e.g. "5.1.9-0+deb12u1". Used to pin golden files to the binary that
 *  blessed them (Trap: a harness run against the wrong binary must FAIL,
 *  not silently re-measure). */
export async function ffmpegVersionString(): Promise<string> {
  const out = await runFfmpeg(["-hide_banner", "-version"])
  const match = /ffmpeg version (\S+)/.exec(out)
  if (!match) throw new Error(`unparseable ffmpeg -version output: ${out.slice(0, 120)}`)
  return match[1]
}

interface AudioStreamInfo {
  readonly sampleRate: number
  readonly channels: number
}

async function probeAudioStream(path: string): Promise<AudioStreamInfo | null> {
  const out = await runFfprobe([
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels",
    "-of", "json", path,
  ])
  const parsed = JSON.parse(out) as { streams?: Array<{ sample_rate?: string; channels?: number }> }
  const stream = parsed.streams?.[0]
  if (!stream?.sample_rate || !stream.channels) return null
  return { sampleRate: Number(stream.sample_rate), channels: stream.channels }
}

async function readF32(path: string): Promise<Float64Array> {
  const raw = await fs.readFile(path)
  const count = Math.floor(raw.length / 4)
  const samples = new Float64Array(count)
  for (let i = 0; i < count; i++) samples[i] = raw.readFloatLE(i * 4)
  return samples
}

/** In-place iterative radix-2 FFT — enough for band-energy estimates; no
 *  dependency wanted for this. Lengths must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k]
        const aIm = im[i + k]
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe
        re[i + k] = aRe + bRe
        im[i + k] = aIm + bIm
        re[i + k + half] = aRe - bRe
        im[i + k + half] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** Log-spaced band edges in Hz: AUDIO_BAND_COUNT bands from BAND_LO_HZ to
 *  BAND_HI_HZ. */
function bandEdges(): number[] {
  const edges: number[] = []
  const ratio = BAND_HI_HZ / BAND_LO_HZ
  for (let i = 0; i <= AUDIO_BAND_COUNT; i++) {
    edges.push(BAND_LO_HZ * Math.pow(ratio, i / AUDIO_BAND_COUNT))
  }
  return edges
}

function bandEnergiesDb(samples: Float64Array, sampleRate: number): number[] {
  let n = 1
  while (n < samples.length) n <<= 1
  const re = new Float64Array(n)
  re.set(samples)
  const im = new Float64Array(n)
  fft(re, im)

  const edges = bandEdges()
  const binHz = sampleRate / n
  const nyquistBin = n >> 1
  const bands: number[] = []
  for (let b = 0; b < AUDIO_BAND_COUNT; b++) {
    const loBin = Math.max(1, Math.ceil(edges[b] / binHz))
    const hiBin = Math.min(nyquistBin, Math.floor(edges[b + 1] / binHz))
    let sum = 0
    for (let k = loBin; k <= hiBin; k++) sum += re[k] * re[k] + im[k] * im[k]
    // Normalize by FFT length so the number is stable against zero-padding.
    bands.push(round2(powerDb(sum / n)))
  }
  return bands
}

function computeAudioMetrics(samples: Float64Array, info: AudioStreamInfo): AudioMetrics {
  let sumSq = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    sumSq += v * v
    const mag = Math.abs(v)
    if (mag > peak) peak = mag
  }

  const windowSize = Math.max(1, Math.round(ENVELOPE_WINDOW_SEC * info.sampleRate))
  const envelope: number[] = []
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize)
    let winSum = 0
    for (let i = start; i < end; i++) winSum += samples[i] * samples[i]
    envelope.push(round2(powerDb(winSum)))
  }

  return {
    kind: "audio",
    sampleRate: info.sampleRate,
    channels: info.channels,
    durationSamples: samples.length,
    energyDb: round2(powerDb(sumSq)),
    peakDb: round2(peak > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(peak)) : DB_FLOOR),
    bandsDb: bandEnergiesDb(samples, info.sampleRate),
    envelopeDb: envelope,
  }
}

/** Decode the first audio stream to a mono f32 buffer AT ITS NATIVE sample
 *  rate and measure it. Returns null when the file has no audio stream. */
export async function measureAudio(path: string): Promise<AudioMetrics | null> {
  const info = await probeAudioStream(path)
  if (!info) return null

  const workDir = await createWorkDir("characterize-measure")
  try {
    const rawPath = join(workDir, "audio.f32")
    await runFfmpeg([
      "-y", "-i", path,
      "-map", "a:0", "-ac", "1",
      "-f", "f32le", "-c:a", "pcm_f32le", rawPath,
    ])
    const samples = await readF32(rawPath)
    return computeAudioMetrics(samples, info)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

interface VideoStreamInfo {
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly pixFmt: string
}

async function probeVideoStream(path: string): Promise<VideoStreamInfo> {
  const out = await runFfprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,pix_fmt",
    "-of", "json", path,
  ])
  const parsed = JSON.parse(out) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string }>
  }
  const stream = parsed.streams?.[0]
  if (!stream?.width || !stream.height) throw new Error(`no video stream in ${path}`)
  const [num, den] = (stream.r_frame_rate ?? "0/1").split("/").map(Number)
  return {
    width: stream.width,
    height: stream.height,
    fps: den ? round2(num / den) : 0,
    pixFmt: stream.pix_fmt ?? "unknown",
  }
}

/** Decode the video stream to gray rawvideo and measure mean luma per frame,
 *  plus the audio stream (if any) through measureAudio. */
export async function measureVideo(path: string): Promise<VideoMetrics> {
  const info = await probeVideoStream(path)
  const workDir = await createWorkDir("characterize-measure")
  try {
    const rawPath = join(workDir, "video.gray")
    await runFfmpeg([
      "-y", "-i", path,
      "-map", "v:0", "-f", "rawvideo", "-pix_fmt", "gray", rawPath,
    ])
    const raw = await fs.readFile(rawPath)
    const frameBytes = info.width * info.height
    const frames = Math.floor(raw.length / frameBytes)
    const lumaPerFrame: number[] = []
    let total = 0
    for (let f = 0; f < frames; f++) {
      let sum = 0
      const base = f * frameBytes
      for (let i = 0; i < frameBytes; i++) sum += raw[base + i]
      const mean = sum / frameBytes
      lumaPerFrame.push(round2(mean))
      total += mean
    }

    const audio = await measureAudio(path)

    return {
      kind: "video",
      width: info.width,
      height: info.height,
      fps: info.fps,
      frames,
      pixFmt: info.pixFmt,
      meanLuma: round2(frames > 0 ? total / frames : 0),
      lumaPerFrame,
      audio,
    }
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/** Decode a still image to gray and measure dimensions + mean luma. */
export async function measureImage(path: string): Promise<ImageMetrics> {
  const info = await probeVideoStream(path)
  const workDir = await createWorkDir("characterize-measure")
  try {
    const rawPath = join(workDir, "image.gray")
    await runFfmpeg(["-y", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", rawPath])
    const raw = await fs.readFile(rawPath)
    const frameBytes = info.width * info.height
    let sum = 0
    for (let i = 0; i < frameBytes && i < raw.length; i++) sum += raw[i]
    return {
      kind: "image",
      width: info.width,
      height: info.height,
      meanLuma: round2(frameBytes > 0 ? sum / frameBytes : 0),
    }
  } finally {
    await cleanupWorkDir(workDir)
  }
}
