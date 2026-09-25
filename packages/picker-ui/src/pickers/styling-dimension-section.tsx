"use client"

import { useId } from "react"
import { STYLING_DIMENSION_LABELS, type Styling, type StylingDimension } from "@nodaro/prompts"
import { Switch } from "../ui/switch"
import { FitText } from "../ui/fit-text"
import { cn } from "../lib/cn"
import { HairCutBrowser } from "./hair-cut-browser"
import { EyewearIcon, HeadwearIcon } from "../previews/small-silhouette-icons"
import { MultiPickBadge } from "./multi-pick-ui"
import { CharacterArtTile, characterArtGridClass } from "./character-art-tile"
import type { CharacterArtShape } from "../icons/character-art"

/** The drawn icon of a styling option, where the catalog has one (photo fallback). */
function entryIcon(dimension: StylingDimension, id: string, className: string) {
  if (dimension === "eyewear") return <EyewearIcon eyewearId={id} className={className} />
  if (dimension === "headwear") return <HeadwearIcon headwearId={id} className={className} />
  return null
}

interface Resolvers {
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
}

export interface StylingDimensionSectionProps extends Resolvers {
  readonly dimension: StylingDimension
  readonly entries: ReadonlyArray<Styling>
  readonly checked: boolean
  readonly selectedIds: ReadonlyArray<string>
  readonly maxSelected: number
  /** True when the stored field is currently an array (multi mode). */
  readonly isMultiData: boolean
  /** Set when the dimension shows photos: its tiles become photo tiles of this shape. */
  readonly photoShape?: CharacterArtShape
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
  readonly onActivateMulti: (id: string) => void
  readonly onDemoteToSingle: (id: string) => void
}

interface EntryTileProps extends Resolvers {
  readonly dimension: StylingDimension
  readonly entry: Styling
  readonly sectionLabel: string
  readonly checked: boolean
  readonly selectedIndex: number
  readonly multi: boolean
  readonly isMultiData: boolean
  readonly maxSelected: number
  readonly photoShape?: CharacterArtShape
  readonly onPick: (id: string) => void
  readonly onActivateMulti: (id: string) => void
  readonly onDemoteToSingle: (id: string) => void
}

/** One option: a photo tile when the setting has photos, else the compact chip. */
function EntryTile({ dimension, entry, sectionLabel, checked, selectedIndex, multi, isMultiData, maxSelected, photoShape, resolveLabel, resolveDescription, onPick, onActivateMulti, onDemoteToSingle }: EntryTileProps) {
  const selected = checked && selectedIndex >= 0
  const label = resolveLabel(entry.id, entry.label)
  const description = resolveDescription(entry.id, entry.description)
  const title = checked ? description : `${description} (click to enable ${sectionLabel})`
  const badge = (className?: string) =>
    multi && selected ? (
      <MultiPickBadge
        mode={isMultiData ? "multi" : "single"}
        index={selectedIndex}
        maxSelected={maxSelected}
        onActivate={() => onActivateMulti(entry.id)}
        onDemote={() => onDemoteToSingle(entry.id)}
        className={className}
      />
    ) : undefined

  if (photoShape) {
    return (
      <CharacterArtTile
        family="styling"
        id={entry.id}
        shape={photoShape}
        label={label}
        title={title}
        selected={selected}
        multi={multi}
        onPick={() => onPick(entry.id)}
        fallback={entryIcon(dimension, entry.id, "size-10 text-gray-500 dark:text-[#9a9aa4]")}
        // Over a photo the outlined `+` needs a ground to read.
        badge={badge(cn("top-[5px] right-[5px]", !isMultiData && "bg-white dark:bg-[#111114]"))}
      />
    )
  }
  return (
    <div className="relative">
      <button
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        title={title}
        onClick={() => onPick(entry.id)}
        className={cn(
          "w-full flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
          selected
            ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
            : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
        )}
      >
        {entryIcon(dimension, entry.id, "size-6")}
        <FitText
          text={label}
          className={cn("text-[11px] font-medium leading-tight max-w-full", selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]")}
        />
      </button>
      {badge()}
    </div>
  )
}

/**
 * One Styling setting, in the music pickers' section shape: pink headline,
 * "pick up to N" for a multi-pick setting, the enable switch, then its options.
 */
export function StylingDimensionSection({ dimension, entries, checked, selectedIds, maxSelected, isMultiData, photoShape, resolveLabel, resolveDescription, onToggle, onPick, onActivateMulti, onDemoteToSingle }: StylingDimensionSectionProps) {
  const switchId = `${useId()}-${dimension}`
  const baseLabel = STYLING_DIMENSION_LABELS[dimension]
  const multi = maxSelected > 1
  const label = multi ? `${baseLabel} (pick up to ${maxSelected})` : baseLabel
  return (
    <div className="flex flex-col gap-3 border-t border-[#ececf1] pt-4 dark:border-white/[.07]">
      <div className="flex items-center gap-2.5 px-0.5">
        <label
          htmlFor={switchId}
          className={cn(
            "cursor-pointer select-none text-[15px] font-bold uppercase tracking-[.02em] transition-colors @min-[520px]:text-[17px]",
            checked ? "text-[#ff0073]" : "text-muted-foreground/60",
          )}
        >
          {baseLabel}
        </label>
        {multi && <span className="text-[10px] text-[#6b6b75] dark:text-[#9a9aa6]">pick up to {maxSelected}</span>}
        <div className="flex-1" />
        {/* Hair Cut has 45 entries — the "Pick by look" pill opens the modal
            with silhouettes so users can browse by shape as well. */}
        {dimension === "hair-cut" && (
          <HairCutBrowser variant="compact" value={checked ? selectedIds[0] : undefined} onChange={(id) => id && onPick(id)} />
        )}
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Enable ${baseLabel}`}
          className="data-[state=checked]:bg-[#ff0073]"
        />
      </div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={label}
        className={cn(
          photoShape ? characterArtGridClass(photoShape) : "grid grid-cols-3 gap-1.5",
          "transition-opacity",
          // Photos stay at full strength: a click picks straight away, and
          // the grey headline + switch already say the setting is off.
          !checked && !photoShape && "opacity-40",
        )}
      >
        {entries.map((entry) => (
          <EntryTile
            key={entry.id}
            dimension={dimension}
            entry={entry}
            sectionLabel={label}
            checked={checked}
            selectedIndex={selectedIds.indexOf(entry.id)}
            multi={multi}
            isMultiData={isMultiData}
            maxSelected={maxSelected}
            photoShape={photoShape}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onPick={onPick}
            onActivateMulti={onActivateMulti}
            onDemoteToSingle={onDemoteToSingle}
          />
        ))}
      </div>
    </div>
  )
}
