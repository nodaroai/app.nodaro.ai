/**
 * Text layers for Image Overlay — real typography, rendered as vector glyph
 * paths from the SAME bundled TTF the browser previews with (served at
 * GET /v1/fonts/:file), so the preview and the file agree on every glyph.
 *
 * fontkit lays each line out (shaping, kerning, variable-font weight), the
 * glyph outlines become SVG paths in px, and sharp rasterises the SVG at 1:1
 * — no system fonts, no fontconfig, no drift between machines.
 *
 * RTL: a line containing Hebrew / Arabic is laid out right-to-left; mixed
 * bidi inside ONE line is not reordered (each line is one run).
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as fontkit from "fontkit"
import sharp from "sharp"
import { OVERLAY_MAX_LAYER_EDGE, OVERLAY_PIXEL_LIMIT } from "./overlay-contract.js"
import { OVERLAY_FONTS, isRtlText, overlayFontById, type OverlayTextStyle } from "@nodaro/shared"

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts")

/** Absolute path of a bundled font file, or null for anything not in the registry. */
export function overlayFontPath(fontId: string): string | null {
  const font = overlayFontById(fontId)
  return font ? join(FONTS_DIR, font.file) : null
}

/** Path of a served font file by its registered file name (the /v1/fonts route). */
export function overlayFontFilePath(file: string): string | null {
  const font = OVERLAY_FONTS.find((f) => f.file === file)
  return font ? join(FONTS_DIR, font.file) : null
}

const fontCache = new Map<string, fontkit.Font>()

function loadFont(fontId: string): fontkit.Font {
  const cached = fontCache.get(fontId)
  if (cached) return cached
  const path = overlayFontPath(fontId) ?? overlayFontPath("inter")!
  const opened = fontkit.openSync(path)
  const font = ("fonts" in opened ? (opened as unknown as { fonts: fontkit.Font[] }).fonts[0] : opened) as fontkit.Font
  fontCache.set(fontId, font)
  return font
}

function weightInstance(font: fontkit.Font, weight: number): fontkit.Font {
  const axes = (font as unknown as { variationAxes?: Record<string, unknown> }).variationAxes
  if (axes && "wght" in axes) {
    try {
      return font.getVariation({ wght: weight }) as fontkit.Font
    } catch {
      return font
    }
  }
  return font
}

export interface RenderedTextLayer {
  readonly png: Buffer
  readonly width: number
  readonly height: number
}

interface LaidOutLine {
  readonly paths: string[]
  readonly width: number
}

/**
 * Render a text style into a transparent PNG sized to the text (plus its
 * background box). `baseHeight` scales the font (fontSize is % of it).
 */
export async function renderTextLayer(style: OverlayTextStyle, baseHeight: number): Promise<RenderedTextLayer> {
  const font = weightInstance(loadFont(style.fontId), style.fontWeight)
  const rawLines = (style.uppercase ? style.text.toUpperCase() : style.text).split(/\r?\n/).slice(0, 20)
  const bg = style.background
  const pad = bg ? bg.padding : 0
  const strokeW = style.stroke?.width ?? 0
  const bleed = Math.ceil(strokeW) + 2

  const layout = (fontPx: number) => {
    const scale = fontPx / font.unitsPerEm
    const tracking = style.letterSpacing * fontPx
    const lineStep = style.lineHeight * fontPx
    const lines: LaidOutLine[] = rawLines.map((line) => layoutLine(font, line, scale, tracking))
    const textWidth = Math.max(1, ...lines.map((l) => l.width))
    const ascent = font.ascent * scale
    const descent = Math.abs(font.descent * scale)
    const textHeight = Math.max(1, (lines.length - 1) * lineStep + ascent + descent)
    const width = Math.ceil(textWidth + 2 * pad + 2 * bleed)
    const height = Math.ceil(textHeight + 2 * pad + 2 * bleed)
    return { scale, lineStep, lines, textWidth, ascent, width, height }
  }

  // The schema bounds multiply (fontSize ≤ 50 % of an 8192 base, 20 lines,
  // lineHeight ≤ 2.5) to a sheet far beyond anything the composite can show.
  // Render at the size it will be shown at: shrink the font so the longest
  // edge fits the raster cap, then lay out once more.
  const requestedPx = Math.max(4, (style.fontSize / 100) * baseHeight)
  let laid = layout(requestedPx)
  const longest = Math.max(laid.width, laid.height)
  if (longest > OVERLAY_MAX_LAYER_EDGE) {
    laid = layout(Math.max(4, requestedPx * (OVERLAY_MAX_LAYER_EDGE / longest) * 0.98))
  }
  const { scale, lineStep, lines, textWidth, ascent, width, height } = laid

  const parts: string[] = []
  if (bg) {
    parts.push(
      `<rect x="${bleed}" y="${bleed}" width="${width - 2 * bleed}" height="${height - 2 * bleed}" rx="${Math.min(bg.radius, (height - 2 * bleed) / 2)}" fill="${bg.color}" fill-opacity="${bg.opacity}"/>`,
    )
  }
  const glyphGroups: string[] = []
  lines.forEach((line, i) => {
    const x0 = bleed + pad + (style.align === "left" ? 0 : style.align === "right" ? textWidth - line.width : (textWidth - line.width) / 2)
    const baseline = bleed + pad + ascent + i * lineStep
    glyphGroups.push(`<g transform="translate(${x0} ${baseline}) scale(${scale} ${-scale})">${line.paths.join("")}</g>`)
  })
  // Stroke underneath, fill on top — the classic outlined-caption look
  // without relying on paint-order support in the rasteriser.
  if (style.stroke && strokeW > 0) {
    parts.push(
      `<g fill="none" stroke="${style.stroke.color}" stroke-width="${(2 * strokeW) / scale}" stroke-linejoin="round" stroke-linecap="round">${glyphGroups.join("")}</g>`,
    )
  }
  parts.push(`<g fill="${style.color}">${glyphGroups.join("")}</g>`)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`
  const png = await sharp(Buffer.from(svg), { density: 72, limitInputPixels: OVERLAY_PIXEL_LIMIT }).png().toBuffer()
  return { png, width, height }
}

function layoutLine(font: fontkit.Font, text: string, scale: number, tracking: number): LaidOutLine {
  if (text.length === 0) return { paths: [], width: 0 }
  const rtl = isRtlText(text)
  const run = font.layout(text, undefined, undefined, undefined, rtl ? "rtl" : "ltr")
  const paths: string[] = []
  let x = 0
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i]
    const d = glyph.path.toSVG()
    if (d) paths.push(`<path transform="translate(${(x + pos.xOffset) / 1} ${pos.yOffset})" d="${d}"/>`)
    x += pos.xAdvance + tracking / scale
  })
  // Width in px: advances are font units; tracking was folded in as units.
  const width = x * scale - (tracking > 0 ? tracking : 0)
  return { paths, width: Math.max(0, width) }
}
