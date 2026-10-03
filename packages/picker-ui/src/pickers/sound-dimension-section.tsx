"use client"

import { memo, useId, type ReactNode } from "react"
import { Switch } from "../ui/switch"
import { cn } from "../lib/cn"
import { getSoundArt, type SoundArtRef } from "../icons/sound-art"
import { MultiPickBadge } from "./multi-pick-ui"
import { SoundArtTile } from "./sound-art-tile"

export interface SoundDimensionEntry {
  readonly id: string
  readonly label: string
  readonly description: string
}

export interface SoundDimensionSectionProps {
  /** Section heading shown next to the toggle switch. */
  readonly label: string
  /** Which catalog dimension these tiles belong to — resolves each tile's picture. */
  readonly art: SoundArtRef
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
  /** Shown instead of the grid when there is nothing to pick yet (switch disabled). */
  readonly emptyState?: ReactNode
}

/** Header shared by the flat and the tabbed sound sections. */
export function SoundSectionHeader({
  label,
  switchId,
  maxSelected,
  checked,
  switchDisabled,
  onToggle,
}: {
  readonly label: string
  readonly switchId: string
  readonly maxSelected: number
  readonly checked: boolean
  readonly switchDisabled?: boolean
  readonly onToggle: (next: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2.5 px-0.5">
      <label
        htmlFor={switchId}
        className={cn(
          "select-none text-[15px] font-bold uppercase tracking-[.02em] text-[#ff0073] @min-[520px]:text-[17px]",
          switchDisabled ? "cursor-default" : "cursor-pointer",
        )}
      >
        {label}
      </label>
      {maxSelected > 1 && (
        <span className="text-[10px] text-[#6b6b75] dark:text-[#9a9aa6]">pick up to {maxSelected}</span>
      )}
      <div className="flex-1" />
      <Switch
        id={switchId}
        checked={checked}
        disabled={switchDisabled}
        onCheckedChange={(next) => onToggle(next)}
        aria-label={`Enable ${label}`}
        className="data-[state=checked]:bg-[#ff0073]"
      />
    </div>
  )
}

/** The tile grid — auto-fill 80px columns, 128px once the picker is ≥ 520px wide. */
export const SOUND_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1.5 @min-[520px]:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] @min-[520px]:gap-2"

/** Divider + spacing between the topics of a sound picker. */
export const SOUND_SECTION_CLASS = "flex flex-col gap-3 border-t border-[#ececf1] pt-4 dark:border-white/[.07]"

/**
 * Reusable per-dimension section for the sound pickers (Music Genre, Music
 * Mood, Instrumentation, Voice Character, Voice Delivery): pink headline +
 * Switch toggle over a grid of picture tiles (see SoundArtTile).
 *
 * Multi-pick mode (maxSelected > 1) keeps the MultiPickBadge so the user can
 * promote a single pick to multi by tapping the `+` badge on the selected
 * tile, mirroring StylingPicker.
 */
export const SoundDimensionSection = memo(function SoundDimensionSection({
  label,
  art,
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
  emptyState,
}: SoundDimensionSectionProps) {
  const id = useId()
  const multi = maxSelected > 1
  const switchId = `${id}-toggle`
  return (
    <div className={SOUND_SECTION_CLASS}>
      <SoundSectionHeader
        label={label}
        switchId={switchId}
        maxSelected={maxSelected}
        checked={checked}
        switchDisabled={emptyState !== undefined}
        onToggle={onToggle}
      />
      {emptyState !== undefined ? (
        <div className="rounded-xl border-[1.5px] border-dashed border-[#e1e1e8] p-[18px] text-center text-[13px] text-[#6b6b75] dark:border-white/[.11] dark:text-[#9a9aa6]">
          {emptyState}
        </div>
      ) : (
        <div
          role={multi ? "group" : "radiogroup"}
          aria-label={label}
          className={cn(SOUND_GRID_CLASS, "transition-opacity", !checked && "opacity-40")}
        >
          {entries.map((entry) => {
            const selectedIdx = selectedIds.indexOf(entry.id)
            const selected = checked && selectedIdx >= 0
            return (
              <SoundArtTile
                key={entry.id}
                label={resolveLabel(entry.id, entry.label)}
                description={resolveDescription(entry.id, entry.description)}
                art={getSoundArt(art, entry.id)}
                selected={selected}
                checked={checked}
                sectionLabel={label}
                multi={multi}
                onPick={() => onPick(entry.id)}
                badge={
                  multi && selected && onActivateMulti && onDemoteToSingle ? (
                    <MultiPickBadge
                      mode={isMultiData ? "multi" : "single"}
                      index={selectedIdx}
                      maxSelected={maxSelected}
                      onActivate={() => onActivateMulti(entry.id)}
                      onDemote={() => onDemoteToSingle(entry.id)}
                      className="top-1.5 right-1.5"
                    />
                  ) : undefined
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
})
