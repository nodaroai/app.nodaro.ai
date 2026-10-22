/**
 * Mask Composite — a foreground video over a background video through a mask
 * video (white = foreground, black = background). Local ffmpeg, no provider:
 * runs with zero API keys in every edition.
 *
 * The render follows the FOREGROUND (size, frame rate, length). The background
 * is fitted to that frame and loops when shorter; the mask is stretched to the
 * frame and holds its last frame when shorter.
 *
 * With `fill` pixelate / blur there is no foreground: the masked area shows
 * the BACKGROUND itself, pixelated or blurred, so the render follows the
 * background (`buildMaskCompositeFillArgs`). The video fill's graph is
 * untouched by that mode. The settings come from
 * `resolveMaskCompositeSettings` (`@nodaro/shared`), the one normaliser every
 * engine calls.
 *
 * `buildMaskCompositeArgs` is a PURE function of the probed inputs, so the
 * graph is unit-tested without ffmpeg; `maskComposite` downloads, probes and
 * runs it.
 */

import { join } from "node:path"
import {
  MASK_COMPOSITE_BOUNDS,
  maskCompositeEffectiveAudioSource,
  maskCompositeUsesForeground,
  type MaskCompositeAudioSource,
  type MaskCompositeBackgroundFit,
  type MaskCompositeSettings,
} from "@nodaro/shared/media"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  hasAudioStream,
  probeVideoOverlayBase,
  runFfmpeg,
} from "./ffmpeg-utils.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"
import { canvasPeakMemoryMiB } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/** What the graph needs to know about the inputs (probed by `maskComposite`). */
export interface MaskCompositeProbe {
  /** Foreground DISPLAY size (rotation applied), any parity. (For pixelate / blur, every
   *  foreground field here describes the BACKGROUND, the video the render follows.) */
  readonly width: number
  readonly height: number
  /** Foreground frame rate as an ffmpeg rational ("30000/1001"), or undefined when it has none. */
  readonly frameRate?: string
  /** Foreground picture length, seconds. */
  readonly durationSec: number
  /** Where the foreground's picture starts on its own clock, seconds (0 for most files). */
  readonly startSec?: number
  /** Foreground frame count, when the container states one: the render's exact length in frames. */
  readonly frameCount?: number
  /** Foreground sample aspect ratio, display orientation (1 = square pixels). */
  readonly sar?: number
  readonly foregroundHasAudio: boolean
  readonly backgroundHasAudio: boolean
}

/** Near-black (≤ this) reads as fully background, near-white (≥ MASK_WHITE) as fully foreground:
 *  covers limited-range encodes (16–235) and compression noise in a binary mask. */
const MASK_BLACK = 24
const MASK_WHITE = 230

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/** The mask multiplier, 4 decimals (finer than one 8-bit mask level). */
const opacityFactor = (opacity: number): string => Math.min(1, Math.max(0, opacity)).toFixed(4)

function backgroundFitFilter(fit: MaskCompositeBackgroundFit, w: number, h: number): string {
  switch (fit) {
    case "contain":
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
    case "stretch":
      return `scale=${w}:${h}`
    case "cover":
    default:
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
  }
}

/**
 * Every input is composited on a clock starting at 0: ffmpeg pairs frames by
 * timestamp, and a mask's frame N belongs to the followed video's frame N
 * (Video Mask draws one per decoded frame, starting at 0). Shifting the mask
 * to a picture that starts late instead fails when the start is not a whole
 * number of frames (a 23.976 fps clip starting at 0.041 s): `fps` then snaps
 * the shifted mask onto the next frame, so every frame met the mask before
 * its own and frame 0 met none at all. The picture's own start comes back on
 * the output (`restoreStart`), so it stays where it was against the sound.
 */
const ZERO_CLOCK = "setpts=PTS-STARTPTS"

/**
 * The followed video on the same clock and frame grid as the mask: `fps` puts
 * its frames exactly on the grid the mask's `fps` makes, whatever its own
 * timescale (a 1/90000 or 1/600 file lands a hair before each grid point
 * otherwise, and meets the mask frame before its own).
 */
const leadingClock = (startSec: number, rate: string | undefined): string =>
  `${startSec > 0 ? `${ZERO_CLOCK},` : ""}${rate ? `fps=${rate},` : ""}`

/**
 * Put the rendered picture back at the followed video's own start (nothing
 * for a picture starting at 0). Rounded to whole ticks of the output's
 * timebase: after `fps` a tick is a frame, and setpts would truncate a
 * 0.98-tick offset to nothing.
 */
const restoreStart = (startSec: number): string => (startSec > 0 ? `,setpts=PTS+round(${startSec.toFixed(6)}/TB)` : "")

/**
 * The mask chain: start the mask's clock at 0 (see `ZERO_CLOCK`), stretch it
 * to the frame, normalise its range, then invert / grow / feather.
 */
function maskChain(s: MaskCompositeSettings, w: number, h: number, rate: string | undefined): string {
  const parts = [
    ZERO_CLOCK,
    `scale=${w}:${h}`,
    "setsar=1",
    "format=gray",
    `lut=c0='clip((val-${MASK_BLACK})*255/${MASK_WHITE - MASK_BLACK},0,255)'`,
  ]
  if (s.invertMask) parts.push("negate")
  // dilation / erosion are 3×3 max / min: one pass moves the edge one pixel.
  const morph = s.grow > 0 ? "dilation" : "erosion"
  for (let i = 0; i < Math.abs(s.grow); i++) parts.push(morph)
  if (s.feather > 0) parts.push(`gblur=sigma=${(s.feather / 2).toFixed(2)}`)
  // Opacity scales the finished mask (after invert / grow / feather), so the
  // overlay blends opacity × foreground + (1 − opacity) × background inside it.
  // At 1 nothing is added: the default graph is unchanged.
  if (s.opacity < 1) parts.push(`lut=c0='val*${opacityFactor(s.opacity)}'`)
  if (rate) parts.push(`fps=${rate}`)
  // Hold the last mask frame past its end so a short mask never ends the render.
  parts.push("tpad=stop_mode=clone:stop=-1")
  return parts.join(",")
}

function audioArgs(source: MaskCompositeAudioSource, probe: MaskCompositeProbe): { filter?: string; map: string[] } {
  const fg = probe.foregroundHasAudio
  const bg = probe.backgroundHasAudio
  const pick = source === "mix" ? (fg && bg ? "mix" : fg ? "foreground" : bg ? "background" : "none") : source
  if (pick === "foreground" && fg) return { map: ["-map", "0:a:0"] }
  if (pick === "background" && bg) return { map: ["-map", "1:a:0"] }
  if (pick === "mix") {
    return {
      // Default normalize: each track at half level, so two loud tracks cannot clip.
      filter: "[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0[aout]",
      map: ["-map", "[aout]"],
    }
  }
  return { map: [] }
}

/**
 * The ffmpeg argv for one composite. Inputs: 0 = foreground, 1 = background
 * (looped), 2 = mask. Pure: no I/O.
 */
export function buildMaskCompositeArgs(args: {
  readonly foregroundPath: string
  readonly backgroundPath: string
  readonly maskPath: string
  readonly outputPath: string
  readonly settings: MaskCompositeSettings
  readonly probe: MaskCompositeProbe
}): string[] {
  const { settings: s, probe } = args
  // Display size: non-square pixels are squared, so the composite is not stretched.
  const w = even(probe.width * (probe.sar && probe.sar > 0 ? probe.sar : 1))
  const h = even(probe.height)
  const startSec = probe.startSec && probe.startSec > 0 ? probe.startSec : 0
  const rate = probe.frameRate
  const fpsStep = rate ? `,fps=${rate}` : ""
  const audio = audioArgs(s.audioSource, probe)
  const graph = [
    // Every input on a clock starting at 0 (`ZERO_CLOCK`). Overlay emits one frame per background
    // frame, so the background starts with the foreground: a bare background frame never comes first.
    `[0:v]${leadingClock(startSec, rate)}scale=${w}:${h},setsar=1,format=yuva420p[fg]`,
    `[1:v]${ZERO_CLOCK},${backgroundFitFilter(s.backgroundFit, w, h)},setsar=1${fpsStep},format=yuv420p[bg]`,
    `[2:v]${maskChain(s, w, h, rate)}[m]`,
    "[fg][m]alphamerge[fga]",
    `[bg][fga]overlay=format=auto:shortest=1,format=yuv420p${restoreStart(startSec)}[vout]`,
    ...(audio.filter ? [audio.filter] : []),
  ].join(";")
  return [
    "-y",
    "-i", args.foregroundPath,
    "-stream_loop", "-1", "-i", args.backgroundPath,
    "-i", args.maskPath,
    "-filter_complex", graph,
    "-map", "[vout]",
    ...audio.map,
    // The render runs to the foreground's last frame, whatever the other inputs do. The overlay
    // follows the (looped) background, so it can emit one frame past the foreground's end, which
    // `-t`'s rounding alone may keep: the frame count bounds it exactly.
    ...(probe.frameCount ? ["-frames:v", String(probe.frameCount)] : []),
    "-t", (startSec + probe.durationSec).toFixed(3),
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(audio.map.length > 0 ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart",
    args.outputPath,
  ]
}

/**
 * The effect a pixelate / blur fill applies to its copy of the background.
 * Both sizes are relative to the frame's WIDTH (`w`, the rendered frame), so
 * a setting looks the same at any resolution.
 *
 * - Pixelate: blocks of max(2, round(w × pixelSizePct / 100)) px (1.25 % → 16
 *   px on a 1280-wide frame). Area-average down to one pixel per block (the
 *   block counts as integers, at least one each way), then back up with
 *   nearest-neighbour, so every block is one flat colour.
 * - Blur: a gaussian with sigma = w × blurStrengthPct / 100 px (2 % → 25.6 px
 *   on a 1280-wide frame, 0.1 % → 1.28, 5 % → 64).
 */
export function maskCompositePixelBlockPx(s: Pick<MaskCompositeSettings, "pixelSizePct">, w: number): number {
  return Math.max(2, Math.round((w * s.pixelSizePct) / 100))
}

export function maskCompositeBlurSigma(s: Pick<MaskCompositeSettings, "blurStrengthPct">, w: number): number {
  return (w * s.blurStrengthPct) / 100
}

export function maskCompositeFillEffect(s: MaskCompositeSettings, w: number, h: number): string {
  if (s.fill === "pixelate") {
    const block = maskCompositePixelBlockPx(s, w)
    const bw = Math.max(1, Math.round(w / block))
    const bh = Math.max(1, Math.round(h / block))
    return `scale=${bw}:${bh}:flags=area,scale=${w}:${h}:flags=neighbor`
  }
  return `gblur=sigma=${maskCompositeBlurSigma(s, w).toFixed(2)}`
}

/**
 * The ffmpeg argv for a pixelate / blur composite. Inputs: 0 = background
 * (the video the render follows, NOT looped), 1 = mask. The background is
 * split: one copy is the frame, the other is pixelated / blurred and laid
 * over it through the same mask chain as the video fill (invert / grow /
 * feather / opacity), so inside the mask the result is
 * opacity × effect + (1 − opacity) × background. Pure: no I/O.
 */
export function buildMaskCompositeFillArgs(args: {
  readonly backgroundPath: string
  readonly maskPath: string
  readonly outputPath: string
  readonly settings: MaskCompositeSettings
  /** The BACKGROUND's probe (its foreground* audio flag is unused). */
  readonly probe: MaskCompositeProbe
}): string[] {
  const { settings: s, probe } = args
  const w = even(probe.width * (probe.sar && probe.sar > 0 ? probe.sar : 1))
  const h = even(probe.height)
  const startSec = probe.startSec && probe.startSec > 0 ? probe.startSec : 0
  const rate = probe.frameRate
  // The only sound there is: always the background's (audioSource is ignored for these fills).
  const withAudio = maskCompositeEffectiveAudioSource(s) !== "none" && probe.backgroundHasAudio
  const graph = [
    // Like the video fill: every input on a clock starting at 0 (`ZERO_CLOCK`), the start restored on the output.
    `[0:v]${leadingClock(startSec, rate)}scale=${w}:${h},setsar=1,format=yuv420p,split=2[bg][src]`,
    `[src]${maskCompositeFillEffect(s, w, h)},format=yuva420p[fx]`,
    `[1:v]${maskChain(s, w, h, rate)}[m]`,
    "[fx][m]alphamerge[fxa]",
    `[bg][fxa]overlay=format=auto:shortest=1,format=yuv420p${restoreStart(startSec)}[vout]`,
  ].join(";")
  return [
    "-y",
    "-i", args.backgroundPath,
    "-i", args.maskPath,
    "-filter_complex", graph,
    "-map", "[vout]",
    ...(withAudio ? ["-map", "0:a:0"] : []),
    // The render runs to the background's last frame, whatever the mask does.
    "-t", (startSec + probe.durationSec).toFixed(3),
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(withAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart",
    args.outputPath,
  ]
}

export interface MaskCompositeParams {
  /** Required by the video fill; unused (never downloaded) by pixelate / blur. */
  readonly foregroundUrl?: string
  readonly backgroundUrl: string
  readonly maskUrl: string
  readonly settings: MaskCompositeSettings
}

export interface MaskCompositeResult {
  /** The rendered file. The caller uploads it; its work dir is the file's directory. */
  readonly outputPath: string
  readonly width: number
  readonly height: number
  readonly durationSec: number
}

/** Kill budget: the default plus 4 s per second of output (a 4K, 5-minute composite stays inside it). */
export function maskCompositeTimeoutMs(durationSec: number): number {
  return DEFAULT_FFMPEG_TIMEOUT_MS + Math.ceil(durationSec) * 4_000
}

export async function maskComposite(params: MaskCompositeParams): Promise<MaskCompositeResult> {
  if (!maskCompositeUsesForeground(params.settings.fill)) return maskCompositeFill(params)
  if (!params.foregroundUrl) throw new DeterministicJobError("Mask Composite needs a foreground video when the fill is Video.")
  const foregroundUrl = params.foregroundUrl
  const workDir = await createWorkDir("mask-composite")
  try {
    const foregroundPath = join(workDir, "foreground.mp4")
    const backgroundPath = join(workDir, "background.mp4")
    const maskPath = join(workDir, "mask.mp4")
    const outputPath = join(workDir, "output.mp4")
    await Promise.all([
      downloadFile(foregroundUrl, foregroundPath),
      downloadFile(params.backgroundUrl, backgroundPath),
      downloadFile(params.maskUrl, maskPath),
    ])
    const [fg, foregroundHasAudio, backgroundHasAudio] = await Promise.all([
      probeVideoOverlayBase(foregroundPath),
      hasAudioStream(foregroundPath),
      hasAudioStream(backgroundPath),
    ])
    if (fg.streamDurationSec > MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC) {
      throw new DeterministicJobError(
        `The foreground is ${Math.ceil(fg.streamDurationSec)} seconds; Mask Composite takes at most ${MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC}.`,
      )
    }
    const probe: MaskCompositeProbe = {
      width: fg.width,
      height: fg.height,
      frameRate: fg.avgFrameRate && fg.avgFrameRate !== "0/0" ? fg.avgFrameRate : fg.rFrameRate,
      durationSec: fg.streamDurationSec,
      startSec: fg.startTimeSec,
      ...(fg.frameCount ? { frameCount: fg.frameCount } : {}),
      sar: fg.sar,
      foregroundHasAudio,
      backgroundHasAudio,
    }
    const argv = buildMaskCompositeArgs({ foregroundPath, backgroundPath, maskPath, outputPath, settings: params.settings, probe })
    // Three decoded pictures at the foreground's size feed one encode.
    const canvas = { width: even(fg.width * (fg.sar > 0 ? fg.sar : 1)), height: even(fg.height) }
    await runFfmpeg(argv, maskCompositeTimeoutMs(fg.streamDurationSec), {
      // Three input files; only the foreground's size is probed, so the largest
      // camera is left unknown (charged as 4K — conservative).
      peakMemoryMiB: canvasPeakMemoryMiB(canvas, 3, ffmpegEffectiveThreads(), { inputs: 3, cameraMegapixels: undefined }),
    })
    return { outputPath, width: canvas.width, height: canvas.height, durationSec: fg.streamDurationSec }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}

/** Pixelate / blur: the background, partly pixelated or blurred through the mask. No foreground is downloaded. */
async function maskCompositeFill(params: MaskCompositeParams): Promise<MaskCompositeResult> {
  const workDir = await createWorkDir("mask-composite")
  try {
    const backgroundPath = join(workDir, "background.mp4")
    const maskPath = join(workDir, "mask.mp4")
    const outputPath = join(workDir, "output.mp4")
    await Promise.all([downloadFile(params.backgroundUrl, backgroundPath), downloadFile(params.maskUrl, maskPath)])
    const [bg, backgroundHasAudio] = await Promise.all([probeVideoOverlayBase(backgroundPath), hasAudioStream(backgroundPath)])
    if (bg.streamDurationSec > MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC) {
      throw new DeterministicJobError(
        `The background is ${Math.ceil(bg.streamDurationSec)} seconds; Mask Composite takes at most ${MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC}.`,
      )
    }
    const probe: MaskCompositeProbe = {
      width: bg.width,
      height: bg.height,
      frameRate: bg.avgFrameRate && bg.avgFrameRate !== "0/0" ? bg.avgFrameRate : bg.rFrameRate,
      durationSec: bg.streamDurationSec,
      startSec: bg.startTimeSec,
      sar: bg.sar,
      foregroundHasAudio: false,
      backgroundHasAudio,
    }
    const argv = buildMaskCompositeFillArgs({ backgroundPath, maskPath, outputPath, settings: params.settings, probe })
    const canvas = { width: even(bg.width * (bg.sar > 0 ? bg.sar : 1)), height: even(bg.height) }
    await runFfmpeg(argv, maskCompositeTimeoutMs(bg.streamDurationSec), {
      // Two input files, three pictures at the background's size (the frame, its filtered copy, the mask).
      peakMemoryMiB: canvasPeakMemoryMiB(canvas, 3, ffmpegEffectiveThreads(), { inputs: 2, cameraMegapixels: undefined }),
    })
    return { outputPath, width: canvas.width, height: canvas.height, durationSec: bg.streamDurationSec }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
