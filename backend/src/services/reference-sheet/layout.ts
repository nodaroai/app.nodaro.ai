import type { ComposeInput, ResolvedSection, Slot } from "./types.js"
import { CANVAS_WIDTH, GRID_COLUMNS } from "./types.js"
import { wrapText } from "./svg.js"

const PAD = 32
const GAP = 16
const HEADING_H = 40
const LABEL_H = 24
const HEADER_H = 220
const PALETTE_H = 140
const NOTES_LINE_H = 26
/** Chars-per-line budget for notes — shared by layout sizing and the renderer. */
export const NOTES_WRAP = 90

/**
 * Per-board cell aspect ratio (width / height), matched to the aspect each board's
 * panels are generated at (generate-*-asset `resolveCharacterAspectRatio` etc.):
 * head 3:4, body/poses 9:16, expressions/materials/variations/details square,
 * location coverage/environment 16:9. Without this every board used a SQUARE cell,
 * so portrait full-body / pose / wardrobe panels were squashed and cropped. The
 * compositor pairs this with `fit: "contain"`, so a panel whose real aspect
 * deviates from its cell is letterboxed, never cut.
 */
const SECTION_CELL_ASPECT: Record<string, number> = {
  "head-turnaround": 3 / 4,
  "body-turnaround": 9 / 16,
  "pose-board": 9 / 16,
  "wardrobe-board": 3 / 4,
  "expression-board": 1,
  "material-board": 1,
  "variation-board": 1,
  "detail-board": 1,
  turnaround: 1,
  coverage: 16 / 9,
  "environment-board": 16 / 9,
}
const DEFAULT_CELL_ASPECT = 1

/** A band placed at an absolute y with its panel slots (board bands) or a fixed height. */
export interface PlacedBand {
  section: ResolvedSection
  y: number
  height: number
  slots: Slot[]
}

export interface Layout {
  width: number
  height: number
  bands: PlacedBand[]
}

/** Pure geometry: stack bands top→bottom, compute panel slots for board bands.
 *  Any section that isn't header/palette/notes/scale is treated as a wrapping
 *  grid of square panels (board / turnaround / detail / wardrobe). */
export function computeLayout(input: ComposeInput): Layout {
  const width = CANVAS_WIDTH[input.aspect]
  const cols = GRID_COLUMNS[input.aspect]
  const innerW = width - PAD * 2
  let y = PAD
  const bands: PlacedBand[] = []

  for (const section of input.sections) {
    const slots: Slot[] = []
    let height: number

    if (section.kind === "header") {
      height = HEADER_H
    } else if (section.kind === "palette") {
      height = PALETTE_H
    } else if (section.kind === "notes") {
      // Use the SAME word-wrap the renderer uses so reserved height can't drift
      // from drawn lines.
      const lines = section.text ? Math.max(1, wrapText(section.text, NOTES_WRAP).length) : 1
      height = HEADING_H + lines * NOTES_LINE_H + PAD
    } else if (section.kind === "scale") {
      height = HEADING_H + LABEL_H + PAD
    } else {
      // board / turnaround / detail / wardrobe → a wrapping grid. Cell height is
      // driven by the board's panel aspect (SECTION_CELL_ASPECT) so portrait
      // full-body / pose / wardrobe panels aren't squashed into squares. The
      // compositor fits panels with `contain`, so a deviating panel is letterboxed
      // (never cropped).
      const n = section.panels?.length ?? 0
      const cellW = Math.floor((innerW - GAP * (cols - 1)) / cols)
      const cellH = Math.round(cellW / (SECTION_CELL_ASPECT[section.kind] ?? DEFAULT_CELL_ASPECT))
      const rows = Math.max(1, Math.ceil(n / cols))
      const gridTop = y + HEADING_H
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols)
        const col = i % cols
        slots.push({
          x: PAD + col * (cellW + GAP),
          y: gridTop + row * (cellH + LABEL_H + GAP),
          w: cellW,
          h: cellH,
        })
      }
      height = HEADING_H + rows * (cellH + LABEL_H + GAP)
    }

    bands.push({ section, y, height, slots })
    y += height
  }

  return { width, height: y + PAD, bands }
}
