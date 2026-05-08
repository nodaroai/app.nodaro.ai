"use client"

import { memo, useId, useMemo, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { MultiPickBadge } from "./multi-pick-ui"

export interface TabbedEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Group key — must match one of `groupOrder`. */
  readonly group: string
}

export interface SoundTabbedSectionProps {
  readonly label: string
  readonly entries: ReadonlyArray<TabbedEntry>
  /** Tab order. Tabs with no entries (after search filter) hide. */
  readonly groupOrder: ReadonlyArray<string>
  /** Tab labels keyed by group key. */
  readonly groupLabels: Readonly<Record<string, string>>
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
 * Tabbed dimension section: large branded headline + Switch toggle, then a
 * horizontal tab row filtering a tile grid below. Mirrors PersonPicker's
 * TabbedEntryGrid for sound dimensions (genre by category, instruments by
 * family). Pink dot indicator on tabs with picks; numeric count badge in
 * multi-mode.
 *
 * Search is handled by the parent — pass already-filtered entries; this
 * component does NOT filter further.
 */
export const SoundTabbedSection = memo(function SoundTabbedSection({
  label,
  entries,
  groupOrder,
  groupLabels,
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
  const activeEntries = byGroup.get(effectiveActive) ?? []

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

      {visibleGroups.length > 0 && (
        <>
          <div
            role="tablist"
            aria-label={`${label} categories`}
            className={cn(
              "flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D] transition-opacity",
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
                    "relative -mb-px inline-flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                    active
                      ? "border-[#ff0073] text-[#ff0073]"
                      : hasPick
                      ? "border-transparent text-[#ff0073]/80 hover:border-[#ff0073]/40 hover:text-[#ff0073]"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <span>{groupLabels[g] ?? g}</span>
                  {multi && count > 0 && (
                    <span
                      className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-[4px] rounded-full bg-[#ff0073] text-white text-[9px] font-semibold leading-none"
                      aria-label={`${count} selected`}
                    >
                      {count}
                    </span>
                  )}
                  {!multi && hasPick && !active && (
                    <span
                      className="inline-block size-1.5 rounded-full bg-[#ff0073]"
                      aria-hidden="true"
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div
            role={multi ? "group" : "radiogroup"}
            aria-label={`${label} — ${groupLabels[effectiveActive] ?? effectiveActive}`}
            className={cn(
              "grid grid-cols-3 gap-1.5 transition-opacity",
              !checked && "opacity-40",
            )}
          >
            {activeEntries.map((entry) => {
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
        </>
      )}
    </div>
  )
})
