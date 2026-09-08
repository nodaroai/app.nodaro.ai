/**
 * QR and flat-shape layers for Image Overlay. Both are authored as SVG at the
 * exact target pixel size and rasterised by sharp, so a badge or a QR is as
 * crisp as a vector logo. No user text reaches the SVG string: the QR payload
 * goes through the `qrcode` encoder, colours are regex-validated hex.
 */
import QRCode from "qrcode"
import sharp from "sharp"
import { overlayShapeElement, type OverlayQrStyle, type OverlayShapeStyle } from "@nodaro/shared"

const HEX = /^#[0-9a-fA-F]{6}$/
const safeHex = (v: string | undefined, fallback: string): string => (v && HEX.test(v) ? v : fallback)

/** A QR code as a transparent (or solid-background) PNG, `size` px square. */
export async function renderQrLayer(style: OverlayQrStyle, size: number): Promise<Buffer> {
  const px = Math.max(16, Math.round(size))
  let svg: string
  try {
    svg = await QRCode.toString(style.text, {
      type: "svg",
      margin: Math.max(0, Math.min(8, Math.round(style.margin))),
      color: {
        dark: safeHex(style.color, "#000000"),
        light: style.background ? safeHex(style.background, "#ffffff") : "#00000000",
      },
      width: px,
    })
  } catch (err) {
    // The encoder's own limit is bytes at the chosen error-correction level —
    // a long non-Latin payload overflows well under the schema's 2,000 chars.
    throw new Error(`This QR payload is too long to encode (${style.text.length} characters) — shorten the link or use a URL shortener`, { cause: err })
  }
  return sharp(Buffer.from(svg), { density: 72 }).resize(px, px, { fit: "fill", kernel: "nearest" }).png().toBuffer()
}

/** A flat shape at w×h px — the geometry shared with the editor's preview. */
export async function renderShapeLayer(style: OverlayShapeStyle, w: number, h: number): Promise<Buffer> {
  const width = Math.max(2, Math.round(w))
  const height = Math.max(2, Math.round(h))
  const fill = safeHex(style.color, "#ff0073")
  const strokeW = style.stroke ? Math.max(0, Math.min(50, style.stroke.width)) : 0
  const strokeAttr = strokeW > 0 ? ` stroke="${safeHex(style.stroke!.color, "#000000")}" stroke-width="${strokeW}"` : ""
  const el = overlayShapeElement(style.shape, width, height, strokeW / 2)
  const attrs = Object.entries(el.attrs).map(([k, v]) => `${k}="${v}"`).join(" ")
  const body = `<${el.tag} ${attrs} fill="${fill}"${strokeAttr}/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  return sharp(Buffer.from(svg), { density: 72 }).png().toBuffer()
}
