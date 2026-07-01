/**
 * Image Collage provider — composites N images into ONE large (2K/4K) image
 * using ffmpeg, arranged by the smart/grid layout in `collage-layout.ts`.
 *
 * Pipeline: download every input → probe its natural dimensions → compute the
 * pixel layout (pure JS) → build a single ffmpeg `-filter_complex` that scales
 * + cover-crops each image into its rect and overlays it onto a colored canvas
 * → render one PNG frame. The layout math is engine-agnostic and unit-tested;
 * ffmpeg here only places pre-computed rectangles.
 */

import { join } from "node:path"
import {
  createWorkDir,
  downloadFile,
  runFfmpeg,
  runFfprobe,
} from "../video/ffmpeg-utils.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { computeCollageLayout, type ImageDim, type CollageLayoutMode } from "./collage-layout.js"

/** Concurrent input downloads. Bounded so a 30-image collage doesn't open 30
 *  sockets at once, while still overlapping the dominant network latency. */
const DOWNLOAD_CONCURRENCY = 6

export type CollageResolution = "2K" | "4K"

export interface ImageCollageParams {
  readonly imageUrls: readonly string[]
  readonly layout?: CollageLayoutMode
  readonly resolution?: CollageResolution
  /** "W:H" — one of the COMPOSITION_RATIOS ("1:1", "16:9", "9:16", "4:5"). */
  readonly aspectRatio?: string
  /** Gap between cells (and outer margin), in px on the OUTPUT canvas. */
  readonly gap?: number
  /** Background shown in the gaps, "#RRGGBB". */
  readonly backgroundColor?: string
}

/** Long edge (px) per resolution. Canvas W/H are derived from the aspect. */
const LONG_EDGE: Record<CollageResolution, number> = {
  "2K": 2560,
  "4K": 3840,
}

/** Resolve the output canvas W×H from the resolution (long edge) + aspect. */
export function resolveCollageCanvas(
  resolution: CollageResolution,
  aspectRatio: string,
): { w: number; h: number } {
  const longEdge = LONG_EDGE[resolution] ?? LONG_EDGE["2K"]
  const [awRaw, ahRaw] = aspectRatio.split(":")
  const aw = Number(awRaw) > 0 ? Number(awRaw) : 1
  const ah = Number(ahRaw) > 0 ? Number(ahRaw) : 1
  let w: number
  let h: number
  if (aw >= ah) {
    w = longEdge
    h = Math.round((longEdge * ah) / aw)
  } else {
    h = longEdge
    w = Math.round((longEdge * aw) / ah)
  }
  // Even dimensions keep every downstream encoder happy (yuv420p, thumbnailer).
  w -= w % 2
  h -= h % 2
  return { w, h }
}

/** Normalise a user hex ("#ffffff" / "ffffff") into ffmpeg's `0xRRGGBB`. */
function toFfmpegColor(input: string | undefined): string {
  const raw = (input ?? "").trim().replace(/^#/, "")
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `0x${raw.toLowerCase()}`
  return "white"
}

/** Probe a local image file for its pixel dimensions (no network — SSRF-safe). */
async function probeImageSize(filePath: string): Promise<ImageDim> {
  try {
    const out = await runFfprobe([
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      filePath,
    ])
    const [w, h] = out.trim().split(",").map((s) => parseInt(s.trim(), 10))
    if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) return { w: 1, h: 1 }
    return { w, h }
  } catch {
    // A corrupt/undecodable input shouldn't abort the whole collage — treat it
    // as square; ffmpeg's own decode will surface a hard error later if truly bad.
    return { w: 1, h: 1 }
  }
}

/**
 * Build the ffmpeg argument list for a collage. Exported (pure, no I/O) so the
 * filtergraph can be asserted in tests without spawning ffmpeg.
 */
export function buildCollageFfmpegArgs(opts: {
  readonly localPaths: readonly string[]
  readonly rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>
  readonly canvasW: number
  readonly canvasH: number
  readonly bgColor: string
  readonly outputPath: string
}): string[] {
  const { localPaths, rects, canvasW, canvasH, bgColor, outputPath } = opts
  const args: string[] = ["-y"]
  // Input 0: the solid background canvas (single frame).
  args.push("-f", "lavfi", "-i", `color=c=${bgColor}:s=${canvasW}x${canvasH}:d=1`)
  for (const p of localPaths) args.push("-i", p)

  const filters: string[] = []
  // Scale each image to COVER its rect (increase + centre-crop), no distortion.
  rects.forEach((rect, i) => {
    const inputIdx = i + 1 // input 0 is the canvas
    filters.push(
      `[${inputIdx}:v]scale=${rect.w}:${rect.h}:force_original_aspect_ratio=increase,` +
        `crop=${rect.w}:${rect.h},setsar=1[s${i}]`,
    )
  })
  // Overlay chain: canvas ← s0 ← s1 ← … ← s(n-1).
  let prev = "[0:v]"
  rects.forEach((rect, i) => {
    const out = i === rects.length - 1 ? "[out]" : `[t${i}]`
    filters.push(`${prev}[s${i}]overlay=${rect.x}:${rect.y}${out}`)
    prev = out
  })

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-frames:v", "1",
    outputPath,
  )
  return args
}

/**
 * Render the collage. Returns the local PNG path (caller uploads to R2 and
 * cleans up the work dir).
 */
export async function createImageCollage(params: ImageCollageParams): Promise<string> {
  const imageUrls = params.imageUrls ?? []
  if (imageUrls.length < 2) {
    throw new Error("Image Collage needs at least 2 images")
  }

  const layout: CollageLayoutMode = params.layout === "grid" ? "grid" : "smart"
  const resolution: CollageResolution = params.resolution === "4K" ? "4K" : "2K"
  const aspectRatio = params.aspectRatio ?? "1:1"
  const gap = Math.max(0, Math.min(200, Math.floor(params.gap ?? 24)))
  const bgColor = toFfmpegColor(params.backgroundColor)

  const { w: canvasW, h: canvasH } = resolveCollageCanvas(resolution, aspectRatio)

  const workDir = await createWorkDir("image-collage")
  const outputPath = join(workDir, "collage.png")

  // Download every input concurrently (bounded — SSRF-guarded via downloadFile).
  // settledWithLimit writes results by index, so localPaths keeps wire order
  // (the layout depends on it). Fail fast on the first bad URL.
  const downloaded = await settledWithLimit(
    imageUrls.map((url, i) => async () => {
      const dest = join(workDir, `img-${i}`)
      await downloadFile(url, dest)
      return dest
    }),
    DOWNLOAD_CONCURRENCY,
    { cancelled: false },
  )
  const localPaths: string[] = []
  for (const r of downloaded) {
    if (r.status === "rejected") {
      throw r.reason instanceof Error ? r.reason : new Error(String(r.reason))
    }
    localPaths.push(r.value)
  }

  // Probe dimensions concurrently (ffprobe on local files — cheap, not gated by
  // the ffmpeg semaphore), then compute the layout.
  const dims = await Promise.all(localPaths.map(probeImageSize))
  const rects = computeCollageLayout(dims, canvasW, canvasH, { mode: layout, gap })

  const args = buildCollageFfmpegArgs({ localPaths, rects, canvasW, canvasH, bgColor, outputPath })
  await runFfmpeg(args)

  return outputPath
}
