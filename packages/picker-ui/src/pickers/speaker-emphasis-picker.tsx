"use client"

import { memo } from "react"
import { SpeakerOptionTile, type SpeakerPickerOption } from "./speaker-option-tile"

/** The atoms of an emphasis value (`scale+border`; `none` or nothing is empty). */
export function speakerEmphasisAtoms(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split("+").map((a) => a.trim()).filter((a) => a && a !== "none"))
}

/**
 * The value after turning one atom on or off: the atoms joined by `+` in the
 * order of `order` (so `border+scale` and `scale+border` never both exist), and
 * `none` when all are off.
 */
export function toggleSpeakerEmphasis(value: string | undefined, atom: string, on: boolean, order: readonly string[]): string {
  const atoms = new Set(speakerEmphasisAtoms(value))
  if (on) atoms.add(atom)
  else atoms.delete(atom)
  const ordered = [...order.filter((a) => atoms.has(a)), ...[...atoms].filter((a) => !order.includes(a))]
  return ordered.length === 0 ? "none" : ordered.join("+")
}

interface SpeakerEmphasisPickerProps {
  readonly options: readonly SpeakerPickerOption[]
  /** A `+`-joined set of atoms, or `none`. */
  readonly value: string | undefined
  readonly onChange: (value: string) => void
  readonly ariaLabel: string
}

/**
 * Speaker View's emphasis toggles (U2): Scale, Border and Dim, alone or
 * together; all off is `none`. A ruled-out atom cannot be turned ON, but one
 * that is already on can always be turned off, so a stored value the layout no
 * longer allows is never stuck.
 */
export const SpeakerEmphasisPicker = memo(function SpeakerEmphasisPicker({ options, value, onChange, ariaLabel }: SpeakerEmphasisPickerProps) {
  const on = speakerEmphasisAtoms(value)
  const order = options.map((o) => o.id)
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-3 gap-1.5">
      {options.map((o) => {
        const checked = on.has(o.id)
        return (
          <SpeakerOptionTile
            key={o.id}
            role="checkbox"
            label={o.label}
            checked={checked}
            disabled={o.disabled === true && !checked}
            reason={o.reason}
           
            onSelect={() => onChange(toggleSpeakerEmphasis(value, o.id, !checked, order))}
          >
            <EmphasisGlyph atom={o.id} />
          </SpeakerOptionTile>
        )
      })}
    </div>
  )
})

function EmphasisGlyph({ atom }: { readonly atom: string }) {
  return (
    <svg viewBox="0 0 48 32" className="stv-diagram" data-emphasis={atom} aria-hidden="true" focusable="false">
      <rect x={2.5} y={4} width={19} height={24} rx={1.5} className={atom === "dim" ? "stv-slot stv-dimmed" : "stv-slot"} />
      <rect
        x={atom === "scale" ? 24.5 : 26.5}
        y={atom === "scale" ? 1.5 : 4}
        width={atom === "scale" ? 21 : 19}
        height={atom === "scale" ? 29 : 24}
        rx={1.5}
        className={atom === "border" ? "stv-slot stv-slot-main stv-bordered" : "stv-slot stv-slot-main"}
      />
    </svg>
  )
}
