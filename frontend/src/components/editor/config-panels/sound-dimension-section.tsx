"use client"

import { memo, useId } from "react"
import type { I18nCatalogId } from "@nodaro/shared"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { MultiPickBadge } from "./multi-pick-ui"

export interface SoundDimensionEntry {
  readonly id: string
  readonly label: string
  readonly description: string
}

export interface SoundDimensionSectionProps {
  /** Section heading shown next to the toggle checkbox. */
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
  /** Catalog used for i18n label / description resolution. */
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
  /** Promote single → multi (only invoked when maxSelected > 1). */
  readonly onActivateMulti?: (id: string) => void
  /** Demote multi → single (only invoked when maxSelected > 1). */
  readonly onDemoteToSingle?: (id: string) => void
  /** Optional emoji / icon string rendered above the label. */
  readonly renderIcon?: (id: string) => React.ReactNode
}

/**
 * Reusable per-dimension section for sound-pickers (Music Genre, Music Mood,
 * Instrumentation, Voice Character, Voice Delivery). Mirrors the visual
 * language of ExposureSettingsPicker / StylingPicker: checkbox-toggleable
 * heading + 3-column tile grid, brand-pink (#ff0073) for selected.
 *
 * Multi-pick mode (maxSelected > 1) reuses MultiPickBadge so the user can
 * promote a single pick to multi by tapping the `+` badge on the selected
 * tile, mirroring StylingPicker.
 *
 * Catalog-id is not required here — the parent picker resolves localized
 * label/description and passes the resolvers in (so the section stays a
 * pure presentational component).
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
  const heading = multi ? `${label} (pick up to ${maxSelected})` : label
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <input
          type="checkbox"
          id={`${id}-toggle`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-muted-foreground/40"
        />
        <label
          htmlFor={`${id}-toggle`}
          className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground select-none cursor-pointer"
        >
          {heading}
        </label>
      </div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={heading}
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
                    : `${entryDescription} (click to enable ${label})`
                }
                onClick={() => onPick(entry.id)}
                className={cn(
                  "w-full flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden min-h-[44px]",
                  selected
                    ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                    : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                )}
              >
                {renderIcon?.(entry.id)}
                <FitText
                  text={entryLabel}
                  className={cn(
                    "text-[11px] font-semibold leading-tight",
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

/** Catalog id constants re-exported for the sound picker family. */
export const SOUND_CATALOG_IDS = {
  musicGenre: "music-genre" as const,
  musicMood: "music-mood" as const,
  instrumentation: "instrumentation" as const,
  voiceCharacter: "voice-character" as const,
  voiceDelivery: "voice-delivery" as const,
} satisfies Record<string, I18nCatalogId>
