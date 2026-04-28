"use client"

import { useMemo } from "react"
import { Plus } from "lucide-react"
import { pickIds, togglePick } from "@nodaro/shared"
import { cn } from "@/lib/utils"

export type MultiPickValue = string | ReadonlyArray<string> | undefined

export interface UseMultiPickResult {
  readonly selectedIds: ReadonlyArray<string>
  readonly isMulti: boolean
  readonly handlePick: (id: string) => void
  readonly activateMulti: (id: string) => void
  readonly demoteToSingle: (id: string) => void
}

/**
 * Multi-pick state machine shared by every flat picker (Mood, Photographer,
 * Aesthetic, Material, HeldProp, PostProcess, Atmosphere, …). The picker's
 * "mode" is encoded directly in the data shape:
 *   - undefined / string  → single mode (one pick, may be empty)
 *   - string[]            → multi mode (1..maxSelected picks)
 * The user transitions between modes via {@link MultiPickBadge}: a `+` on
 * the selected tile in single mode promotes to `[id]`; a numbered badge in
 * multi mode demotes back to that one id.
 */
export function useMultiPick(
  value: MultiPickValue,
  onChange: (next: MultiPickValue) => void,
  maxSelected: number,
): UseMultiPickResult {
  const selectedIds = useMemo(() => pickIds(value), [value])
  const isMulti = Array.isArray(value)

  const handlePick = (id: string) => {
    if (maxSelected <= 1) {
      onChange(selectedIds[0] === id ? undefined : id)
      return
    }
    if (!isMulti) {
      onChange(selectedIds[0] === id ? undefined : id)
      return
    }
    const next = togglePick(selectedIds, id, maxSelected)
    onChange(next.length === 0 ? undefined : next)
  }

  const activateMulti = (id: string) => {
    onChange([id])
  }

  const demoteToSingle = (id: string) => {
    onChange(id)
  }

  return { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle }
}

interface MultiPickBadgeProps {
  /** Runtime mode based on data shape (string=single, array=multi). */
  readonly mode: "single" | "multi"
  /** 0-based index in the selected list (only used when mode="multi"). */
  readonly index: number
  /** Picker's capacity. Single-mode + (capacity ≤ 1) → no badge rendered. */
  readonly maxSelected: number
  /** User clicked `+` while in single mode → promote to multi. */
  readonly onActivate: () => void
  /** User clicked the number while in multi mode → keep only this id, demote to single. */
  readonly onDemote: () => void
  readonly className?: string
}

/**
 * Badge button shown on the selected tile of a multi-capable picker.
 *
 * Single mode: small `+` button with a tooltip ("Activate multi-select").
 *   Click → caller calls activateMulti(id), data flips from string → [string].
 * Multi mode: 1-based ordinal ("1", "2", …) with a tooltip prompting demote.
 *   Click → caller calls demoteToSingle(id), data flips from array → string.
 *
 * Rendered as a sibling of the tile button (NOT a child) so we don't nest
 * interactive elements. Position (`absolute top-1 right-1`) is anchored to
 * the wrapper div, which must be `relative`.
 */
export function MultiPickBadge({
  mode,
  index,
  maxSelected,
  onActivate,
  onDemote,
  className,
}: MultiPickBadgeProps) {
  if (maxSelected <= 1) return null

  if (mode === "single") {
    // Outlined `+`: transparent inner so the press/active state (filled pink)
    // gives the user a clear "click registered" cue before the badge swaps to
    // the numbered "1" on re-render.
    return (
      <button
        type="button"
        title="Activate multi-select"
        aria-label="Activate multi-select"
        onClick={(e) => {
          e.stopPropagation()
          onActivate()
        }}
        className={cn(
          "absolute top-1 right-1 z-10 size-4 rounded-full",
          "border border-[#ff0073] bg-transparent text-[#ff0073]",
          "flex items-center justify-center transition-colors",
          "hover:bg-[#ff0073]/15 active:bg-[#ff0073] active:text-white",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff0073]",
          className,
        )}
      >
        <Plus className="size-2.5" strokeWidth={3} aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      title="Multi-select activated · click to disable"
      aria-label="Multi-select activated, click to disable"
      onClick={(e) => {
        e.stopPropagation()
        onDemote()
      }}
      className={cn(
        "absolute top-1 right-1 z-10 size-4 rounded-full bg-[#ff0073] text-white",
        "text-[9px] font-semibold flex items-center justify-center transition-colors",
        "hover:bg-[#ff0073]/90 active:bg-transparent active:text-[#ff0073] active:border active:border-[#ff0073]",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff0073]",
        className,
      )}
    >
      {index + 1}
    </button>
  )
}
