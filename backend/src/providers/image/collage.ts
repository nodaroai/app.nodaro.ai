/**
 * Image Collage provider — composites N images into ONE large (2K/4K) image
 * using ffmpeg, arranged by the smart/grid layout in `collage-layout.ts`.
 *
 * Pipeline: download every input → probe the dimensions the DECODER will
 * produce (see `probeImageSize`) → compute the pixel layout (pure JS) → build a
 * single ffmpeg `-filter_complex` that fits each image INSIDE its rect,
 * centred, and overlays it onto a colored canvas → render one PNG frame. The
 * layout math is engine-agnostic and unit-tested; ffmpeg here only places
 * pre-computed rectangles.
 *
 * "Fits inside", not "cover-crops": the filter is
 * `force_original_aspect_ratio=decrease`, so a rect wider than its image leaves
 * canvas showing rather than cropping to fill. This doc claimed the opposite
 * for a long time and misled a downstream design into drawing its preview with
 * `object-fit: cover`. The smart layout gives each cell its image's own aspect,
 * which is what normally makes the distinction invisible — and is exactly why
 * `probeImageSize` returning the wrong aspect is so visible.
 */

import { join } from "node:path"
import sharp from "sharp"
import {
  createWorkDir,
  downloadFile,
  runFfmpeg,
  runFfprobe,
  withFfmpegSlot,
} from "../video/ffmpeg-utils.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { computeCollageLayout, type ImageDim, type CollageLayoutMode } from "./collage-layout.js"
import {
  collageBadgeTexts,
  buildCollageBadgesSvg,
  resolveBadgePosition,
  type CollageBadgePosition,
} from "./collage-badges.js"

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
  /** Per-image size hints, index-aligned with `imageUrls`: 0 = auto ("don't
   *  care"), 1 = big, 2 = medium, 3 = small. Relative — smart layout only
   *  (grid cells are uniform by design). Missing/invalid entries are auto. */
  readonly imageSizes?: readonly number[]
  /** Storyboard mode: stamp a 1-based sequence number at each image's top-right,
   *  in `imageUrls` order. Absent/false → no numbers (and, with no labels, the
   *  untouched ffmpeg PNG is returned unchanged — no sharp re-encode). */
  readonly numbered?: boolean
  /** Per-image captions, index-aligned with `imageUrls`, shown after the number
   *  (or alone). `null`/""/whitespace = none; a short array pads with none and
   *  extras are ignored (same tolerance as `imageSizes`). */
  readonly imageLabels?: readonly (string | null)[]
  /** Corner each badge sits in. Default "top-left" (storyboard convention);
   *  anything but "top-right" resolves to it. */
  readonly badgePosition?: CollageBadgePosition
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

/**
 * The same normalisation as {@link toFfmpegColor}, in the form a browser can
 * paint with. Deliberately beside it, sharing the identical validity rule and
 * the identical fallback: a preview that paints a different background than the
 * render is a wrong preview, and that divergence would be invisible until
 * someone looked at a gap.
 */
export function toCssColor(input: string | undefined): string {
  const raw = (input ?? "").trim().replace(/^#/, "")
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : "#ffffff"
}

/**
 * Stored dimensions + an EXIF orientation tag → the dimensions as DISPLAYED.
 *
 * Tags 5-8 are the quarter-turns: they exchange the axes. 1-4 are identity,
 * mirror and 180°, none of which changes which side is longer. Anything
 * outside 1-8 (encoders do write 0) is treated as absent rather than guessed at.
 */
export function displayDims(w: number, h: number, orientation: number | undefined): ImageDim {
  return orientation !== undefined && orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h }
}

/**
 * Probe a local image file for the dimensions the COMPOSITOR will receive
 * (no network — SSRF-safe).
 *
 * DISPLAY dimensions, not stored ones, and the distinction is not academic.
 * ffmpeg auto-rotates on decode, so a JPEG carrying EXIF orientation 5-8
 * reaches `scale` transposed — while ffprobe's `stream=width,height` reports
 * the stored geometry and the rotation appears only in FRAME side data, which
 * that query never sees. Laying out from stored dimensions therefore handed
 * every phone-portrait photo a cell of the wrong aspect, and since the filter
 * fits rather than fills (see the file doc), the mismatch rendered as visible
 * padding: ~366px of white down each side of a 1317px cell, measured. The
 * layout module's "zero crop, zero letterbox" property depends entirely on this
 * function agreeing with the decoder.
 *
 * sharp reads the header only — no full decode — and reports the tag directly;
 * `lib/anthropic-image.ts` already leans on it for the same reason. ffprobe
 * stays as the fallback for anything sharp cannot open: no worse than before
 * for those, and correct for every EXIF-bearing image.
 */
export async function probeImageSize(filePath: string): Promise<ImageDim> {
  try {
    const { width, height, orientation } = await sharp(filePath).metadata()
    if (width && height) return displayDims(width, height, orientation)
  } catch {
    // Not a still image sharp can parse — fall through to ffprobe.
  }
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
  // Fit each image INSIDE its rect (scale down, never up-crop) preserving aspect.
  // In smart mode the rect already matches the image's aspect ratio, so it fills
  // the cell; in grid mode (uniform cells) it leaves a margin. We deliberately do
  // NOT use `pad` here — `scale=…:decrease` can round the fitted image 1px over
  // the cell, and `pad` then aborts with "Padded dimensions cannot be smaller
  // than input dimensions". Instead we centre the fitted image over the cell with
  // an overlay expression; the leftover area shows the canvas, which is already
  // filled with the background colour (so letterbox bars match the gaps exactly).
  rects.forEach((rect, i) => {
    const inputIdx = i + 1 // input 0 is the canvas
    filters.push(
      `[${inputIdx}:v]scale=${rect.w}:${rect.h}:force_original_aspect_ratio=decrease,setsar=1[s${i}]`,
    )
  })
  // Overlay chain: canvas ← s0 ← s1 ← … ← s(n-1). Each image is centred within
  // its cell — `w`/`h` are the fitted image's dimensions, `${rect.w/h}` the cell.
  let prev = "[0:v]"
  rects.forEach((rect, i) => {
    const out = i === rects.length - 1 ? "[out]" : `[t${i}]`
    const ox = `${rect.x}+(${rect.w}-w)/2`
    const oy = `${rect.y}+(${rect.h}-h)/2`
    filters.push(`${prev}[s${i}]overlay=x=${ox}:y=${oy}${out}`)
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

/** Fully-resolved geometry inputs. Nothing here is optional-with-a-default:
 *  see {@link resolveCollageGeometry}. */
export interface CollageGeometryParams {
  readonly dims: readonly ImageDim[]
  readonly layout: CollageLayoutMode
  readonly resolution: CollageResolution
  readonly aspectRatio: string
  readonly gap: number
  /** Index-aligned with `dims`. Padded and clamped here, once. */
  readonly imageSizes?: readonly number[]
}

/**
 * Where every image lands, and how big the canvas ends up.
 *
 * SHARED by the renderer and by the free layout route, so a client preview is
 * EXACT for the same dimensions rather than a second implementation that drifts.
 *
 * It defaults NOTHING. That is deliberate and it is the whole reason this takes
 * resolved values instead of a request object: this provider's own entry point
 * defaults 2K/1:1 while the HTTP route defaults 4K/4:3, so folding either set in
 * here would rebuild the exact divergence the sharing exists to remove. Each
 * edge resolves its own parameters and passes numbers.
 */
export function resolveCollageGeometry(params: CollageGeometryParams): {
  rects: ReturnType<typeof computeCollageLayout>["rects"]
  canvasW: number
  canvasH: number
} {
  // In smart mode the WIDTH is honoured and the target height only steers the
  // row count — the layout floats the real output height. Grid honours both.
  const { w: targetW, h: targetH } = resolveCollageCanvas(params.resolution, params.aspectRatio)
  // Size hints are index-aligned with the images. Keyed off `dims.length`
  // because that is the one length BOTH callers have — the layout route never
  // sees `imageUrls` — and because walking `dims` is what makes a MALFORMED
  // stored value degrade rather than throw: this provider is reached from a
  // worker reading a job row, not only from the validated route.
  //
  // The padding and clamping themselves are belt-and-braces, not load-bearing:
  // `collage-layout.ts` is the authority on tolerance and already reads any
  // unknown value as auto and ignores extras. Mutating either away leaves the
  // output identical, so no test here claims otherwise.
  const sizes = params.imageSizes
    ? params.dims.map((_, i) => {
        const v = params.imageSizes![i]
        return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : 0
      })
    : undefined
  return computeCollageLayout([...params.dims], targetW, targetH, {
    mode: params.layout,
    gap: params.gap,
    sizes,
  })
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
  const imageSizes = params.imageSizes

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
  // The SAME function the free layout route calls — a preview and this render
  // cannot disagree about geometry for the same dimensions.
  const { rects, canvasW, canvasH } = resolveCollageGeometry({
    dims,
    layout,
    resolution,
    aspectRatio,
    gap,
    imageSizes,
  })

  const args = buildCollageFfmpegArgs({ localPaths, rects, canvasW, canvasH, bgColor, outputPath })
  await runFfmpeg(args)

  // Storyboard badges: sequence numbers + per-image labels overlaid onto the
  // finished composite. `buildCollageBadgesSvg` returns undefined when there is
  // nothing to draw (numbered off AND every label empty) — in that case we
  // return the untouched ffmpeg PNG so a plain collage renders byte-identically
  // (no sharp re-encode). Text is drawn by sharp/Pango, never ffmpeg drawtext
  // (local dev ffmpeg has no libfreetype). The re-encode is a CPU/memory-bound
  // 4K raster, so it runs under the shared ffmpeg FIFO slot even though it is
  // not an ffmpeg spawn — the worker fans out at concurrency 50.
  const texts = collageBadgeTexts(imageUrls.length, params.numbered === true, params.imageLabels)
  const svg = buildCollageBadgesSvg({
    canvasW,
    canvasH,
    rects,
    dims,
    texts,
    position: resolveBadgePosition(params.badgePosition),
  })
  if (svg) {
    const labeledPath = join(workDir, "collage-labeled.png")
    await withFfmpegSlot(() =>
      sharp(outputPath)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toFile(labeledPath),
    )
    return labeledPath
  }

  return outputPath
}
