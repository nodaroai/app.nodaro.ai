// @reads-none draws from the bytes it is handed; reads no file
/**
 * Draws a share card's picture: 1200 × 630, JPEG, under 300 KB (plan.ts).
 * Takes the bytes of what it shows (sources.ts loads them) and never fetches
 * anything itself. A source that does not decode is drawn as if absent.
 */
import sharp from "sharp"
import { CARD_IMAGE_HEIGHT as H, CARD_IMAGE_MAX_BYTES, CARD_IMAGE_WIDTH as W } from "./plan.js"
import { drawableTitle, escapeMarkup, isRightToLeft } from "./text.js"

export type LoadedPicture =
  | { readonly kind: "picture"; readonly image: Buffer | null }
  | { readonly kind: "video"; readonly frame: Buffer | null }
  | { readonly kind: "sound"; readonly art: Buffer | null; readonly title: string | null }
  | { readonly kind: "grid"; readonly images: readonly Buffer[] }

interface Layer {
  readonly input: Buffer
  readonly top: number
  readonly left: number
  readonly blend?: sharp.Blend
}

const BRAND_BG = "#0B0B0F"
const ACCENT = "#FF2E5B"
const FONT = "DejaVu Sans"

/** The brand's background: near black with a soft accent glow. */
function brandBackgroundSvg(): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><radialGradient id="g" cx="82%" cy="18%" r="75%"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.38"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>
<radialGradient id="h" cx="10%" cy="100%" r="70%"><stop offset="0" stop-color="#5B3DF5" stop-opacity="0.30"/><stop offset="1" stop-color="#5B3DF5" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${BRAND_BG}"/><rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#h)"/></svg>`,
  )
}

/** The brand's mark (a rounded tile with its letter and dot), `size` pixels square. */
function markSvg(size: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}"><rect width="128" height="128" rx="30" fill="#FFFFFF"/><path d="M44 100 L44 59.87 L104 125.87 L104 34 L84 34 L84 74.14 L24 8.13 L24 100 Z" fill="#000000"/><circle cx="94" cy="34" r="9" fill="${ACCENT}"/></svg>`,
  )
}

/** The small "Nodaro" tag in a corner of every card. */
function wordmarkSvg(): { svg: Buffer; width: number; height: number } {
  const width = 196
  const height = 56
  return {
    width,
    height,
    svg: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="28" fill="#000000" fill-opacity="0.55"/>
<g transform="translate(12,10) scale(0.28125)"><rect width="128" height="128" rx="30" fill="#FFFFFF"/><path d="M44 100 L44 59.87 L104 125.87 L104 34 L84 34 L84 74.14 L24 8.13 L24 100 Z" fill="#000000"/><circle cx="94" cy="34" r="9" fill="${ACCENT}"/></g>
<text x="62" y="37" font-family="${FONT}" font-weight="bold" font-size="25" fill="#FFFFFF">Nodaro</text></svg>`,
    ),
  }
}

/** A round play badge, `size` pixels across. */
function playBadgeSvg(size: number): Buffer {
  const r = size / 2
  const tri = size * 0.36
  const cx = r + tri * 0.12
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 3}" fill="#000000" fill-opacity="0.55" stroke="#FFFFFF" stroke-width="5"/>
<path d="M ${cx - tri / 2} ${r - tri * 0.58} L ${cx + tri * 0.62} ${r} L ${cx - tri / 2} ${r + tri * 0.58} Z" fill="#FFFFFF"/></svg>`,
  )
}

function roundedMaskSvg(w: number, h: number, radius: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#FFFFFF"/></svg>`)
}

/** Decodes a source, or null when it does not (a broken or unsupported file). */
async function decodable(input: Buffer | null): Promise<Buffer | null> {
  if (!input) return null
  try {
    const meta = await sharp(input, { failOn: "error" }).metadata()
    return meta.width && meta.height ? input : null
  } catch {
    return null
  }
}

/** `input` resized to cover w × h (cropped to fill), as PNG. */
function cover(input: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(input, { failOn: "none" }).rotate().resize(w, h, { fit: "cover", position: "attention" }).png().toBuffer()
}

/** A blurred, darkened fill of `input` over the whole card. */
function blurredFill(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" }).rotate().resize(W, H, { fit: "cover" }).blur(36).modulate({ brightness: 0.45 }).png().toBuffer()
}

/** `input` whole (never cropped), as large as fits, centred on the card. */
async function contained(input: Buffer): Promise<Layer> {
  const { data, info } = await sharp(input, { failOn: "none" }).rotate().resize(W, H, { fit: "inside" }).png().toBuffer({ resolveWithObject: true })
  return { input: data, left: Math.round((W - info.width) / 2), top: Math.round((H - info.height) / 2) }
}

function centred(input: Buffer, size: number, box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: W, h: H }): Layer {
  return { input, left: Math.round(box.x + (box.w - size) / 2), top: Math.round(box.y + (box.h - size) / 2) }
}

function wordmark(): Layer {
  const mark = wordmarkSvg()
  return { input: mark.svg, left: W - mark.width - 28, top: H - mark.height - 26 }
}

/** The title as a text layer at most `w` × `h`, the largest size that fits, or null. */
async function titleLayer(title: string, w: number, h: number): Promise<{ input: Buffer; width: number; height: number } | null> {
  const rtl = isRightToLeft(title)
  for (const size of [52, 44, 36, 30]) {
    try {
      const { data, info } = await sharp({
        text: {
          text: `<span foreground="#FFFFFF">${escapeMarkup(title)}</span>`,
          font: `${FONT} Bold ${size}`,
          dpi: 72,
          width: w,
          rgba: true,
          wrap: "word-char",
          align: rtl ? "right" : "left",
          spacing: Math.round(size * 0.25),
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true })
      if (info.height <= h || size === 30) {
        const fitted = info.height <= h ? data : await sharp(data).extract({ left: 0, top: 0, width: info.width, height: h }).png().toBuffer()
        return { input: fitted, width: info.width, height: Math.min(info.height, h) }
      }
    } catch {
      return null
    }
  }
  return null
}

async function base(background: Buffer | null): Promise<sharp.Sharp> {
  const bg = background ?? brandBackgroundSvg()
  return sharp(await sharp(bg).resize(W, H).png().toBuffer())
}

async function pictureLayers(image: Buffer | null, badge: boolean): Promise<{ background: Buffer | null; layers: Layer[] }> {
  if (!image) return { background: null, layers: [centred(markSvg(220), 220), ...(badge ? [centred(playBadgeSvg(132), 132, { x: 0, y: 0, w: W, h: H })] : [])] }
  const layers: Layer[] = [await contained(image)]
  if (badge) layers.push(centred(playBadgeSvg(132), 132))
  return { background: await blurredFill(image), layers }
}

async function soundLayers(art: Buffer | null, title: string | null): Promise<{ background: Buffer | null; layers: Layer[] }> {
  const drawn = drawableTitle(title)
  const side = 450
  // With no title to draw, the art (or the mark) stands alone in the middle.
  const artBox = drawn ? { x: 90, y: (H - side) / 2 } : { x: (W - side) / 2, y: (H - side) / 2 }
  const square = art
    ? await sharp(await cover(art, side, side)).composite([{ input: roundedMaskSvg(side, side, 36), blend: "dest-in" }]).png().toBuffer()
    : await sharp(markSvg(side)).png().toBuffer()
  const layers: Layer[] = [
    { input: square, left: Math.round(artBox.x), top: Math.round(artBox.y) },
    centred(playBadgeSvg(120), 120, { x: artBox.x, y: artBox.y, w: side, h: side }),
  ]
  if (drawn) {
    const textW = W - (artBox.x + side + 60) - 80
    const text = await titleLayer(drawn, textW, 330)
    if (text) layers.push({ input: text.input, left: Math.round(artBox.x + side + 60), top: Math.round((H - text.height) / 2) - 20 })
  }
  return { background: art ? await blurredFill(art) : null, layers }
}

/** Cells of a grid of `n` pictures (1–4). */
function gridCells(n: number): Array<{ x: number; y: number; w: number; h: number }> {
  const half = W / 2
  if (n === 1) return [{ x: 0, y: 0, w: W, h: H }]
  if (n === 2) return [{ x: 0, y: 0, w: half, h: H }, { x: half, y: 0, w: half, h: H }]
  if (n === 3) return [{ x: 0, y: 0, w: half, h: H }, { x: half, y: 0, w: half, h: H / 2 }, { x: half, y: H / 2, w: half, h: H / 2 }]
  return [
    { x: 0, y: 0, w: half, h: H / 2 },
    { x: half, y: 0, w: half, h: H / 2 },
    { x: 0, y: H / 2, w: half, h: H / 2 },
    { x: half, y: H / 2, w: half, h: H / 2 },
  ]
}

const GAP = 6

async function gridLayers(images: readonly Buffer[]): Promise<{ background: Buffer | null; layers: Layer[] }> {
  if (images.length === 0) return { background: null, layers: [centred(markSvg(220), 220)] }
  if (images.length === 1) return pictureLayers(images[0]!, false)
  const cells = gridCells(images.length)
  const layers = await Promise.all(
    cells.map(async (c, i) => {
      const w = Math.round(c.w - (c.x > 0 ? GAP / 2 : 0) - (c.x + c.w < W ? GAP / 2 : 0))
      const h = Math.round(c.h - (c.y > 0 ? GAP / 2 : 0) - (c.y + c.h < H ? GAP / 2 : 0))
      return { input: await cover(images[i]!, w, h), left: Math.round(c.x + (c.x > 0 ? GAP / 2 : 0)), top: Math.round(c.y + (c.y > 0 ? GAP / 2 : 0)) }
    }),
  )
  return { background: null, layers }
}

/** Encodes the composed card as JPEG under the size budget, lowering the quality as needed. */
async function encode(composed: Buffer): Promise<Buffer> {
  let last: Buffer | null = null
  for (const quality of [84, 76, 68, 60, 52, 44, 36]) {
    last = await sharp(composed).flatten({ background: BRAND_BG }).jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer()
    if (last.length <= CARD_IMAGE_MAX_BYTES) return last
  }
  // A picture this noisy is shrunk until it fits.
  return sharp(last!).resize(W, H).jpeg({ quality: 30, mozjpeg: true }).toBuffer()
}

/** The card's picture: 1200 × 630 JPEG, at most 300 KB. */
export async function renderCardImage(picture: LoadedPicture): Promise<Buffer> {
  let plan: { background: Buffer | null; layers: Layer[] }
  if (picture.kind === "picture") plan = await pictureLayers(await decodable(picture.image), false)
  else if (picture.kind === "video") plan = await pictureLayers(await decodable(picture.frame), true)
  else if (picture.kind === "sound") plan = await soundLayers(await decodable(picture.art), picture.title)
  else {
    const images = (await Promise.all(picture.images.map((i) => decodable(i)))).filter((i): i is Buffer => i !== null)
    plan = await gridLayers(images)
  }
  const canvas = await base(plan.background)
  const composed = await canvas.composite([...plan.layers, wordmark()]).png().toBuffer()
  return encode(composed)
}

/** The brand's card: what a link shows before its own picture is ready (frontend/public/share-card.jpg). */
export function renderBrandCard(): Promise<Buffer> {
  return renderCardImage({ kind: "grid", images: [] })
}
