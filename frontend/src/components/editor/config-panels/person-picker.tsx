"use client"

import { memo, useState } from "react"
import {
  getStickyPersonPickerMode,
  setStickyPersonPickerMode,
  type PersonPickerMode,
} from "@/lib/parameter-node-prefs"
import { cn } from "@/lib/utils"
import { PersonPickerCompact } from "./person-picker-compact"
import { PersonPickerDetailed } from "./person-picker-detailed"
import type { PersonValue } from "@nodaro/shared"

interface PersonPickerProps {
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly className?: string
}

const MODES: ReadonlyArray<{ readonly mode: PersonPickerMode; readonly label: string }> = [
  { mode: "compact", label: "Compact" },
  { mode: "detailed", label: "Detailed" },
]

/** Compact/Detailed view switch — a two-option radiogroup mirroring
 *  AspectRatioSelector's `role="radiogroup"` + `role="radio"` + `aria-checked`
 *  pattern and the `#ff0073` active accent. */
function ModeToggle({
  mode,
  onSelect,
}: {
  readonly mode: PersonPickerMode
  readonly onSelect: (mode: PersonPickerMode) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Person picker view"
      className="grid grid-cols-2 gap-1.5"
    >
      {MODES.map((opt) => {
        const selected = opt.mode === mode
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(opt.mode)}
            className={cn(
              "flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer",
              selected
                ? "border-[#ff0073] bg-[#ff0073]/10 text-white"
                : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] text-gray-600 dark:text-[#94A3B8] hover:border-gray-300 dark:hover:border-[#3D3D3D] hover:text-gray-800 dark:hover:text-[#E2E8F0]",
            )}
          >
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Public Person picker. Owns the persisted Compact/Detailed view mode and a
 * header toggle, then renders the matching view body (PersonPickerCompact or
 * PersonPickerDetailed) over the same PersonValue.
 *
 * Signature is intentionally unchanged ({ value, onChange, className }) — every
 * call site (registry `erase(PersonPicker)`, `parameter-configs.tsx`
 * PersonConfig, character-studio) depends on it. The user-supplied `className`
 * lands on the single outer wrapper div; the inner view bodies bring their own
 * `flex flex-col gap-3` layout, so there is exactly one owner for `className`
 * and no double-wrap.
 */
export const PersonPicker = memo(function PersonPicker({
  value,
  onChange,
  className,
}: PersonPickerProps) {
  // Lazy synchronous init — NEVER an effect (an effect would flip
  // compact↔detailed after first paint on every Person card).
  const [mode, setMode] = useState<PersonPickerMode>(() => getStickyPersonPickerMode())
  const selectMode = (m: PersonPickerMode) => {
    setMode(m)
    setStickyPersonPickerMode(m)
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ModeToggle mode={mode} onSelect={selectMode} />
      {mode === "compact" ? (
        <PersonPickerCompact value={value} onChange={onChange} />
      ) : (
        <PersonPickerDetailed value={value} onChange={onChange} />
      )}
    </div>
  )
})

export { PersonPickerDetailed } from "./person-picker-detailed"
