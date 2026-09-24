"use client"

import { memo, useId, useMemo, useState } from "react"
import { cn } from "../lib/cn"
import { getSoundArt, type SoundArtRef } from "../icons/sound-art"
import { MultiPickBadge } from "./multi-pick-ui"
import { SoundArtTile } from "./sound-art-tile"
import { SOUND_GRID_CLASS, SOUND_SECTION_CLASS, SoundSectionHeader } from "./sound-dimension-section"

export interface TabbedEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Group key — must match one of `groupOrder`. */
  readonly group: string
}

export interface SoundTabbedSectionProps {
  readonly label: string
  /** Which catalog dimension these tiles belong to — resolves each tile's picture. */
  readonly art: SoundArtRef
  readonly entries: ReadonlyArray<TabbedEntry>
  /** Tab order. Tabs with no entries (after search filter) hide. */
  readonly groupOrder: ReadonlyArray<string>
  /** Tab labels keyed by group key. */
  readonly groupLabels: Readonly<Record<string, string>>
  /**
   * The parent is filtering by a search query: drop the tab row and list every
   * group that still has a match, each under its own small heading.
   */
  readonly searching?: boolean
  readonly selectedIds: ReadonlyArray<string>
  readonly maxSelected?: number
  readonly isMultiData?: boolean
  readonly checked: boolean
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
  readonly onActivateMulti?: (id: string) => void
  readonly onDemoteToSingle?: (id: string) => void
}

/**
 * Tabbed dimension section: pink headline + Switch toggle, then a tab row
 * filtering a grid of picture tiles (genre by category, instruments by
 * family). Pink count badge on tabs with picks (dot in single mode). While the
 * parent is searching, the tabs give way to every matching group.
 *
 * Search is handled by the parent — pass already-filtered entries; this
 * component does NOT filter further.
 */
export const SoundTabbedSection = memo(function SoundTabbedSection({
  label,
  art,
  entries,
  groupOrder,
  groupLabels,
  searching = false,
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
}: SoundTabbedSectionProps) {
  const id = useId()
  const multi = maxSelected > 1
  const switchId = `${id}-toggle`

  const { visibleGroups, byGroup } = useMemo(() => {
    const map = new Map<string, TabbedEntry[]>()
    for (const e of entries) {
      const g = e.group
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(e)
    }
    const visible = groupOrder.filter((g) => (map.get(g) ?? []).length > 0)
    return { visibleGroups: visible, byGroup: map }
  }, [entries, groupOrder])

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sid of selectedIds) {
      const g = entries.find((e) => e.id === sid)?.group
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1)
    }
    return counts
  }, [selectedIds, entries])

  const [activeGroup, setActiveGroup] = useState<string>(() => {
    for (const sid of selectedIds) {
      const g = entries.find((e) => e.id === sid)?.group
      if (g) return g
    }
    return visibleGroups[0] ?? groupOrder[0] ?? ""
  })

  const effectiveActive = visibleGroups.includes(activeGroup)
    ? activeGroup
    : visibleGroups[0] ?? ""

  const renderGrid = (group: string) => (
    <div
      role={multi ? "group" : "radiogroup"}
      aria-label={`${label} — ${groupLabels[group] ?? group}`}
      className={cn(SOUND_GRID_CLASS, "transition-opacity", !checked && "opacity-40")}
    >
      {(byGroup.get(group) ?? []).map((entry) => {
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
  )

  return (
    <div className={SOUND_SECTION_CLASS}>
      <SoundSectionHeader
        label={label}
        switchId={switchId}
        maxSelected={maxSelected}
        checked={checked}
        onToggle={onToggle}
      />

      {searching ? (
        visibleGroups.map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[.08em] text-[#6b6b75] dark:text-[#9a9aa6]">
              {groupLabels[g] ?? g}
            </div>
            {renderGrid(g)}
          </div>
        ))
      ) : visibleGroups.length > 0 ? (
        <>
          <div
            role="tablist"
            aria-label={`${label} categories`}
            className={cn(
              "flex flex-wrap gap-x-3.5 gap-y-0.5 border-b border-[#ececf1] transition-opacity dark:border-white/[.07]",
              !checked && "opacity-40",
            )}
          >
            {visibleGroups.map((g) => {
              const count = groupCounts.get(g) ?? 0
              const active = g === effectiveActive
              const hasPick = count > 0
              return (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveGroup(g)}
                  className={cn(
                    "relative -mb-px inline-flex items-center gap-[5px] whitespace-nowrap border-b-2 pt-1 pb-2 text-[11px] font-medium transition-colors @min-[520px]:text-[12px]",
                    active
                      ? "border-[#ff0073] text-[#ff0073]"
                      : hasPick
                        ? "border-transparent text-[#ff0073] hover:border-[#ff0073]/40"
                        : "border-transparent text-[#6b6b75] hover:text-foreground dark:text-[#9a9aa6]",
                  )}
                >
                  <span>{groupLabels[g] ?? g}</span>
                  {multi && count > 0 && (
                    <span
                      className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#ff0073] px-1 text-[9px] font-semibold leading-none text-white"
                      aria-label={`${count} selected`}
                    >
                      {count}
                    </span>
                  )}
                  {!multi && hasPick && !active && (
                    <span className="inline-block size-1.5 rounded-full bg-[#ff0073]" aria-hidden="true" />
                  )}
                </button>
              )
            })}
          </div>
          {renderGrid(effectiveActive)}
        </>
      ) : null}
    </div>
  )
})
