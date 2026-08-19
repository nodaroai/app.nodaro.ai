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
      <!-- "distant buoy": TINY (production sailboat scale — ~3% of width;
           at a 160px search raster this is a ~6px template). Deliberately
           NOT another white triangle — masked NCC can't tell twin shapes
           with identical interiors apart, and that's not the failure mode
           under test (resolution starvation is). -->
      <circle cx="565" cy="106" r="11" fill="#dc2626"/>
      <rect x="554" y="104" width="22" height="5" fill="#fde68a"/>
      <rect x="562" y="92" width="5" height="14" fill="#0f172a"/>
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
 * alpha shape (full box by default, or an SVG path in box-local coords),
 * aspect-fit into a 128×128 clear tile.
 */
async function makeCutout(
  source: Buffer,
  box: { left: number; top: number; width: number; height: number },
  shapePath?: string,
): Promise<Buffer> {
  let crop = sharp(source).extract(box).ensureAlpha()
  if (shapePath) {
    const maskSvg = `<svg width="${box.width}" height="${box.height}" xmlns="http://www.w3.org/2000/svg"><path d="${shapePath}" fill="#fff"/></svg>`
    crop = sharp(await crop.composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }]).png().toBuffer())
  }
  return crop
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
  it("recovers the placement of bbox cutouts — large, small, and TINY (production sailboat scale) — with IoU > 0.55", async () => {
    const source = await makeSource()
    const towerBox = { left: 88, top: 52, width: 80, height: 216 }
    const boatBox = { left: 470, top: 208, width: 52, height: 56 }
    // The regression from production (2026-08-18): a ~3%-of-width segment got
    // a confidently WRONG placement because the coarse raster reduced it to
    // ~6px of template. Must either place it right or return null — this
    // asserts it places right.
    const tinyBox = { left: 548, top: 92, width: 34, height: 38 }
    const cutouts = [
      await makeCutout(source, towerBox),
      await makeCutout(source, boatBox),
      await makeCutout(source, tinyBox),
    ]

    const located = await locateGrokSegments(source, cutouts)
    expect(located).toHaveLength(3)

    const expected = [towerBox, boatBox, tinyBox].map((b) => ({
      x: b.left / W,
      y: b.top / H,
      w: b.width / W,
      h: b.height / H,
    }))
    for (let i = 0; i < 3; i++) {
      const found = located[i]
      expect(found, `segment ${i} should be placed`).not.toBeNull()
      expect(iou(found!.bbox, expected[i]), `segment ${i} IoU`).toBeGreaterThan(0.55)
    }

    // The tower tile: 80×216 contain-fit into 128×128 → content ≈47×128,
    // horizontally centered. The reported tile content box must reflect that
    // (it's what lets the UI skip the transparent padding when masking).
    const towerTile = located[0]!.tile
    expect(towerTile.y).toBeLessThan(0.03)
    expect(towerTile.h).toBeGreaterThan(0.97)
    expect(towerTile.w).toBeCloseTo(47 / 128, 1)
    expect(towerTile.x).toBeCloseTo((128 - 47) / 2 / 128, 1)
  }, 30_000)

  it("does not shrink a large SMOOTH segment to a self-similar patch of itself (production 2026-08-19: sky came back tiny)", async () => {
    // A near-featureless gradient is scale-invariant under ZNCC — a small
    // window of sky correlates ~1.0 exactly like the true full placement, so
    // a raw argmax picks arbitrarily. The area tie-break must resolve this
    // toward the placement that explains the whole segment.
    const skylinePts = "0,168 80,150 160,178 240,144 320,174 400,132 480,170 560,146 640,164"
    const skylinePath = skylinePts
      .split(" ")
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.replace(",", " ")}`)
      .join(" ")
    const svg = `
      <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#0b1d3a"/>
            <stop offset="1" stop-color="#f9d9a0"/>
          </linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#sky)"/>
        <!-- jagged mountain silhouette + textured ground below the sky -->
        <path d="${skylinePath} L640 360 L0 360 Z" fill="#1f2937"/>
        <circle cx="120" cy="260" r="18" fill="#374151"/>
        <circle cx="380" cy="290" r="24" fill="#4b5563"/>
        <rect x="500" y="240" width="60" height="40" fill="#111827"/>
      </svg>`
    const source = await sharp(Buffer.from(svg)).png().toBuffer()

    // Sky segment: full-width band from the top down to the deepest skyline
    // valley (y=178), alpha-masked to the region ABOVE the skyline.
    const skyBox = { left: 0, top: 0, width: 640, height: 178 }
    const skyShape = `${skylinePath} L640 0 L0 0 Z`
    const cutout = await makeCutout(source, skyBox, skyShape)

    const [found] = await locateGrokSegments(source, [cutout])
    expect(found).not.toBeNull()
    const truth = { x: 0, y: 0, w: 1, h: 178 / H }
    expect(found!.bbox.w, "sky must span (near) full width, not a shrunken patch").toBeGreaterThan(0.8)
    expect(iou(found!.bbox, truth)).toBeGreaterThan(0.55)
    // Wide content in a square tile → vertically centered slab in tile coords.
    expect(found!.tile.w).toBeGreaterThan(0.95)
    expect(found!.tile.h).toBeLessThan(0.4)
  }, 30_000)

  it("returns null for a cutout that isn't in the image (never a confident wrong answer)", async () => {
    const source = await makeSource()
    // A flat noise-free foreign tile: uniform color → flat template is refused.
    const foreign = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 90, g: 20, b: 200, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const located = await locateGrokSegments(source, [foreign])
    expect(located[0]).toBeNull()
  }, 30_000)

  it("returns null for a fully transparent cutout", async () => {
    const source = await makeSource()
    const empty = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const located = await locateGrokSegments(source, [empty])
    expect(located[0]).toBeNull()
  }, 30_000)
})
