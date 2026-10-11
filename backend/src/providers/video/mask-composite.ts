/**
 * Mask Composite — a foreground video over a background video through a mask
 * video (white = foreground, black = background). Local ffmpeg, no provider:
 * runs with zero API keys in every edition.
 *
 * The render follows the FOREGROUND (size, frame rate, length). The background
 * is fitted to that frame and loops when shorter; the mask is stretched to the
 * frame and holds its last frame when shorter. The settings come from
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
  type MaskCompositeAudioSource,
  type MaskCompositeBackgroundFit,
  type MaskCompositeSettings,
} from "@nodaro/shared"
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
  /** Foreground DISPLAY size (rotation applied), any parity. */
  readonly width: number
  readonly height: number
  /** Foreground frame rate as an ffmpeg rational ("30000/1001"), or undefined when it has none. */
  readonly frameRate?: string
  /** Foreground picture length, seconds. */
  readonly durationSec: number
  /** Where the foreground's picture starts on its own clock, seconds (0 for most files). */
  readonly startSec?: number
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
 * The mask chain: put the mask on the foreground's clock, stretch it to the
 * frame, normalise its range, then invert / grow / feather. A mask's frame N
 * belongs to the foreground's frame N (Video Mask draws one per decoded
 * frame, starting at 0), so its timestamps restart at the foreground's own
 * picture start — ffmpeg pairs frames by timestamp, and a foreground whose
 * picture starts at 0.1 s would otherwise meet the mask 0.1 s early.
 */
function maskChain(s: MaskCompositeSettings, w: number, h: number, rate: string | undefined, startSec: number): string {
  const parts = [
    `setpts=PTS-STARTPTS${startSec > 0 ? `+${startSec.toFixed(6)}/TB` : ""}`,
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
    `[0:v]scale=${w}:${h},setsar=1,format=yuva420p[fg]`,
    `[1:v]setpts=PTS-STARTPTS,${backgroundFitFilter(s.backgroundFit, w, h)},setsar=1${fpsStep},format=yuv420p[bg]`,
    `[2:v]${maskChain(s, w, h, rate, startSec)}[m]`,
    "[fg][m]alphamerge[fga]",
    "[bg][fga]overlay=format=auto:shortest=1,format=yuv420p[vout]",
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
    // The render runs to the foreground's last frame, whatever the other inputs do.
    "-t", (startSec + probe.durationSec).toFixed(3),
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(audio.map.length > 0 ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart",
    args.outputPath,
  ]
}

export interface MaskCompositeParams {
  readonly foregroundUrl: string
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
  const workDir = await createWorkDir("mask-composite")
  try {
    const foregroundPath = join(workDir, "foreground.mp4")
    const backgroundPath = join(workDir, "background.mp4")
    const maskPath = join(workDir, "mask.mp4")
    const outputPath = join(workDir, "output.mp4")
    await Promise.all([
      downloadFile(params.foregroundUrl, foregroundPath),
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
      sar: fg.sar,
      foregroundHasAudio,
      backgroundHasAudio,
    }
    const argv = buildMaskCompositeArgs({ foregroundPath, backgroundPath, maskPath, outputPath, settings: params.settings, probe })
    // Three decoded pictures at the foreground's size feed one encode.
    const canvas = { width: even(fg.width * (fg.sar > 0 ? fg.sar : 1)), height: even(fg.height) }
    await runFfmpeg(argv, maskCompositeTimeoutMs(fg.streamDurationSec), {
      peakMemoryMiB: canvasPeakMemoryMiB(canvas, 3, ffmpegEffectiveThreads()),
    })
    return { outputPath, width: canvas.width, height: canvas.height, durationSec: fg.streamDurationSec }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
