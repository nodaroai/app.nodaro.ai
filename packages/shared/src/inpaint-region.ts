export interface PixelBox { x: number; y: number; width: number; height: number }

export interface MaskRegionDescriptor {
  /** bbox normalized to 0..1 against the image, clamped so x+width ≤ 1 and y+height ≤ 1. */
  normBbox: PixelBox
  /** Natural-language location, e.g. "the upper-left region" / "the center". */
  location: string
  /** Prompt fragment to PREPEND to the user instruction. */
  fragment: string
}

function band(center: number): "low" | "mid" | "high" {
  if (center < 1 / 3) return "low"
  if (center > 2 / 3) return "high"
  return "mid"
}

const VERT = { low: "upper", mid: "middle", high: "lower" } as const
const HORZ = { low: "left", mid: "center", high: "right" } as const

/**
 * Turn a pixel bounding box of the masked (edit) region into a normalized bbox
 * + natural-language location + a prompt fragment. Pure — no IO. This is the
 * Tier-B descriptor injected for strong instruction-following editors, and the
 * exact primitive Phase 2 (named regions) will reuse.
 */
export function describeMaskRegion(box: PixelBox, image: { width: number; height: number }): MaskRegionDescriptor {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
  const round2 = (n: number) => Math.round(n * 100) / 100
  const nx = clamp01(box.x / image.width)
  const ny = clamp01(box.y / image.height)
  const normBbox: PixelBox = {
    x: round2(nx),
    y: round2(ny),
    width: round2(Math.max(0, Math.min(1 - nx, box.width / image.width))),
    height: round2(Math.max(0, Math.min(1 - ny, box.height / image.height))),
  }

  const cx = (box.x + box.width / 2) / image.width
  const cy = (box.y + box.height / 2) / image.height
  const v = VERT[band(cy)]
  const h = HORZ[band(cx)]
  const location = v === "middle" && h === "center" ? "the center" : `the ${v}-${h} region`

  const fragment =
    `Apply the following change ONLY to ${location} of the image ` +
    `(normalized region x=${normBbox.x} y=${normBbox.y} w=${normBbox.width} h=${normBbox.height}), ` +
    `leaving everything else unchanged: `

  return { normBbox, location, fragment }
}
