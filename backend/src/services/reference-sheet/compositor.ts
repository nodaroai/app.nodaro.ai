import sharp from "sharp"
import type { SheetSkin } from "@nodaro/shared"
import type { ComposeInput, SkinTokens, Slot } from "./types.js"
import { SKIN_TOKENS } from "./types.js"
import { computeLayout, NOTES_WRAP } from "./layout.js"
import { svgText, wrapText, escapeSvgText } from "./svg.js"

const PAD = 32
const GAP = 16
const LABEL_H = 24

/**
 * Render a still reference sheet: lay out the bands, composite each panel buffer
 * into its slot (resize cover), then composite ONE SVG overlay carrying all text,
 * panel labels, header metadata, palette swatches, and notes. Returns a PNG buffer.
 */
export async function composeSheet(input: ComposeInput): Promise<Buffer> {
  const tokens = SKIN_TOKENS[input.skin]
  const layout = computeLayout(input)
  const withText = input.withText ?? true
  const showLabels = input.showLabels ?? true

  // 1. Base canvas.
  const base = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background: tokens.bg,
    },
  })

  // 2. Resize + place every panel image. SKIPPED in background mode: the motion
  // renderer overlays clips into the empty slot rectangles via FFmpeg, so the
  // panel buffers (often empty placeholders in that mode) are intentionally not
  // composited here — only the chrome below (hero + SVG) is drawn.
  //
  // Each resize is independent, so collect them (paired with their placement) in
  // the SAME iteration order the loop would push, run all in parallel, then build
  // `composites` from the awaited results — z-order is identical to the previous
  // sequential push order.
  const resizeJobs: Array<{ buf: Promise<Buffer>; top: number; left: number }> = []
  for (const band of layout.bands) {
    if (input.slotsMode !== "background") {
      const panels = band.section.panels ?? []
      for (let i = 0; i < band.slots.length && i < panels.length; i++) {
        const slot = band.slots[i]
        resizeJobs.push({
          buf: sharp(panels[i].image).resize(slot.w, slot.h, { fit: "cover" }).toBuffer(),
          top: slot.y,
          left: slot.x,
        })
      }
    }
    // Header hero (left thumbnail).
    if (band.section.kind === "header" && band.section.hero) {
      const heroSize = band.height - PAD * 2
      resizeJobs.push({
        buf: sharp(band.section.hero).resize(heroSize, heroSize, { fit: "cover" }).toBuffer(),
        top: band.y + PAD,
        left: PAD,
      })
    }
  }
  const resized = await Promise.all(resizeJobs.map((j) => j.buf))
  const composites: sharp.OverlayOptions[] = resizeJobs.map((j, i) => ({ input: resized[i], top: j.top, left: j.left }))

  // 3. One SVG overlay with all vector text + swatch rects.
  const svg = buildOverlaySvg(layout, tokens, withText, showLabels, input.skin)
  composites.push({ input: Buffer.from(svg), top: 0, left: 0 })

  return base.composite(composites).png().toBuffer()
}

/**
 * The ordered panel slot rectangles (board panels only), in the SAME order the
 * compositor's panel loop places them (`bands.flatMap(slots)`) — which is the
 * resolvePanels/planSheetPanels order. The motion renderer maps the Nth motion
 * clip to the Nth slot, so this order MUST agree with the panel resolution order.
 */
export function sheetSlots(input: ComposeInput): Slot[] {
  const layout = computeLayout(input)
  return layout.bands.flatMap((b) => b.slots)
}

function buildOverlaySvg(
  layout: ReturnType<typeof computeLayout>,
  tokens: SkinTokens,
  withText: boolean,
  showLabels: boolean,
  skin: SheetSkin,
): string {
  const parts: string[] = []
  const f = tokens.fontFamily

  // Skin background chrome (drawn first, beneath all text/panels labels). These
  // fragments use only internal token values — no user input — so escaping does
  // not apply to them.
  if (skin === "blueprint") {
    // Faint engineering grid + corner registration ticks (the "drafting" look).
    const step = 48
    for (let x = step; x < layout.width; x += step) {
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${layout.height}" stroke="${tokens.frame}" stroke-width="0.5" opacity="0.25"/>`)
    }
    for (let y = step; y < layout.height; y += step) {
      parts.push(`<line x1="0" y1="${y}" x2="${layout.width}" y2="${y}" stroke="${tokens.frame}" stroke-width="0.5" opacity="0.25"/>`)
    }
    const tick = 18
    const corners: Array<[number, number]> = [
      [PAD, PAD], [layout.width - PAD, PAD],
      [PAD, layout.height - PAD], [layout.width - PAD, layout.height - PAD],
    ]
    for (const [cx, cy] of corners) {
      parts.push(`<line x1="${cx - tick}" y1="${cy}" x2="${cx + tick}" y2="${cy}" stroke="${tokens.accent}" stroke-width="1.5"/>`)
      parts.push(`<line x1="${cx}" y1="${cy - tick}" x2="${cx}" y2="${cy + tick}" stroke="${tokens.accent}" stroke-width="1.5"/>`)
    }
  }

  for (const band of layout.bands) {
    const s = band.section
    const headingY = band.y + 28

    // Illustrated: a warm tinted header band behind the title (storybook plate).
    // Drawn before the heading text so it reads as a backdrop, not an overlay.
    if (skin === "illustrated" && s.kind === "header") {
      parts.push(`<rect x="0" y="${band.y}" width="${layout.width}" height="${band.height}" fill="${tokens.accent}" opacity="0.06"/>`)
    }

    // Section heading. Structural board labels (EXPRESSIONS, COLOR PALETTE, …)
    // always show; the header band's title is the entity NAME — content text that
    // must honor the `withText` toggle (spec §2: withText = name/role/traits/notes).
    if (s.title && (s.kind !== "header" || withText)) {
      const big = s.kind === "header"
      parts.push(svgText({
        x: PAD, y: headingY, content: s.title, size: big ? 34 : 18,
        fill: tokens.text, family: f, weight: "bold", letterSpacing: big ? 0 : 2,
      }))
      // Cinematic: a short accent rule under each heading (title-card underline).
      if (skin === "cinematic") {
        parts.push(`<rect x="${PAD}" y="${headingY + 6}" width="120" height="3" fill="${tokens.accent}"/>`)
      }
    }
    if (s.subtitle) {
      parts.push(svgText({ x: PAD, y: headingY + 22, content: s.subtitle, size: 13, fill: tokens.subtext, family: f }))
    }

    // Header metadata lines.
    if (s.kind === "header" && withText && s.metadata) {
      let my = band.y + 78
      const left = s.hero ? PAD + (band.height - PAD * 2) + GAP : PAD
      for (const [k, v] of Object.entries(s.metadata)) {
        parts.push(svgText({ x: left, y: my, content: `${k}: ${v}`, size: 15, fill: tokens.subtext, family: f }))
        my += 24
      }
    }

    // Panel caption labels.
    if (showLabels) {
      const panels = s.panels ?? []
      for (let i = 0; i < band.slots.length && i < panels.length; i++) {
        const slot = band.slots[i]
        const label = panels[i].label
        if (label) {
          parts.push(svgText({
            x: slot.x + slot.w / 2, y: slot.y + slot.h + LABEL_H - 8,
            content: label, size: 12, fill: tokens.subtext, family: f, anchor: "middle",
          }))
        }
      }
    }

    // Palette swatches (rects + labels).
    if (s.kind === "palette" && s.swatches) {
      const size = 72
      let sx = PAD
      const sy = band.y + 44
      for (const sw of s.swatches) {
        // Escape the hex too: the compositor must not assume pre-sanitized inputs
        // (§3.2) — a crafted hex would otherwise break out of the attribute.
        parts.push(`<rect x="${sx}" y="${sy}" width="${size}" height="${size}" rx="6" fill="${escapeSvgText(sw.hex)}" stroke="${escapeSvgText(tokens.frame)}"/>`)
        if (showLabels) {
          parts.push(svgText({ x: sx, y: sy + size + 18, content: sw.label, size: 12, fill: tokens.subtext, family: f }))
        }
        sx += size + GAP
      }
    }

    // Notes text (wrapped).
    if (s.kind === "notes" && withText && s.text) {
      const lines = wrapText(s.text, NOTES_WRAP)
      let ny = band.y + 64
      for (const line of lines) {
        parts.push(svgText({ x: PAD, y: ny, content: line, size: 15, fill: tokens.text, family: f }))
        ny += 26
      }
    }
  }

  return `<svg width="${layout.width}" height="${layout.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`
}
