"use client"

import { memo, useId } from "react"
import { Switch } from "@/components/ui/switch"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { MultiPickBadge } from "./multi-pick-ui"

export interface SoundDimensionEntry {
  readonly id: string
  readonly label: string
  readonly description: string
}

export interface SoundDimensionSectionProps {
  /** Section heading shown next to the toggle switch. */
  readonly label: string
  /** Tiles to render in the grid. */
  readonly entries: ReadonlyArray<SoundDimensionEntry>
  /** Currently selected ids — length 0 (none), 1 (single), or up to maxSelected. */
  readonly selectedIds: ReadonlyArray<string>
  /** 1 = single-pick. >1 = multi-capable (first pick is single, badge promotes). */
  readonly maxSelected?: number
  /** True when stored value is an array (multi mode). Only relevant for multi-capable sections. */
  readonly isMultiData?: boolean
  /** Section is "checked" (entries clickable). */
  readonly checked: boolean
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
  readonly onActivateMulti?: (id: string) => void
  readonly onDemoteToSingle?: (id: string) => void
  /** Optional emoji / icon string rendered above the label. */
  readonly renderIcon?: (id: string) => React.ReactNode
}

/**
 * Reusable per-dimension section for sound-pickers (Music Genre, Music Mood,
 * Instrumentation, Voice Character, Voice Delivery). Mirrors the visual
 * language of PersonPicker / StylingPicker: large branded headline + Switch
 * toggle + 3-column tile grid + brand-pink (#ff0073) for selected, with a
 * border-t divider between sections.
 *
 * Multi-pick mode (maxSelected > 1) reuses MultiPickBadge so the user can
 * promote a single pick to multi by tapping the `+` badge on the selected
 * tile, mirroring StylingPicker.
 */
export const SoundDimensionSection = memo(function SoundDimensionSection({
  label,
  entries,
  selectedIds,
  maxSelected = 1,
  isMultiData = false,
  checked,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
  onActivateMulti,
  onDemoteToSingle,
  renderIcon,
}: SoundDimensionSectionProps) {
  const id = useId()
  const multi = maxSelected > 1
  const switchId = `${id}-toggle`
  return (
    <div className="flex flex-col gap-2 border-t-[3px] border-border/40">
      <div className="flex items-center justify-between gap-2 px-0.5 mt-5">
        <label
          htmlFor={switchId}
          className={cn(
            "text-[18px] font-semibold uppercase tracking-wide select-none cursor-pointer transition-colors",
            checked ? "text-[#ff0073]" : "text-muted-foreground/60",
          )}
        >
          {label}
          {multi && checked && (
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              pick up to {maxSelected}
            </span>
          )}
        </label>
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={(next) => onToggle(next)}
          aria-label={`Enable ${label}`}
        />
      </div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={label}
        className={cn(
          "grid grid-cols-3 gap-1.5 transition-opacity",
          !checked && "opacity-40",
        )}
      >
        {entries.map((entry) => {
          const selectedIdx = selectedIds.indexOf(entry.id)
          const selected = checked && selectedIdx >= 0
          const entryLabel = resolveLabel(entry.id, entry.label)
          const entryDescription = resolveDescription(entry.id, entry.description)
          return (
            <div key={entry.id} className="relative">
              <button
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={selected}
                title={
                  checked
                    ? entryDescription
                    : `${entryDescription} (toggle on ${label} to pick)`
                }
                onClick={() => onPick(entry.id)}
                className={cn(
                  "w-full flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer",
                  selected
                    ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                    : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                )}
              >
                {renderIcon?.(entry.id)}
                <FitText
                  text={entryLabel}
                  className={cn(
                    "text-[11px] font-medium leading-tight max-w-full",
                    selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                  )}
                />
              </button>
              {multi && selected && onActivateMulti && onDemoteToSingle && (
                <MultiPickBadge
                  mode={isMultiData ? "multi" : "single"}
                  index={selectedIdx}
                  maxSelected={maxSelected}
                  onActivate={() => onActivateMulti(entry.id)}
                  onDemote={() => onDemoteToSingle(entry.id)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
