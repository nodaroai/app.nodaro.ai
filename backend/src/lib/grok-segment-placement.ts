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
 * Scale selection is the treacherous part: on SMOOTH content (sky, sea, a
 * wall) a small-scale window ties the true placement at ~1.0 correlation —
 * a gradient resampled is still a gradient — so the raw argmax can shrink a
 * huge segment to a tiny self-similar patch of itself. The solver therefore
 * rescores every per-scale winner on the finest raster under IDENTICAL
 * sampling and resolves near-ties toward the LARGER area: the cutout is a
 * bbox crop, so among equal correlations the biggest placement is the one
 * that explains the whole segment rather than a patch of it. Structured
 * content decorrelates hard at the wrong scale, so the tie-break never fires
 * there.
 *
 * Output bboxes are normalized [0..1] in source-image coordinates, paired
 * with the cutout's content box INSIDE its tile (`tile`) — the tile carries
 * transparent aspect-fit padding, so renderers must map only that sub-rect
 * onto the bbox or the silhouette draws shrunken and centered. A segment
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

export interface LocatedSegment {
  /** Where the cutout's CONTENT sits in the source image (normalized). */
  bbox: NormalizedBBox
  /**
   * Content box of the cutout inside its own tile (normalized to tile dims).
   * Everything outside it is the tile's transparent aspect-fit padding.
   */
  tile: { x: number; y: number; w: number; h: number }
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
/** Scale multipliers tried per iteration of the refinement hill-climb. */
const REFINE_SCALES = [0.88, 0.94, 1.06, 1.14] as const
/** Max hill-climb iterations per finalist (covers the ~30% coarse grid gap). */
const REFINE_ITERATIONS = 4
/** Per-scale winners that survive the rescore ranking and get refined. */
const BEAM_WIDTH = 8
/** Beam members this far below the rescore leader are hopeless — skip them. */
const BEAM_SCORE_SLACK = 0.25
/**
 * Finalists within this margin of the best rescored score are treated as
 * ties and resolved toward the LARGER area (the smooth-content shrink fix).
 */
const SCALE_TIE_EPS = 0.02
/** Masked-sample budget per offset for the finest-raster rescore pass. */
const RESCORE_SAMPLE_TARGET = 4000
/** Rescore position window (px on the finest raster). */
const RESCORE_PAD_PX = 4
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

interface TrimmedTemplate {
  luma: Float32Array
  mask: Uint8Array
  width: number
  height: number
  /** Content box inside the original tile, normalized to tile dims. */
  tileBox: { x: number; y: number; w: number; h: number }
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
async function toTemplate(cutout: Buffer): Promise<TrimmedTemplate | null> {
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
  return {
    luma,
    mask,
    width: w,
    height: h,
    tileBox: { x: minX / width, y: minY / height, w: w / width, h: h / height },
  }
}

/**
 * One 4-neighbourhood erosion step. Out-of-bounds neighbours count as ON so
 * the template's RECT edge never erodes — the bbox is tight, so rect-edge
 * pixels are segment extremes (often the image border), not alpha boundary.
 */
function erodeOnce(mask: Uint8Array, tw: number, th: number) {
  const out = new Uint8Array(tw * th)
  let count = 0
  for (let y = 0; y < th; y++) {
    const row = y * tw
    for (let x = 0; x < tw; x++) {
      const i = row + x
      if (!mask[i]) continue
      if (
        (x > 0 && !mask[i - 1]) ||
        (x < tw - 1 && !mask[i + 1]) ||
        (y > 0 && !mask[i - tw]) ||
        (y < th - 1 && !mask[i + tw])
      ) {
        continue
      }
      out[i] = 1
      count++
    }
  }
  return { mask: out, count }
}

/**
 * Bilinear resample of a masked template to (tw, th), then erode the mask's
 * boundary band. The cutout's alpha edge is unreliable evidence — it's
 * anti-aliased, threshold-quantized, and (when upsampled) blocky by the
 * scale factor — so at the TRUE placement the edge band samples background
 * pixels and depresses the score, while a self-similar interior impostor
 * pays nothing. Eroding ~the uncertainty band restores the fair comparison
 * (this is what let a sky segment's true placement lose to patches of
 * itself). Erosion stops early rather than starve a small mask.
 */
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
  // Erode away the boundary-uncertainty band: ~1 source-template px, scaled
  // by the resample factor (upsampled masks have proportionally wider blocky
  // edges), capped, and never below one step.
  const radius = Math.min(8, Math.max(1, Math.round(tw / t.width) + 1))
  const floor = Math.max(MIN_CONTENT_PX * 4, Math.floor(maskCount * 0.3))
  let erodedMask = mask
  let erodedCount = maskCount
  for (let r = 0; r < radius; r++) {
    const next = erodeOnce(erodedMask, tw, th)
    if (next.count < floor) break
    erodedMask = next.mask
    erodedCount = next.count
  }
  return { luma, mask: erodedMask, maskCount: erodedCount, width: tw, height: th }
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
  template: TrimmedTemplate,
  aspect: number,
  widthFraction: number,
  around?: { cx: number; cy: number },
): NormalizedPlacement | null {
  const ri = rasterIndexFor(rasters, widthFraction, aspect)
  const raster = rasters[ri]
  const tw = Math.max(3, Math.round(widthFraction * raster.width))
  let th = Math.max(2, Math.round(tw / aspect))
  // A full-height placement can round 1px past the raster; that scale is the
  // most important one to keep (the shrink bug lives at the top of the range).
  if (th === raster.height + 1) th = raster.height
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
 * Re-evaluate a placement on the FINEST raster with a capped sample budget.
 * Coarse scores aren't comparable across scales (different rasters, strided
 * sampling, small-template noise); this puts every candidate on one basis
 * and doubles as a sub-pixel-ish position polish. Position may nudge within
 * ±RESCORE_PAD_PX; scale is held fixed.
 */
function rescorePlacement(
  rasters: readonly Raster[],
  template: TrimmedTemplate,
  aspect: number,
  p: NormalizedPlacement,
): NormalizedPlacement | null {
  const ri = rasters.length - 1
  const raster = rasters[ri]
  const tw = Math.max(3, Math.round(p.w * raster.width))
  let th = Math.max(2, Math.round(tw / aspect))
  if (th === raster.height + 1) th = raster.height
  if (tw > raster.width || th > raster.height) return null
  const tpl = resampleTemplate(template, tw, th)
  const sample = Math.max(1, Math.ceil(Math.sqrt(tpl.maskCount / RESCORE_SAMPLE_TARGET)))
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  const win = {
    x0: Math.floor(cx * raster.width - tw / 2 - RESCORE_PAD_PX),
    y0: Math.floor(cy * raster.height - th / 2 - RESCORE_PAD_PX),
    x1: Math.ceil(cx * raster.width - tw / 2 + RESCORE_PAD_PX),
    y1: Math.ceil(cy * raster.height - th / 2 + RESCORE_PAD_PX),
  }
  const hit = bestMatch(raster, tpl, win, { sample })
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
 * Locate one cutout in the source.
 *
 * 1. Coarse: best placement per scale step (strided scan, per-scale raster).
 * 2. Rescore every per-scale winner on the finest raster — the coarse argmax
 *    across scales is not trustworthy (see the header comment).
 * 3. Refine the top BEAM_WIDTH candidates with an iterative scale+position
 *    hill-climb, then rescore each finalist on the same basis.
 * 4. Pick by rescored score, resolving near-ties toward the LARGER area.
 */
function locateOne(
  rasters: readonly Raster[],
  template: TrimmedTemplate,
): NormalizedBBox | null {
  const aspect = template.width / template.height
  // Bbox width as a fraction of image width: from ~2% up to the full frame
  // (clamped so the height fits).
  const maxFraction = Math.min(1, (rasters[0].height / rasters[0].width) * aspect)
  const minFraction = 0.02
  if (maxFraction < minFraction) return null

  const coarse: NormalizedPlacement[] = []
  for (let s = 0; s < SCALE_STEPS; s++) {
    const f = minFraction * Math.pow(maxFraction / minFraction, s / (SCALE_STEPS - 1))
    const hit = matchAtScale(rasters, template, aspect, f)
    if (hit) coarse.push(hit)
  }
  if (coarse.length === 0) return null

  const rescored = coarse
    .map((c) => rescorePlacement(rasters, template, aspect, c))
    .filter((c): c is NormalizedPlacement => c !== null)
    .sort((a, b) => b.score - a.score)
  if (rescored.length === 0 || rescored[0].score < MIN_SCORE * 0.7) return null

  // Score-ranked beam, PLUS the largest-area viable candidates: on smooth
  // content every scale ties near 1.0 and fp noise orders them, so the true
  // (largest) placement must be guaranteed a seat for the area tie-break to
  // ever see it.
  const eligible = rescored.filter((c) => c.score >= rescored[0].score - BEAM_SCORE_SLACK)
  const byArea = [...eligible].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 2)
  const beam = [...new Set([...eligible.slice(0, BEAM_WIDTH), ...byArea])]

  const finalists: NormalizedPlacement[] = []
  for (const cand of beam) {
    // Full-precision windowed baseline at the candidate's own scale, then an
    // iterative hill-climb over nearby scales (recentered every round so it
    // can walk across the ~30% coarse-grid gap).
    let best =
      matchAtScale(rasters, template, aspect, cand.w, {
        cx: cand.x + cand.w / 2,
        cy: cand.y + cand.h / 2,
      }) ?? cand
    for (let iter = 0; iter < REFINE_ITERATIONS; iter++) {
      let improved = false
      const cx = best.x + best.w / 2
      const cy = best.y + best.h / 2
      for (const adj of REFINE_SCALES) {
        const f = best.w * adj
        if (f < minFraction / 2 || f > 1) continue
        const hit = matchAtScale(rasters, template, aspect, f, { cx, cy })
        if (hit && hit.score > best.score) {
          best = hit
          improved = true
        }
      }
      if (!improved) break
    }
    const final = rescorePlacement(rasters, template, aspect, best)
    if (final) finalists.push(final)
  }
  if (finalists.length === 0) return null

  finalists.sort((a, b) => b.score - a.score)
  if (process.env.GROK_PLACEMENT_DEBUG) {
    console.log(
      "[grok-placement] finalists:",
      finalists.map((f) => `w=${f.w.toFixed(3)} h=${f.h.toFixed(3)} s=${f.score.toFixed(4)}`).join(" | "),
    )
  }
  const top = finalists[0]
  if (top.score < MIN_SCORE) return null
  let pick = top
  for (const c of finalists) {
    if (top.score - c.score <= SCALE_TIE_EPS && c.w * c.h > pick.w * pick.h) pick = c
  }
  return { x: pick.x, y: pick.y, w: pick.w, h: pick.h, score: pick.score }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Locate every cutout in the source image. Returns one entry per cutout,
 * order-preserved; null where the cutout couldn't be placed confidently.
 * The whole batch is bounded by `budgetMs` — when it runs out, remaining
 * segments return null rather than stalling the job.
 */
export async function locateGrokSegments(
  sourceImage: Buffer,
  cutouts: readonly Buffer[],
  opts?: { budgetMs?: number },
): Promise<(LocatedSegment | null)[]> {
  const deadline = Date.now() + (opts?.budgetMs ?? 45_000)
  const rasters: Raster[] = []
  for (const w of RASTER_WIDTHS) rasters.push(await toLumaRaster(sourceImage, w))
  const out: (LocatedSegment | null)[] = []
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
          ? {
              bbox: {
                x: round4(box.x),
                y: round4(box.y),
                w: round4(box.w),
                h: round4(box.h),
                score: round4(box.score),
              },
              tile: {
                x: round4(template.tileBox.x),
                y: round4(template.tileBox.y),
                w: round4(template.tileBox.w),
                h: round4(template.tileBox.h),
              },
            }
          : null,
      )
    } catch {
      out.push(null)
    }
  }
  return out
}
