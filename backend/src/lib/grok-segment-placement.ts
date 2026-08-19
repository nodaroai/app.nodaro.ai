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

/**
 * Below this correlation the placement is considered unreliable. The cutout
 * content is the source image's OWN pixels, so a true placement scores near
 * 1.0 at adequate resolution — a high floor turns "confidently wrong" (the
 * production sailboat incident) into "no outline", which is the right
 * degradation.
 */
const MIN_SCORE = 0.55
/**
 * Search raster widths. The raster for each scale candidate is chosen so the
 * template keeps ≥ MIN_TEMPLATE_PX of detail — a ~3%-of-width segment (the
 * production sailboat) is a ~6px smear at 160 but a ~26px template at 640.
 * Small templates are cheap to slide even on the big raster (cost ∝
 * positions × template pixels), so this stays within budget.
 */
const RASTER_WIDTHS = [160, 320, 640] as const
/** Minimum template long side (px) for a scale candidate's raster choice. */
const MIN_TEMPLATE_PX = 20
/** Scale candidates scanned across the plausible bbox-width range. */
const SCALE_STEPS = 16
/** Scale multipliers tried in the refinement pass around the coarse winner. */
const REFINE_SCALES = [0.88, 0.94, 1, 1.06, 1.14] as const
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

/**
 * Masked ZNCC of `tpl` against `img` at integer offsets (optionally
 * windowed). `stride` steps the OFFSET grid and `sample` subsamples the
 * masked TEMPLATE pixels — a stride-2/sample-2 scan is ~16× cheaper and its
 * peak sits within `stride` px of the true one, which the caller's windowed
 * full-precision polish recovers. Template stats are computed over the SAME
 * sampled pixel set so the correlation stays properly normalized.
 */
function bestMatch(
  img: Raster,
  tpl: Template,
  window?: { x0: number; y0: number; x1: number; y1: number },
  opts?: { stride?: number; sample?: number },
): Placement | null {
  const stride = Math.max(1, opts?.stride ?? 1)
  const sample = Math.max(1, opts?.sample ?? 1)
  const { width: iw, height: ih } = img
  const { width: tw, height: th, mask } = tpl
  if (tw > iw || th > ih || tpl.maskCount < MIN_CONTENT_PX) return null

  // Template stats over the sampled mask.
  let tSum = 0
  let sampledCount = 0
  for (let y = 0; y < th; y += sample) {
    const trow = y * tw
    for (let x = 0; x < tw; x += sample) {
      if (mask[trow + x]) {
        tSum += tpl.luma[trow + x]
        sampledCount++
      }
    }
  }
  if (sampledCount < MIN_CONTENT_PX) return null
  const tMean = tSum / sampledCount
  let tVar = 0
  for (let y = 0; y < th; y += sample) {
    const trow = y * tw
    for (let x = 0; x < tw; x += sample) {
      if (mask[trow + x]) {
        const d = tpl.luma[trow + x] - tMean
        tVar += d * d
      }
    }
  }
  if (tVar < 1e-3) return null // flat template can match anywhere — refuse

  const xStart = Math.max(0, window?.x0 ?? 0)
  const yStart = Math.max(0, window?.y0 ?? 0)
  const xEnd = Math.min(iw - tw, window?.x1 ?? iw - tw)
  const yEnd = Math.min(ih - th, window?.y1 ?? ih - th)

  let best: Placement | null = null
  for (let oy = yStart; oy <= yEnd; oy += stride) {
    for (let ox = xStart; ox <= xEnd; ox += stride) {
      let iSum = 0
      let iSumSq = 0
      let dot = 0
      for (let y = 0; y < th; y += sample) {
        const irow = (oy + y) * iw + ox
        const trow = y * tw
        for (let x = 0; x < tw; x += sample) {
          if (!mask[trow + x]) continue
          const iv = img.luma[irow + x]
          iSum += iv
          iSumSq += iv * iv
          dot += iv * (tpl.luma[trow + x] - tMean)
        }
      }
      const iMean = iSum / sampledCount
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

interface NormalizedPlacement extends NormalizedBBox {
  /** Raster the winning match ran on (refinement upsamples from here). */
  rasterIndex: number
}

/** Smallest raster on which a bbox-width fraction keeps template detail. */
function rasterIndexFor(rasters: readonly Raster[], widthFraction: number, aspect: number): number {
  for (let i = 0; i < rasters.length; i++) {
    const tw = widthFraction * rasters[i].width
    const th = tw / aspect
    if (Math.max(tw, th) >= MIN_TEMPLATE_PX) return i
  }
  return rasters.length - 1
}

/**
 * Run one (scale, raster) candidate; returns a normalized placement.
 * `around` (center fractions) windows the search to ±REFINE_PAD_PX of the
 * expected top-left on the chosen raster.
 */
const REFINE_PAD_PX = 10

function matchAtScale(
  rasters: readonly Raster[],
  template: { luma: Float32Array; mask: Uint8Array; width: number; height: number },
  aspect: number,
  widthFraction: number,
  around?: { cx: number; cy: number },
): NormalizedPlacement | null {
  const ri = rasterIndexFor(rasters, widthFraction, aspect)
  const raster = rasters[ri]
  const tw = Math.max(3, Math.round(widthFraction * raster.width))
  const th = Math.max(2, Math.round(tw / aspect))
  if (tw > raster.width || th > raster.height) return null
  const tpl = resampleTemplate(template, tw, th)
  const win = around
    ? {
        x0: Math.floor(around.cx * raster.width - tw / 2 - REFINE_PAD_PX),
        y0: Math.floor(around.cy * raster.height - th / 2 - REFINE_PAD_PX),
        x1: Math.ceil(around.cx * raster.width - tw / 2 + REFINE_PAD_PX),
        y1: Math.ceil(around.cy * raster.height - th / 2 + REFINE_PAD_PX),
      }
    : undefined
  // Full-frame scans run cheap (stride-2/sample-2); the windowed refinement
  // pass runs at full precision and recovers the coarse grid's ±stride error.
  const hit = bestMatch(raster, tpl, win, around ? undefined : { stride: 2, sample: 2 })
  if (!hit) return null
  return {
    x: hit.x / raster.width,
    y: hit.y / raster.height,
    w: hit.tw / raster.width,
    h: hit.th / raster.height,
    score: hit.score,
    rasterIndex: ri,
  }
}

/**
 * Locate one cutout in the source. Scale scan with a PER-SCALE raster chosen
 * so the template keeps detail (small segments search on the fine raster),
 * then a windowed scale+position refinement one raster up from the winner.
 */
function locateOne(
  rasters: readonly Raster[],
  template: { luma: Float32Array; mask: Uint8Array; width: number; height: number },
): NormalizedBBox | null {
  const aspect = template.width / template.height
  // Bbox width as a fraction of image width: from ~2% up to the full frame
  // (clamped so the height fits).
  const maxFraction = Math.min(1, (rasters[0].height / rasters[0].width) * aspect)
  const minFraction = 0.02
  if (maxFraction < minFraction) return null

  let best: NormalizedPlacement | null = null
  for (let s = 0; s < SCALE_STEPS; s++) {
    const f = minFraction * Math.pow(maxFraction / minFraction, s / (SCALE_STEPS - 1))
    const hit = matchAtScale(rasters, template, aspect, f)
    if (hit && (!best || hit.score > best.score)) best = hit
  }
  if (!best || best.score < MIN_SCORE * 0.7) return null

  // Refinement: finer scale steps, windowed around the winner's center.
  const cx = best.x + best.w / 2
  const cy = best.y + best.h / 2
  for (const adj of REFINE_SCALES) {
    const f = best.w * adj
    if (f < minFraction / 2 || f > 1) continue
    const hit = matchAtScale(rasters, template, aspect, f, { cx, cy })
    if (hit && hit.score > best.score) best = hit
  }
  if (best.score < MIN_SCORE) return null
  return { x: best.x, y: best.y, w: best.w, h: best.h, score: best.score }
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
  const deadline = Date.now() + (opts?.budgetMs ?? 45_000)
  const rasters: Raster[] = []
  for (const w of RASTER_WIDTHS) rasters.push(await toLumaRaster(sourceImage, w))
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
      const box = locateOne(rasters, template)
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
