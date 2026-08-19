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
 * Two hard-won rules shape the design (validated against real production
 * segment maps, not just synthetic fixtures):
 *
 * 1. MATCH AT THE TILE'S NATIVE RESOLUTION. A big segment's template holds at
 *    most ~128px of detail; correlating it upsampled against a fine source
 *    raster destroys fine texture (ocean sparkle, grass) exactly at the TRUE
 *    placement, while some tiny self-similar window elsewhere scores ~1.0 —
 *    which is how an ocean band collapsed to a speck in the sky. Each scale
 *    candidate therefore searches on the raster whose template size stays
 *    closest to the template's own resolution.
 *
 * 2. THE SILHOUETTE IS EVIDENCE. Interior luma alone can't tell white sails
 *    from a white lighthouse, and smooth content ties every scale at ~1.0 (a
 *    gradient resampled is still a gradient). The score therefore combines
 *    interior NCC (over an eroded mask — the alpha edge band is unreliable)
 *    with an EDGE-ALIGNMENT term: at the true placement the mask boundary
 *    (including interior holes) coincides with real image edges. Remaining
 *    near-ties resolve toward the LARGER area — the placement that explains
 *    the whole segment rather than a self-similar patch of it.
 *
 * Output bboxes are normalized [0..1] in source-image coordinates, paired
 * with the cutout's content box INSIDE its tile (`tile`) — the tile carries
 * transparent aspect-fit padding, so renderers must map only that sub-rect
 * onto the bbox or the silhouette draws shrunken and centered. A segment
 * whose best combined score stays below MIN_SCORE returns null (caller
 * degrades to a non-overlaid chip) — wrong outlines are worse than missing
 * ones.
 */

export interface NormalizedBBox {
  x: number
  y: number
  w: number
  h: number
  /** Best combined placement score (0..1-ish; 1 = perfect). */
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
 * Below this combined score the placement is considered unreliable. On the
 * real-image validation set, correct placements score 0.79-0.89 and wrong
 * ones ≤ ~0.66 — 0.7 splits the distributions. Segments that genuinely
 * can't be solved from a 128px tile (a sail thinner than 2% of the frame)
 * must fall to null, never to a confident sliver.
 */
const MIN_SCORE = 0.7
/** Search raster widths; each scale candidate picks the one closest to the
 *  template's native resolution (see header rule 1). */
const RASTER_WIDTHS = [160, 320, 640] as const
/** Minimum template long side (px) for a raster to be feasible. */
const MIN_TEMPLATE_PX = 20
/** Scale candidates scanned across the plausible bbox-width range. */
const SCALE_STEPS = 16
/** Scale multipliers tried per iteration of the refinement hill-climb. */
const REFINE_SCALES = [0.88, 0.94, 1.06, 1.14] as const
/** Max hill-climb iterations per finalist (covers the ~30% coarse grid gap). */
const REFINE_ITERATIONS = 4
/** Per-scale winners that survive ranking and get the refine pass. */
const BEAM_WIDTH = 8
/** Beam members this far below the leader are hopeless — skip them. */
const BEAM_SCORE_SLACK = 0.25
/** Finalists within this margin of the best score are ties → LARGER area wins. */
const SCALE_TIE_EPS = 0.02
/** Interior-NCC vs edge-alignment weights in the combined score. */
const W_NCC = 0.8
const W_EDGE = 0.2
/** Neutral edge score used when a template has no usable boundary ring. */
const EDGE_NEUTRAL = 1 / 3
/** Alpha threshold for "this cutout pixel belongs to the segment". */
const ALPHA_ON = 128
/** Safety valve: skip placement for degenerate/empty cutouts. */
const MIN_CONTENT_PX = 6

interface Raster {
  luma: Float32Array
  /** |dx|+|dy| gradient magnitude of luma (edge-alignment evidence). */
  grad: Float32Array
  meanGrad: number
  width: number
  height: number
}

interface Template extends Omit<Raster, "grad" | "meanGrad"> {
  /** 0/1 membership per pixel (eroded — interior evidence only). */
  mask: Uint8Array
  maskCount: number
  /** Boundary band removed by erosion (incl. interior holes) — shape evidence. */
  ring: Uint8Array
  ringCount: number
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
  // The light blur is load-bearing: the template's pixels reached their tile
  // via a DIFFERENT downsample path than the raster (source→crop→128-tile vs
  // source→raster), so high-frequency texture (grass, ocean sparkle) aliases
  // differently on each side and decorrelates at the TRUE placement. A small
  // common blur (template side gets the same, in resampleTemplate) washes
  // the path difference out while keeping structure.
  const { data, info } = await sharp(input)
    .resize({ width: targetWidth })
    .greyscale()
    .blur(1)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const luma = new Float32Array(w * h)
  for (let i = 0; i < luma.length; i++) luma[i] = data[i]
  const grad = new Float32Array(w * h)
  let gradSum = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const dx = x + 1 < w ? luma[i + 1] - luma[i] : 0
      const dy = y + 1 < h ? luma[i + w] - luma[i] : 0
      const g = Math.abs(dx) + Math.abs(dy)
      grad[i] = g
      gradSum += g
    }
  }
  return { luma, grad, meanGrad: Math.max(1e-3, gradSum / (w * h)), width: w, height: h }
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
 * Bilinear resample of a masked template to (tw, th), then split the mask
 * into an eroded INTERIOR (luma evidence — the alpha edge band is
 * anti-aliased, threshold-quantized, and blocky when upsampled, so at the
 * true placement it samples background and depresses NCC while self-similar
 * impostors pay nothing) and the removed boundary RING (shape evidence for
 * the edge-alignment term). Erosion stops early rather than starve a small
 * mask; a mask with no OFF pixels (full-rect cutout) gets a one-step ring.
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
  // Match the rasters' common blur (see toLumaRaster): two 3-tap separable
  // smoothing passes ≈ a σ~1 gaussian. Mask/ring stay crisp.
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(luma)
    for (let y = 0; y < th; y++) {
      const row = y * tw
      for (let x = 0; x < tw; x++) {
        const l = x > 0 ? src[row + x - 1] : src[row + x]
        const r = x < tw - 1 ? src[row + x + 1] : src[row + x]
        luma[row + x] = 0.25 * l + 0.5 * src[row + x] + 0.25 * r
      }
    }
    const src2 = Float32Array.from(luma)
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const u = y > 0 ? src2[(y - 1) * tw + x] : src2[y * tw + x]
        const d = y < th - 1 ? src2[(y + 1) * tw + x] : src2[y * tw + x]
        luma[y * tw + x] = 0.25 * u + 0.5 * src2[y * tw + x] + 0.25 * d
      }
    }
  }
  // Boundary-uncertainty band: ~1 source-template px scaled by the resample
  // factor, capped, never below one step.
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
  const ring = new Uint8Array(tw * th)
  let ringCount = 0
  if (erodedCount < maskCount) {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && !erodedMask[i]) {
        ring[i] = 1
        ringCount++
      }
    }
  } else {
    // Nothing eroded (full-rect mask under OOB-as-ON) — take one step just
    // for the ring so edge evidence still exists where a real boundary does.
    const one = erodeOnce(mask, tw, th)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && !one.mask[i]) {
        ring[i] = 1
        ringCount++
      }
    }
  }
  return { luma, mask: erodedMask, maskCount: erodedCount, width: tw, height: th, ring, ringCount }
}

interface Placement {
  x: number
  y: number
  tw: number
  th: number
  score: number
  /** Masked template pixels the NCC was computed over. */
  samples: number
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
      if (!best || score > best.score) best = { x: ox, y: oy, tw, th, score, samples: sampledCount }
    }
  }
  return best
}

/**
 * Edge-alignment at a placement: mean source gradient along the template's
 * boundary ring, relative to the raster's global mean gradient, squashed to
 * (0..1). ~1/3 on featureless ground, higher when the silhouette lies on
 * real edges. Neutral when the template has no usable ring.
 */
function edgeAlignAt(img: Raster, tpl: Template, ox: number, oy: number): number {
  if (tpl.ringCount < 4) return EDGE_NEUTRAL
  const { width: tw, height: th, ring } = tpl
  let sum = 0
  for (let y = 0; y < th; y++) {
    const irow = (oy + y) * img.width + ox
    const trow = y * tw
    for (let x = 0; x < tw; x++) {
      if (ring[trow + x]) sum += img.grad[irow + x]
    }
  }
  const align = sum / tpl.ringCount / img.meanGrad
  return align / (align + 2)
}

const combineScore = (ncc: number, edge: number) => W_NCC * ncc + W_EDGE * edge

interface NormalizedPlacement extends NormalizedBBox {
  rasterIndex: number
}

/**
 * Raster whose template rendering stays closest to the template's NATIVE
 * resolution (header rule 1), among rasters where the template both fits and
 * keeps ≥ MIN_TEMPLATE_PX of detail. Falls back to the finest raster.
 */
function rasterIndexFor(
  rasters: readonly Raster[],
  widthFraction: number,
  aspect: number,
  templateWidth: number,
): number {
  let bestI = rasters.length - 1
  let bestD = Infinity
  for (let i = 0; i < rasters.length; i++) {
    const tw = widthFraction * rasters[i].width
    const th = tw / aspect
    if (Math.max(tw, th) < MIN_TEMPLATE_PX) continue
    if (tw > rasters[i].width || th > rasters[i].height + 1) continue
    const d = Math.abs(Math.log(tw / templateWidth))
    if (d < bestD) {
      bestD = d
      bestI = i
    }
  }
  return bestI
}

/**
 * Run one (scale, raster) candidate; returns a normalized placement scored
 * by the COMBINED metric. `around` (center fractions) windows the search to
 * ±REFINE_PAD_PX of the expected top-left on the chosen raster.
 */
const REFINE_PAD_PX = 10

function matchAtScale(
  rasters: readonly Raster[],
  template: TrimmedTemplate,
  aspect: number,
  widthFraction: number,
  around?: { cx: number; cy: number },
): NormalizedPlacement | null {
  const ri = rasterIndexFor(rasters, widthFraction, aspect, template.width)
  const raster = rasters[ri]
  const tw = Math.max(3, Math.round(widthFraction * raster.width))
  let th = Math.max(2, Math.round(tw / aspect))
  // A full-height placement can round 1px past the raster; that scale is the
  // most important one to keep (the shrink bug lives at the top of the range).
  if (th === raster.height + 1) th = raster.height
  if (tw > raster.width || th > raster.height) return null
  // Below the detail floor even on the finest raster, a match is a coin flip
  // (a 10px sliver of anything correlates with anything — how "white sails"
  // once landed on a white lighthouse). The SHORT side must hold detail too,
  // or a tall 8px-wide sliver sneaks through on its height alone. Refuse the
  // scale; null beats wrong.
  if (Math.max(tw, th) < MIN_TEMPLATE_PX || Math.min(tw, th) < MIN_TEMPLATE_PX / 2) return null
  const tpl = resampleTemplate(template, tw, th)
  const win = around
    ? {
        x0: Math.floor(around.cx * raster.width - tw / 2 - REFINE_PAD_PX),
        y0: Math.floor(around.cy * raster.height - th / 2 - REFINE_PAD_PX),
        x1: Math.ceil(around.cx * raster.width - tw / 2 + REFINE_PAD_PX),
        y1: Math.ceil(around.cy * raster.height - th / 2 + REFINE_PAD_PX),
      }
    : undefined
  // Full-frame scans run strided; big templates (matched-resolution keeps
  // them near 128px even on fine rasters, where positions × mask pixels
  // explode) stride/sample harder — the refine window (±REFINE_PAD_PX ≥
  // stride) then recovers the coarse grid's error at (near-)full precision.
  const big = tpl.maskCount > 8000
  const hit = bestMatch(
    raster,
    tpl,
    win,
    around ? { sample: big ? 2 : 1 } : { stride: big ? 4 : 2, sample: big ? 3 : 2 },
  )
  if (!hit) return null
  const edge = edgeAlignAt(raster, tpl, hit.x, hit.y)
  // Small-sample shrinkage: an NCC over n pixels has ~1/√n of null-noise
  // headroom, which is exactly how tiny windows of texture soup outscore
  // large true placements. Charge it back.
  const ncc = hit.score - 1 / Math.sqrt(hit.samples)
  return {
    x: hit.x / raster.width,
    y: hit.y / raster.height,
    w: hit.tw / raster.width,
    h: hit.th / raster.height,
    score: combineScore(ncc, edge),
    rasterIndex: ri,
  }
}

/**
 * Locate one cutout in the source.
 *
 * 1. Coarse: best placement per scale step (strided scan on the
 *    resolution-matched raster), scored NCC + edge.
 * 2. Beam: top scorers PLUS the largest-area viable candidates — on smooth
 *    content every scale ties near 1.0 and fp noise orders them, so the true
 *    (largest) placement must be guaranteed a seat.
 * 3. Iterative scale+position hill-climb per beam member.
 * 4. Pick by combined score, resolving near-ties toward the LARGER area.
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
  coarse.sort((a, b) => b.score - a.score)
  if (coarse[0].score < MIN_SCORE * 0.7) return null

  const eligible = coarse.filter((c) => c.score >= coarse[0].score - BEAM_SCORE_SLACK)
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
    finalists.push(best)
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
  // Matched-resolution scanning costs ~1.5s/segment on a laptop; prod worker
  // CPUs run slower, and running out mid-batch nulls the remaining segments.
  const deadline = Date.now() + (opts?.budgetMs ?? 90_000)
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
