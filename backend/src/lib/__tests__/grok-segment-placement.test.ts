/**
 * grok-segment-placement — recover a Grok cutout's position in the source
 * image by masked template matching.
 *
 * Fixtures are synthetic: a structured source image is rendered with sharp,
 * then "Grok cutouts" are manufactured exactly the way Grok makes them —
 * crop the segment's bounding box from the source, alpha-mask it to the
 * segment shape, and aspect-fit it into a 128×128 transparent tile. The
 * solver must find where each cutout came from.
 */

import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { locateGrokSegments, type NormalizedBBox } from "../grok-segment-placement.js"

const W = 640
const H = 360

/** Structured source: gradient backdrop + distinct textured shapes. */
async function makeSource(): Promise<Buffer> {
  const svg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1e3a5f"/>
          <stop offset="1" stop-color="#f59e0b"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#sky)"/>
      <!-- "tower": tall dark red rectangle with window details -->
      <rect x="96" y="60" width="64" height="200" fill="#7f1d1d"/>
      <rect x="112" y="80" width="12" height="18" fill="#fde68a"/>
      <rect x="132" y="120" width="12" height="18" fill="#fde68a"/>
      <rect x="112" y="170" width="12" height="18" fill="#fde68a"/>
      <!-- "boat": small white triangle far right -->
      <polygon points="480,250 512,250 496,215" fill="#f8fafc"/>
      <rect x="478" y="250" width="36" height="8" fill="#334155"/>
      <!-- "ground": textured band along the bottom -->
      <rect x="0" y="300" width="${W}" height="60" fill="#365314"/>
      <circle cx="60" cy="320" r="9" fill="#84cc16"/>
      <circle cx="180" cy="335" r="7" fill="#84cc16"/>
      <circle cx="340" cy="325" r="10" fill="#a3e635"/>
      <circle cx="520" cy="338" r="6" fill="#84cc16"/>
    </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Manufacture a Grok-style cutout: crop `box` from the source, apply an
 * alpha shape (full box by default), aspect-fit into a 128×128 clear tile.
 */
async function makeCutout(
  source: Buffer,
  box: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const crop = await sharp(source).extract(box).ensureAlpha().png().toBuffer()
  return sharp(crop)
    .resize({ width: 128, height: 128, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

function iou(a: NormalizedBBox, b: { x: number; y: number; w: number; h: number }): number {
  const ax2 = a.x + a.w
  const ay2 = a.y + a.h
  const bx2 = b.x + b.w
  const by2 = b.y + b.h
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
  const iyy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
  const inter = ix * iyy
  return inter / (a.w * a.h + b.w * b.h - inter)
}

describe("locateGrokSegments", () => {
  it("recovers the placement of bbox cutouts (large and small) with IoU > 0.5", async () => {
    const source = await makeSource()
    const towerBox = { left: 88, top: 52, width: 80, height: 216 }
    const boatBox = { left: 470, top: 208, width: 52, height: 56 }
    const cutouts = [await makeCutout(source, towerBox), await makeCutout(source, boatBox)]

    const boxes = await locateGrokSegments(source, cutouts)
    expect(boxes).toHaveLength(2)

    const expected = [towerBox, boatBox].map((b) => ({
      x: b.left / W,
      y: b.top / H,
      w: b.width / W,
      h: b.height / H,
    }))
    for (let i = 0; i < 2; i++) {
      const found = boxes[i]
      expect(found, `segment ${i} should be placed`).not.toBeNull()
      expect(iou(found!, expected[i]), `segment ${i} IoU`).toBeGreaterThan(0.5)
    }
  }, 30_000)

  it("returns null for a cutout that isn't in the image (never a confident wrong answer)", async () => {
    const source = await makeSource()
    // A flat noise-free foreign tile: uniform color → flat template is refused.
    const foreign = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 90, g: 20, b: 200, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const boxes = await locateGrokSegments(source, [foreign])
    expect(boxes[0]).toBeNull()
  }, 30_000)

  it("returns null for a fully transparent cutout", async () => {
    const source = await makeSource()
    const empty = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const boxes = await locateGrokSegments(source, [empty])
    expect(boxes[0]).toBeNull()
  }, 30_000)
})
