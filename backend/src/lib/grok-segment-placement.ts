import sharp from "sharp"

/**
 * Grok segment-map placement solver.
 *
 * Grok's segment "masks" are ~128×128 RGBA CUTOUTS: the segment's own pixels
 * from the source image, alpha-masked to the segment shape, cropped to its
 * bounding box and aspect-fit into the tile. The API returns NO coordinates,
 * so to outline a region on the source image we recover each cutout's
 * placement ourselves: masked zero-mean normalized cross-correlation of the
 * cutout's luma against the source's luma, scanned over scale + translation
 * (no rotation — cutouts are axis-aligned crops of the same render).
 *
 * Output bboxes are normalized [0..1] in source-image coordinates. A segment
 * whose best correlation stays below MIN_SCORE returns null (caller degrades
 * to a non-overlaid chip) — wrong outlines are worse than missing ones.
 */

export interface NormalizedBBox {
  x: number
  y: number
  w: number
  h: number
  /** Best masked ZNCC score (0..1-ish; 1 = perfect). */
  score: number
}

/** Below this correlation the placement is considered unreliable. */
const MIN_SCORE = 0.35
/** Working width of the coarse search raster. */
const COARSE_WIDTH = 160
/** Working width of the refinement raster. */
const REFINE_WIDTH = 320
/** Scale steps scanned across the plausible bbox-width range. */
const SCALE_STEPS = 12
/** Alpha threshold for "this cutout pixel belongs to the segment". */
const ALPHA_ON = 128
/** Safety valve: skip placement for degenerate/empty cutouts. */
const MIN_CONTENT_PX = 6

interface Raster {
  luma: Float32Array
  width: number
  height: number
}

interface Template extends Raster {
  /** 0/1 membership per pixel (from cutout alpha). */
  mask: Uint8Array
  maskCount: number
}

async function toLumaRaster(input: Buffer, targetWidth: number): Promise<Raster> {
  const { data, info } = await sharp(input)
    .resize({ width: targetWidth })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const luma = new Float32Array(info.width * info.height)
  for (let i = 0; i < luma.length; i++) luma[i] = data[i]
  return { luma, width: info.width, height: info.height }
}

/** Alpha-trim the cutout tile to its content bbox; return luma + mask. */
async function toTemplate(cutout: Buffer): Promise<{ luma: Float32Array; mask: Uint8Array; width: number; height: number } | null> {
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] >= ALPHA_ON) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  if (w * h < MIN_CONTENT_PX) return null
  const luma = new Float32Array(w * h)
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y + minY) * width + (x + minX)) * channels
      const on = data[src + 3] >= ALPHA_ON
      // Rec. 601 luma to match sharp's greyscale conversion closely enough.
      luma[y * w + x] = 0.299 * data[src] + 0.587 * data[src + 1] + 0.114 * data[src + 2]
      mask[y * w + x] = on ? 1 : 0
    }
  }
  return { luma, mask, width: w, height: h }
}

/** Bilinear resample of a masked template to (tw, th). */
function resampleTemplate(t: { luma: Float32Array; mask: Uint8Array; width: number; height: number }, tw: number, th: number): Template {
  const luma = new Float32Array(tw * th)
  const mask = new Uint8Array(tw * th)
  let maskCount = 0
  const sx = t.width / tw
  const sy = t.height / th
  for (let y = 0; y < th; y++) {
    const fy = Math.min(t.height - 1, (y + 0.5) * sy - 0.5)
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(t.height - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(t.width - 1, (x + 0.5) * sx - 0.5)
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(t.width - 1, x0 + 1)
      const wx = fx - x0
      const i = y * tw + x
      luma[i] =
        t.luma[y0 * t.width + x0] * (1 - wx) * (1 - wy) +
        t.luma[y0 * t.width + x1] * wx * (1 - wy) +
        t.luma[y1 * t.width + x0] * (1 - wx) * wy +
        t.luma[y1 * t.width + x1] * wx * wy
      // Nearest-neighbour membership keeps the mask crisp.
      const on = t.mask[Math.round(fy) * t.width + Math.round(fx)]
      mask[i] = on
      if (on) maskCount++
    }
  }
  return { luma, mask, maskCount, width: tw, height: th }
}

interface Placement {
  x: number
  y: number
  tw: number
  th: number
  score: number
}

/** Masked ZNCC of `tpl` against `img` at every integer offset (optionally windowed). */
function bestMatch(
  img: Raster,
  tpl: Template,
  window?: { x0: number; y0: number; x1: number; y1: number },
): Placement | null {
  const { width: iw, height: ih } = img
  const { width: tw, height: th, mask, maskCount } = tpl
  if (tw > iw || th > ih || maskCount < MIN_CONTENT_PX) return null

  // Template stats over its mask (precomputed once).
  let tSum = 0
  for (let i = 0; i < tpl.luma.length; i++) if (mask[i]) tSum += tpl.luma[i]
  const tMean = tSum / maskCount
  let tVar = 0
  for (let i = 0; i < tpl.luma.length; i++) {
    if (mask[i]) {
      const d = tpl.luma[i] - tMean
      tVar += d * d
    }
  }
  if (tVar < 1e-3) return null // flat template can match anywhere — refuse

  const xStart = Math.max(0, window?.x0 ?? 0)
  const yStart = Math.max(0, window?.y0 ?? 0)
  const xEnd = Math.min(iw - tw, window?.x1 ?? iw - tw)
  const yEnd = Math.min(ih - th, window?.y1 ?? ih - th)

  let best: Placement | null = null
  for (let oy = yStart; oy <= yEnd; oy++) {
    for (let ox = xStart; ox <= xEnd; ox++) {
      let iSum = 0
      let iSumSq = 0
      let dot = 0
      for (let y = 0; y < th; y++) {
        const irow = (oy + y) * iw + ox
        const trow = y * tw
        for (let x = 0; x < tw; x++) {
          if (!mask[trow + x]) continue
          const iv = img.luma[irow + x]
          iSum += iv
          iSumSq += iv * iv
          dot += iv * (tpl.luma[trow + x] - tMean)
        }
      }
      const iMean = iSum / maskCount
      const iVar = iSumSq - iSum * iMean
      if (iVar < 1e-3) continue
      // dot already subtracts tMean; subtracting iMean * Σ(t−tMean) = 0, so
      // dot IS the masked covariance numerator.
      const score = dot / Math.sqrt(iVar * tVar)
      if (!best || score > best.score) best = { x: ox, y: oy, tw, th, score }
    }
  }
  return best
}

/**
 * Locate one cutout in the source raster. Coarse scale scan at COARSE_WIDTH,
 * then a windowed refinement at REFINE_WIDTH around the winner.
 */
function locateOne(
  coarse: Raster,
  refine: Raster,
  template: { luma: Float32Array; mask: Uint8Array; width: number; height: number },
): NormalizedBBox | null {
  const aspect = template.width / template.height
  // Plausible bbox widths in coarse raster coords: from a few pixels up to
  // the full frame (clamped so the height fits too).
  const maxW = Math.min(coarse.width, Math.floor(coarse.height * aspect))
  const minW = Math.max(6, Math.round(coarse.width * 0.05))
  if (maxW < minW) return null

  let bestCoarse: Placement | null = null
  for (let s = 0; s < SCALE_STEPS; s++) {
    const tw = Math.round(minW * Math.pow(maxW / minW, s / (SCALE_STEPS - 1)))
    const th = Math.max(2, Math.round(tw / aspect))
    if (th > coarse.height) continue
    const tpl = resampleTemplate(template, tw, th)
    const hit = bestMatch(coarse, tpl)
    if (hit && (!bestCoarse || hit.score > bestCoarse.score)) bestCoarse = hit
  }
  if (!bestCoarse || bestCoarse.score < MIN_SCORE * 0.8) return null

  // Refine position + scale around the coarse winner at 2× resolution.
  const ratio = refine.width / coarse.width
  let best: Placement | null = null
  for (const scaleAdj of [0.9, 1, 1.1]) {
    const tw = Math.max(4, Math.round(bestCoarse.tw * ratio * scaleAdj))
    const th = Math.max(2, Math.round(tw / aspect))
    if (tw > refine.width || th > refine.height) continue
    const tpl = resampleTemplate(template, tw, th)
    const cx = bestCoarse.x * ratio
    const cy = bestCoarse.y * ratio
    const pad = Math.ceil(6 * ratio)
    const hit = bestMatch(refine, tpl, {
      x0: Math.floor(cx - pad),
      y0: Math.floor(cy - pad),
      x1: Math.ceil(cx + pad),
      y1: Math.ceil(cy + pad),
    })
    if (hit && (!best || hit.score > best.score)) best = hit
  }
  const winner = best ?? bestCoarse
  const raster = best ? refine : coarse
  if (winner.score < MIN_SCORE) return null
  return {
    x: winner.x / raster.width,
    y: winner.y / raster.height,
    w: winner.tw / raster.width,
    h: winner.th / raster.height,
    score: winner.score,
  }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Locate every cutout in the source image. Returns one entry per cutout URL,
 * order-preserved; null where the cutout couldn't be placed confidently.
 * `fetchBuffer` is injected so callers control network policy (safeFetch) and
 * tests can feed fixtures. The whole batch is bounded by `budgetMs` — when it
 * runs out, remaining segments return null rather than stalling the job.
 */
export async function locateGrokSegments(
  sourceImage: Buffer,
  cutouts: readonly Buffer[],
  opts?: { budgetMs?: number },
): Promise<(NormalizedBBox | null)[]> {
  const deadline = Date.now() + (opts?.budgetMs ?? 30_000)
  const coarse = await toLumaRaster(sourceImage, COARSE_WIDTH)
  const refine = await toLumaRaster(sourceImage, REFINE_WIDTH)
  const out: (NormalizedBBox | null)[] = []
  for (const cutout of cutouts) {
    if (Date.now() > deadline) {
      out.push(null)
      continue
    }
    try {
      const template = await toTemplate(cutout)
      if (!template) {
        out.push(null)
        continue
      }
      const box = locateOne(coarse, refine, template)
      out.push(
        box
          ? { x: round4(box.x), y: round4(box.y), w: round4(box.w), h: round4(box.h), score: round4(box.score) }
          : null,
      )
    } catch {
      out.push(null)
    }
  }
  return out
}
