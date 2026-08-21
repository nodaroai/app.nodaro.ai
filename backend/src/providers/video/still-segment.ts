/**
 * Still-segment builder — the shared per-image segment math for
 * still-to-video (and the future slideshow node, which reuses this builder
 * verbatim: geometry, zoompan expressions, intensity mapping, frame math).
 *
 * Everything here is a PURE function of its inputs — no I/O, no ffprobe.
 * Callers (providers/video/still-to-video.ts) probe the media first and
 * pass real numbers in, so every branch is unit-testable as a string.
 *
 * Two zoompan failure modes are handled by construction, not by luck:
 *
 *  1. JITTER — zoompan steps its crop window in integer pixels; at output
 *     resolution the per-frame step rounds to 0-or-1px and visibly stutters.
 *     The still is upscaled BEFORE zoompan so each step lands on a subpixel
 *     of the final frame. The factor is ADAPTIVE, not a fixed 8x: at 4K a
 *     fixed 8x would mean a ~30720x17280 intermediate (an OOM, not an
 *     effect). `computeUpscaleFactor` caps the intermediate's long edge at
 *     ~12k, trading headroom for survival as the target grows (720p→8x,
 *     1080p→6x, 4K→3x). The source is also cropped to the target aspect at
 *     SOURCE resolution first, so a panorama can't balloon the intermediate
 *     sideways before the crop.
 *
 *  2. `d` IS IN FRAMES, NOT SECONDS — zoompan doesn't know the audio
 *     length. The caller resolves the audio duration via ffprobe and passes
 *     `frames = ceil(duration * fps)`; `-shortest` then trims the (always
 *     ≥ audio-length) video to the audio exactly.
 */

/** Motion presets applied to the still. Wire-contract values (route Zod + node data). */
export const STILL_MOTIONS = [
  "none",
  "zoom-in",
  "zoom-out",
  "pan-left",
  "pan-right",
  "ken-burns",
] as const
export type StillMotion = (typeof STILL_MOTIONS)[number]

export const STILL_RESOLUTIONS = ["720p", "1080p", "4K"] as const
export type StillResolution = (typeof STILL_RESOLUTIONS)[number]

export const STILL_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"] as const
export type StillAspectRatio = (typeof STILL_ASPECT_RATIOS)[number]

export const STILL_FPS_OPTIONS = [24, 30] as const
export type StillFps = (typeof STILL_FPS_OPTIONS)[number]

export const STILL_FITS = ["cover", "contain"] as const
export type StillFit = (typeof STILL_FITS)[number]

/**
 * Short-edge convention (matches the repo's 1080-class
 * ASPECT_RATIO_DIMENSIONS, which has no 4:3 or resolution tiers — hence this
 * local matrix): the resolution names the SHORT side, the long side follows
 * the aspect. All values even (yuv420p requirement).
 */
const SHORT_EDGE: Record<StillResolution, number> = {
  "720p": 720,
  "1080p": 1080,
  "4K": 2160,
}

const ASPECT_FRACTION: Record<StillAspectRatio, { w: number; h: number }> = {
  "16:9": { w: 16, h: 9 },
  "9:16": { w: 9, h: 16 },
  "1:1": { w: 1, h: 1 },
  "4:3": { w: 4, h: 3 },
}

export function computeTargetDimensions(
  resolution: StillResolution,
  aspectRatio: StillAspectRatio,
): { width: number; height: number } {
  // Default unknowns - the workflow-run path is not route-Zod-guarded, so a
  // malformed workflow renders at 1080p 16:9 rather than emitting NaN dims.
  const short = SHORT_EDGE[resolution] ?? SHORT_EDGE["1080p"]
  const { w, h } = ASPECT_FRACTION[aspectRatio] ?? ASPECT_FRACTION["16:9"]
  // Landscape (w≥h): height is the short edge. Portrait: width is.
  if (w >= h) {
    return { width: evenFloor((short * w) / h), height: short }
  }
  return { width: short, height: evenFloor((short * h) / w) }
}

/** zoompan's `d` is in FRAMES. Ceil so -shortest trims to the audio, never under-runs it. */
export function computeFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`still-segment: invalid audio duration ${durationSeconds}`)
  }
  return Math.ceil(durationSeconds * fps)
}

const MIN_ZOOM_RATE = 0.0002 // intensity 1
const MAX_ZOOM_RATE = 0.0015 // intensity 10
const MAX_ZOOM = 1.5
/** Fixed zoom for pan-* — the margin the window travels across (intensity drives speed, not margin). */
const PAN_ZOOM = 1.25

/** Linear 1–10 → per-frame zoom rate (clamped to the scale — route Zod already guards it). */
export function intensityToZoomRate(intensity: number): number {
  const i = Math.min(10, Math.max(1, intensity))
  return MIN_ZOOM_RATE + ((i - 1) * (MAX_ZOOM_RATE - MIN_ZOOM_RATE)) / 9
}

/** Longest edge the pre-zoompan intermediate may reach. ~12k keeps peak filter
 *  memory in the hundreds of MB instead of GB while preserving subpixel
 *  headroom for zoompan's integer stepping. */
const MAX_UPSCALED_EDGE = 12288

export function computeUpscaleFactor(width: number, height: number): number {
  const factor = Math.floor(MAX_UPSCALED_EDGE / Math.max(width, height))
  return Math.min(8, Math.max(2, factor))
}

/** Format the per-frame rate with fixed precision so filter strings are stable/testable. */
function formatRate(rate: number): string {
  return rate.toFixed(7)
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * `#RRGGBB` -> ffmpeg's `0xRRGGBB` color literal.
 *
 * SECURITY - this value lands verbatim in the `color=` option of a `pad`
 * filter inside `-vf`. On the workflow-run path (MCP write / import /
 * template) padColor is NOT route-Zod-validated (pitfall 5b: the route enum
 * is not an invariant), so a crafted value containing a filtergraph
 * delimiter (`,` `:` `[`) could inject an extra filter - e.g.
 * `black,drawtext=textfile=/etc/passwd:...`, a local-file read rendered into
 * the output. Accept only a strict #RRGGBB hex; anything else -> black. This
 * is the single choke point (both pad sites + the future slideshow reuse),
 * so validation can't be bypassed by a path that skips the route.
 */
function padHexToFfmpeg(padColor: string): string {
  return HEX_COLOR_RE.test(padColor) ? padColor.replace("#", "0x") : "0x000000"
}

const evenFloor = (n: number): number => 2 * Math.floor(n / 2)

export interface StillFilterGraphOptions {
  readonly motion: StillMotion
  readonly intensity: number
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frames: number
  readonly fit: StillFit
  readonly padColor: string
  /** Probed source image dimensions — needed to crop-at-source-resolution
   *  (cover) and to compute the contained box (contain). */
  readonly sourceWidth: number
  readonly sourceHeight: number
}

/**
 * Build the -vf filter graph for one still segment.
 *
 * motion none  → plain scale (+crop | +pad), no zoompan, cheap.
 * any motion   → crop-to-aspect at source res → lanczos upscale to k×box →
 *                zoompan (d=frames, s=box, fps) [→ static pad when contain].
 */
export function buildStillFilterGraph(opts: StillFilterGraphOptions): string {
  const { motion, width, height, fit, padColor } = opts

  if (motion === "none") {
    if (fit === "cover") {
      return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    }
    return (
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${padHexToFfmpeg(padColor)}`
    )
  }

  // Motion path. The moving window renders on a "box": the full target for
  // cover; the contained (letterbox-inner) rectangle for contain — so the
  // pad bars stay static while the still moves inside them.
  const box = fit === "cover" ? { width, height } : containedBox(opts)
  const k = computeUpscaleFactor(width, height)

  // 1. Crop the SOURCE to the box aspect at source resolution (bounded
  //    memory for any source shape), auto-centered.
  const cropW = evenFloor(Math.min(opts.sourceWidth, (opts.sourceHeight * box.width) / box.height))
  const cropH = evenFloor(Math.min(opts.sourceHeight, (opts.sourceWidth * box.height) / box.width))

  // 2. Lanczos to exactly k×box — zoompan then steps on subpixels of the box.
  const stages = [
    `crop=${cropW}:${cropH}`,
    `scale=${k * box.width}:${k * box.height}:flags=lanczos`,
    `zoompan=${zoompanExpressions(opts)}:d=${opts.frames}:s=${box.width}x${box.height}:fps=${opts.fps}`,
  ]

  if (fit === "contain") {
    stages.push(
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${padHexToFfmpeg(padColor)}`,
    )
  }

  return stages.join(",")
}

/** The rectangle the source occupies inside the target when fit=contain (even-floored). */
function containedBox(opts: StillFilterGraphOptions): { width: number; height: number } {
  const { width, height, sourceWidth, sourceHeight } = opts
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  return {
    width: evenFloor(sourceWidth * scale),
    height: evenFloor(sourceHeight * scale),
  }
}

/** z/x/y expressions per motion. No spaces — ffmpeg expression parsing safety. */
function zoompanExpressions(opts: StillFilterGraphOptions): string {
  const rate = formatRate(intensityToZoomRate(opts.intensity))
  const centeredX = `x='iw/2-(iw/zoom/2)'`
  const centeredY = `y='ih/2-(ih/zoom/2)'`

  switch (opts.motion) {
    case "zoom-in":
      return `z='min(zoom+${rate},${MAX_ZOOM})':${centeredX}:${centeredY}`
    case "zoom-out":
      // zoompan's zoom starts at 1 — seed 1.5 on the first frame, then decay.
      return `z='if(eq(on,1),${MAX_ZOOM},max(zoom-${rate},1))':${centeredX}:${centeredY}`
    case "pan-left":
      // Fixed margin (PAN_ZOOM); the intensity rate drives x per frame.
      // Travel clamps at the frame edge if the clip outlasts the margin.
      return `z='${PAN_ZOOM}':x='max(0,iw-iw/zoom-on*${rate}*iw)':${centeredY}`
    case "pan-right":
      return `z='${PAN_ZOOM}':x='min(iw-iw/zoom,on*${rate}*iw)':${centeredY}`
    case "ken-burns":
      // Slow zoom + diagonal drift across the (growing) margin, normalized
      // by the total frame count so the drift completes with the clip.
      return (
        `z='min(zoom+${rate},${MAX_ZOOM})':` +
        `x='(iw-iw/zoom)*(0.5+0.3*on/${opts.frames})':` +
        `y='(ih-ih/zoom)*(0.5-0.2*on/${opts.frames})'`
      )
    case "none":
      throw new Error("still-segment: zoompanExpressions called for motion=none")
  }
}

export interface SilentSegmentArgsOptions extends StillFilterGraphOptions {
  readonly imagePath: string
  readonly outputPath: string
}

/**
 * ffmpeg argv for ONE SILENT slideshow segment: exactly `frames` output
 * frames, no audio stream (`-an` — the audio is muxed once over the finished
 * concat, and the no-audio case must yield a truly silent file). `setsar=1`
 * normalizes the sample aspect ratio — mismatched SAR is the classic cause of
 * a silently corrupt concat, and every segment must be identical in
 * resolution / fps / pix_fmt / SAR before joining.
 */
export function buildSilentSegmentArgs(opts: SilentSegmentArgsOptions): string[] {
  const graph = buildStillFilterGraph(opts) + ",setsar=1"
  const inputArgs =
    opts.motion === "none"
      ? ["-loop", "1", "-i", opts.imagePath]
      : ["-i", opts.imagePath]

  return [
    "-y",
    ...inputArgs,
    "-vf", graph,
    "-frames:v", String(opts.frames),
    "-an",
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-r", String(opts.fps),
    opts.outputPath,
  ]
}

export interface StillToVideoArgsOptions extends StillFilterGraphOptions {
  readonly imagePath: string
  readonly audioPath: string
  readonly outputPath: string
}

/**
 * Full ffmpeg argv for one still + audio → MP4.
 *
 * motion none: `-loop 1` repeats the single frame; `-shortest` ends at the
 * audio. Motion paths feed zoompan ONE input frame (no -loop — a looped
 * input would restart the effect every d frames) and zoompan's `d` emits
 * `frames` output frames; `-shortest` still trims the ceil'd tail.
 */
export function buildStillToVideoArgs(opts: StillToVideoArgsOptions): string[] {
  const graph = buildStillFilterGraph(opts)
  const inputArgs =
    opts.motion === "none"
      ? ["-loop", "1", "-i", opts.imagePath, "-i", opts.audioPath]
      : ["-i", opts.imagePath, "-i", opts.audioPath]

  return [
    "-y",
    ...inputArgs,
    "-vf", graph,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "192k",
    "-pix_fmt", "yuv420p",
    "-r", String(opts.fps),
    "-movflags", "+faststart",
    "-shortest",
    opts.outputPath,
  ]
}
