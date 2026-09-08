/**
 * Finishing effects for IMAGE layers of Image Overlay — applied to the
 * rasterised layer PNG (already at its target size) before rotation:
 *
 *   circle mask — cut the layer to an ellipse inscribed in its box (avatars)
 *   feather     — fade the edges over N px (blend a cut-out into a backdrop)
 *   stroke      — an outline around the layer's silhouette (sticker look)
 *   glow        — a soft coloured halo under the layer (a shadow with no offset)
 *
 * Everything is alpha arithmetic on our own buffers; no user string reaches
 * an SVG. Sizes are px on the base image, the same unit the shadow uses.
 */
import sharp from "sharp"
import type { OverlayImageEffects } from "@nodaro/shared"

const HEX = /^#[0-9a-fA-F]{6}$/
function rgb(hex: string): { r: number; g: number; b: number } {
  const raw = HEX.test(hex) ? hex.slice(1) : "000000"
  return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) }
}

async function size(png: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(png).metadata()
  return { w: m.width ?? 1, h: m.height ?? 1 }
}

/** Keep only the ellipse inscribed in the layer box. */
export async function applyCircleMask(png: Buffer): Promise<Buffer> {
  const { w, h } = await size(png)
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#fff"/></svg>`)
  return sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer()
}

/** Fade the layer's edges to transparent over `feather` px. */
export async function applyFeather(png: Buffer, feather: number): Promise<Buffer> {
  const { w, h } = await size(png)
  const f = Math.max(1, Math.min(feather, Math.floor(Math.min(w, h) / 2) - 1))
  if (f <= 0) return png
  // A white rectangle inset by the feather, blurred by half of it, is a mask
  // that is fully opaque in the middle and reaches zero at the edge.
  const inner = await sharp({ create: { width: Math.max(1, w - 2 * f), height: Math.max(1, h - 2 * f), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .png()
    .toBuffer()
  const mask = await sharp(inner)
    .extend({ top: f, bottom: f, left: f, right: f, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(0.3, f / 2))
    .png()
    .toBuffer()
  return sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer()
}

/**
 * An outline around the layer's silhouette: the alpha channel is dilated by
 * `width` px (pad → blur → threshold) and filled with the stroke colour; the
 * caller composites the result UNDER the layer.
 */
export async function buildStroke(png: Buffer, width: number, color: string): Promise<{ png: Buffer; pad: number }> {
  const pad = Math.ceil(Math.max(1, width))
  const { w, h } = await size(png)
  const alpha = await sharp(png)
    .ensureAlpha()
    .extractChannel(3)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0 } })
    .blur(Math.max(0.3, width / 1.5))
    .threshold(6)
    .toBuffer()
  const { r, g, b } = rgb(color)
  const stroke = await sharp({ create: { width: w + 2 * pad, height: h + 2 * pad, channels: 3, background: { r, g, b } } })
    .joinChannel(alpha)
    .png()
    .toBuffer()
  return { png: stroke, pad }
}

/** A soft halo in the layer's silhouette — a shadow with no offset. */
export async function buildGlow(png: Buffer, glow: NonNullable<OverlayImageEffects["glow"]>): Promise<{ png: Buffer; pad: number }> {
  const pad = Math.ceil(glow.blur * 3)
  const { w, h } = await size(png)
  const { r, g, b } = rgb(glow.color)
  const silhouette = await sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } })
    .composite([{ input: png, blend: "dest-in" }])
    .png()
    .toBuffer()
  const halo = await sharp(silhouette)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(0.3, glow.blur))
    .png()
    .toBuffer()
  const { width: hw = 1, height: hh = 1 } = await sharp(halo).metadata()
  const veil = await sharp({ create: { width: hw, height: hh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: glow.opacity } } }).png().toBuffer()
  const faded = await sharp(halo).composite([{ input: veil, blend: "dest-in" }]).png().toBuffer()
  return { png: faded, pad }
}
