import sharp from "sharp"
import type { ResolvedSwatch } from "./types.js"

const DEFAULT_LABELS = ["primary", "secondary", "accent", "neutral", "highlight"]

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
}

/**
 * Extract up to `count` dominant colors from an image by downscaling to 64px,
 * bucketing pixels into a coarse 4-bit-per-channel RGB cube, and ranking buckets
 * by frequency. Self-contained (no extra deps); deterministic. Labels default to
 * primary/secondary/accent/neutral/highlight and are user-editable downstream.
 */
export async function extractPalette(image: Buffer, count = 5): Promise<ResolvedSwatch[]> {
  const { data, info } = await sharp(image)
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  const ch = info.channels
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4) // 12-bit cube
    const cur = buckets.get(key)
    if (cur) { cur.count++; cur.r += r; cur.g += g; cur.b += b }
    else buckets.set(key, { count: 1, r, g, b })
  }

  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count)
  const swatches: ResolvedSwatch[] = []
  for (let i = 0; i < count; i++) {
    const bucket = ranked[i]
    const label = DEFAULT_LABELS[i] ?? `color ${i + 1}`
    if (!bucket) { swatches.push({ hex: "#808080", label }); continue }
    const hex = `#${toHex(bucket.r / bucket.count)}${toHex(bucket.g / bucket.count)}${toHex(bucket.b / bucket.count)}`
    swatches.push({ hex, label })
  }
  return swatches
}
