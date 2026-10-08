"use client"

import { memo } from "react"
import { EDL_TARGET_ASPECTS } from "@nodaro/shared"
import { SpeakerOptionTile, type SpeakerPickerOption } from "./speaker-option-tile"

/** The box a diagram is drawn in (viewBox units). */
const BOX_W = 48
const BOX_H = 32
const PAD = 2.5
const GAP = 1.5

export interface DiagramRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface SpeakerLayoutDiagram {
  /** The output canvas, fitted into the box at the aspect it is drawn for. */
  readonly width: number
  readonly height: number
  readonly slots: readonly DiagramRect[]
}

const parseAspect = (aspect: string): number => {
  const m = /^(\d+):(\d+)$/.exec(aspect)
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 16 / 9
}

const cells = (cols: number, rows: number, w: number, h: number): DiagramRect[] => {
  const cw = (w - PAD * 2 - GAP * (cols - 1)) / cols
  const ch = (h - PAD * 2 - GAP * (rows - 1)) / rows
  const out: DiagramRect[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: PAD + c * (cw + GAP), y: PAD + r * (ch + GAP), w: cw, h: ch })
  return out
}

/**
 * Where a layout puts its speakers, on a canvas of the given aspect: the slot
 * rectangles in viewBox units. Pure, so a tile is drawn the way the render will
 * be (Stacked on 9:16 is two tall halves, on 1:1 two wide ones). An id the
 * picker does not know is drawn as one slot rather than nothing.
 */
export function speakerLayoutDiagram(layout: string, aspect: string): SpeakerLayoutDiagram {
  const ratio = parseAspect(aspect)
  const width = ratio >= BOX_W / BOX_H ? BOX_W : BOX_H * ratio
  const height = ratio >= BOX_W / BOX_H ? BOX_W / ratio : BOX_H
  let slots: DiagramRect[]
  switch (layout) {
    case "side-by-side":
      slots = cells(2, 1, width, height)
      break
    case "stacked":
      slots = cells(1, 2, width, height)
      break
    case "grid":
      slots = cells(2, 2, width, height)
      break
    case "pip": {
      const [main] = cells(1, 1, width, height)
      const w = main!.w * 0.34
      const h = main!.h * 0.34
      slots = [main!, { x: main!.x + main!.w - w - GAP, y: main!.y + main!.h - h - GAP, w, h }]
      break
    }
    default:
      slots = cells(1, 1, width, height)
  }
  return { width, height, slots }
}

interface SpeakerLayoutPickerProps {
  readonly options: readonly SpeakerPickerOption[]
  readonly value: string
  /** The output aspect the diagrams are drawn at. */
  readonly aspect: string
  readonly onChange: (id: string) => void
  readonly ariaLabel: string
}

/**
 * Speaker View's layout tiles (U2): Auto, Single, Side by side, Stacked, Grid,
 * Picture in picture, each with a diagram drawn at the output's aspect. A
 * layout the aspect or the speaker count rules out is greyed with its reason
 * (SV3); everything it shows comes from its props, so the panel, the quick
 * strip and the run read one rule.
 */
export const SpeakerLayoutPicker = memo(function SpeakerLayoutPicker({ options, value, aspect, onChange, ariaLabel }: SpeakerLayoutPickerProps) {
  const safeAspect = (EDL_TARGET_ASPECTS as readonly string[]).includes(aspect) ? aspect : "16:9"
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-3 gap-1.5">
      {options.map((o) => (
        <SpeakerOptionTile key={o.id} role="radio" label={o.label} checked={o.id === value} disabled={o.disabled} reason={o.reason} onSelect={() => onChange(o.id)}>
          <LayoutDiagram layout={o.id} aspect={safeAspect} />
        </SpeakerOptionTile>
      ))}
    </div>
  )
})

function LayoutDiagram({ layout, aspect }: { readonly layout: string; readonly aspect: string }) {
  const d = speakerLayoutDiagram(layout, aspect)
  const ox = (BOX_W - d.width) / 2
  const oy = (BOX_H - d.height) / 2
  const auto = layout === "auto"
  return (
    <svg viewBox={`0 0 ${BOX_W} ${BOX_H}`} className="stv-diagram" data-layout={layout} aria-hidden="true" focusable="false">
      <g transform={`translate(${ox} ${oy})`}>
        <rect data-canvas="" x={0} y={0} width={d.width} height={d.height} rx={2} className="stv-canvas" />
        {d.slots.map((s, i) => (
          <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={1} className={auto ? "stv-slot stv-slot-auto" : i === 0 ? "stv-slot stv-slot-main" : "stv-slot"} />
        ))}
      </g>
    </svg>
  )
}
