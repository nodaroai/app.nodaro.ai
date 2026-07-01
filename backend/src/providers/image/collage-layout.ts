/**
 * Smart collage layout — pure geometry, no I/O.
 *
 * Given N source images (natural dimensions), a fixed output canvas, and a
 * gap, computes one pixel rectangle per image such that the images tile the
 * WHOLE canvas with no wasted space. Each image is later cover-cropped into
 * its rectangle by the compositor (ffmpeg), so a rectangle only needs to be
 * proportional-ish to its source to keep cropping minimal.
 *
 * Two modes:
 *   • "smart"  — justified rows (Google-Photos / Flickr style). Images are
 *                partitioned into rows balanced by aspect ratio; each row is
 *                width-justified to fill the canvas, and the row heights are
 *                scaled so they sum to the canvas height. Preserves input
 *                order and respects each image's aspect ratio (minimal crop).
 *   • "grid"   — uniform ceil(√n)-column grid; every cell is identical. The
 *                last (partial) row is centred.
 *
 * This module is intentionally free of any ffmpeg / sharp / network code so it
 * can be unit-tested exhaustively (see __tests__/collage-layout.test.ts). The
 * ffmpeg compositor consumes the returned rects verbatim.
 */

export interface ImageDim {
  readonly w: number
  readonly h: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type CollageLayoutMode = "smart" | "grid"

export interface CollageLayoutOpts {
  readonly mode?: CollageLayoutMode
  /** Gap in pixels on the OUTPUT canvas, applied between cells and as the
   *  outer margin. Defaults to 0. */
  readonly gap?: number
}

/** Aspect ratios outside this band would blow up a justified row; clamp them
 *  so a single panoramic/columnar image can't collapse a whole row. */
const MIN_ASPECT = 0.2
const MAX_ASPECT = 5

function safeAspect(d: ImageDim): number {
  const w = d.w > 0 ? d.w : 1
  const h = d.h > 0 ? d.h : 1
  const a = w / h
  if (!Number.isFinite(a) || a <= 0) return 1
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a))
}

/**
 * Choose a row count for `n` images on a canvas of the given aspect. A square
 * canvas of square images wants ≈√n rows; a wide canvas wants fewer rows (each
 * holds more), a tall canvas wants more. `rows ≈ √(n / canvasAspect)`.
 */
function chooseRows(n: number, canvasAspect: number): number {
  const raw = Math.round(Math.sqrt(n / Math.max(0.05, canvasAspect)))
  return Math.max(1, Math.min(n, raw))
}

/**
 * Partition image indices [0..n) into exactly `rowCount` non-empty, contiguous
 * rows, balancing the sum of aspect ratios per row (so rows end up with similar
 * heights). Greedy with a "leave one image per remaining row" guard so no row
 * is ever starved.
 */
function partitionIntoRows(aspects: readonly number[], rowCount: number): number[][] {
  const n = aspects.length
  if (rowCount >= n) return aspects.map((_, i) => [i])
  if (rowCount <= 1) return [aspects.map((_, i) => i)]

  const total = aspects.reduce((s, a) => s + a, 0)
  const target = total / rowCount
  const rows: number[][] = []
  let cur: number[] = []
  let curSum = 0

  for (let i = 0; i < n; i++) {
    cur.push(i)
    curSum += aspects[i]!

    // Rows still to open AFTER the current one, and images left after index i.
    const unopenedRows = rowCount - rows.length - 1
    const imagesRemaining = n - (i + 1)

    // Close the current row when either we MUST (to leave one image per still-
    // unopened row) or the row hit its aspect-sum target and enough images
    // remain to fill the rest (one each). The guard keeps the final row open so
    // it absorbs the tail.
    if (
      rows.length < rowCount - 1 &&
      (imagesRemaining === unopenedRows ||
        (curSum >= target && imagesRemaining > unopenedRows))
    ) {
      rows.push(cur)
      cur = []
      curSum = 0
    }
  }
  if (cur.length > 0) rows.push(cur)
  return rows
}

function computeSmart(
  images: readonly ImageDim[],
  canvasW: number,
  canvasH: number,
  gap: number,
): Rect[] {
  const n = images.length
  const aspects = images.map(safeAspect)
  const rowCount = chooseRows(n, canvasW / canvasH)
  const rows = partitionIntoRows(aspects, rowCount)
  const R = rows.length

  // Provisional row heights: for a row width-justified to fill the canvas,
  // height = availableWidth / Σ(aspect). Wider rows (more/wider images) get
  // shorter heights, which is what we then scale to fit the canvas height.
  const provisional = rows.map((row) => {
    const availW = canvasW - gap * (row.length + 1)
    const aspectSum = row.reduce((s, idx) => s + aspects[idx]!, 0)
    return availW / Math.max(0.0001, aspectSum)
  })

  const availH = canvasH - gap * (R + 1)
  const provisionalSum = provisional.reduce((s, h) => s + h, 0)
  const scale = availH / Math.max(0.0001, provisionalSum)

  const rects: Rect[] = new Array(n)
  let y = gap
  for (let r = 0; r < R; r++) {
    const row = rows[r]!
    // Final row height. Last row absorbs rounding so the collage bottom lands
    // exactly on the canvas edge.
    const rawH = provisional[r]! * scale
    const rowH = r === R - 1 ? canvasH - gap - y : rawH
    const availW = canvasW - gap * (row.length + 1)
    const aspectSum = row.reduce((s, idx) => s + aspects[idx]!, 0)

    let x = gap
    for (let c = 0; c < row.length; c++) {
      const idx = row[c]!
      const rawW = (availW * aspects[idx]!) / aspectSum
      // Last cell in the row absorbs rounding so the row edge lands exactly.
      const cellW = c === row.length - 1 ? canvasW - gap - x : rawW
      rects[idx] = {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(1, Math.round(cellW)),
        h: Math.max(1, Math.round(rowH)),
      }
      x += cellW + gap
    }
    y += rowH + gap
  }
  return rects
}

function computeGrid(
  images: readonly ImageDim[],
  canvasW: number,
  canvasH: number,
  gap: number,
): Rect[] {
  const n = images.length
  const cols = Math.ceil(Math.sqrt(n))
  const rowCount = Math.ceil(n / cols)
  const cellW = (canvasW - gap * (cols + 1)) / cols
  const cellH = (canvasH - gap * (rowCount + 1)) / rowCount

  const rects: Rect[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    const isLastRow = r === rowCount - 1
    const itemsInRow = isLastRow ? n - r * cols : cols
    // Centre a partial last row.
    const rowLeftPad = isLastRow && itemsInRow < cols
      ? gap + ((cols - itemsInRow) * (cellW + gap)) / 2
      : gap
    const c = i - r * cols
    const x = rowLeftPad + c * (cellW + gap)
    const y = gap + r * (cellH + gap)
    rects[i] = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.max(1, Math.round(cellW)),
      h: Math.max(1, Math.round(cellH)),
    }
  }
  return rects
}

/**
 * Compute the collage layout. Returns one integer-pixel rect per input image,
 * in the SAME order as `images`. Throws on an empty image list.
 */
export function computeCollageLayout(
  images: readonly ImageDim[],
  canvasW: number,
  canvasH: number,
  opts: CollageLayoutOpts = {},
): Rect[] {
  if (images.length === 0) {
    throw new Error("computeCollageLayout: at least one image is required")
  }
  const gap = Math.max(0, Math.floor(opts.gap ?? 0))
  const mode = opts.mode ?? "smart"
  if (mode === "grid") return computeGrid(images, canvasW, canvasH, gap)
  return computeSmart(images, canvasW, canvasH, gap)
}
