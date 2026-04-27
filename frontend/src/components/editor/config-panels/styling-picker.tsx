"use client"

import { memo, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  STYLINGS,
  STYLING_DIMENSION_ORDER,
  STYLING_DIMENSION_LABELS,
  STYLING_FIELD_BY_DIMENSION,
  type Styling,
  type StylingDimension,
  type StylingValue,
} from "@nodaro-shared/styling"
import { pickIds, togglePick } from "@nodaro-shared/multi-pick"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { HairCutBrowser } from "./hair-cut-browser"
import { EyewearIcon, HeadwearIcon } from "./small-silhouette-icons"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

/** Per-dimension multi-select cap.
 *  - jewelry: 3 (necklace + earrings + rings stacked)
 *  - wardrobe-state: 3 (oversized + wet + ripped composes)
 *  - hair-state: 2 (wet + windswept, messy + voluminous) */
const MAX_SELECTED_BY_STYLING_DIMENSION: Partial<Record<StylingDimension, number>> = {
  jewelry: 3,
  "wardrobe-state": 3,
  "hair-state": 2,
}

interface StylingPickerProps {
  readonly value: StylingValue
  readonly onChange: (patch: Partial<StylingValue>) => void
  readonly className?: string
}

export const StylingPicker = memo(function StylingPicker({
  value,
  onChange,
  className,
}: StylingPickerProps) {
  const [query, setQuery] = useState("")
  /** Multi-select dims (max > 1) intentionally start empty when toggled on —
   *  user picks what they want. We track explicit enable here so the section
   *  stays "checked" without forcing a default selection. */
  const [enabledMulti, setEnabledMulti] = useState<Set<StylingDimension>>(new Set())
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("styling")

  const grouped = useMemo(() => {
    const byDimension = new Map<StylingDimension, Styling[]>()
    for (const styling of STYLINGS) {
      if (!matches(styling.id, styling.label, styling.description, query)) {
        continue
      }
      const list = byDimension.get(styling.dimension) ?? []
      list.push(styling)
      byDimension.set(styling.dimension, list)
    }
    return STYLING_DIMENSION_ORDER.map((dim) => ({
      dimension: dim,
      entries: byDimension.get(dim) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.entries.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search styling"
          placeholder="Search styling"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No styling matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ dimension, entries }) => {
        const field = STYLING_FIELD_BY_DIMENSION[dimension]
        const raw = value[field]
        const selectedIds = pickIds(raw)
        const maxSelected = MAX_SELECTED_BY_STYLING_DIMENSION[dimension] ?? 1
        const isMulti = maxSelected > 1
        const checked = isMulti
          ? enabledMulti.has(dimension) || selectedIds.length > 0
          : selectedIds.length > 0
        if (query && entries.length === 0) return null
        return (
          <DimensionSection
            key={dimension}
            dimension={dimension}
            entries={entries}
            field={field}
            checked={checked}
            selectedIds={selectedIds}
            maxSelected={maxSelected}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onToggle={(next) => {
              if (next) {
                if (isMulti) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.add(dimension)
                    return n
                  })
                } else {
                  const first = STYLINGS.find((s) => s.dimension === dimension)?.id
                  if (first) onChange({ [field]: first } as Partial<StylingValue>)
                }
              } else {
                if (isMulti) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.delete(dimension)
                    return n
                  })
                }
                onChange({ [field]: undefined } as Partial<StylingValue>)
              }
            }}
            onPick={(id) => {
              if (maxSelected <= 1) {
                onChange({ [field]: id } as Partial<StylingValue>)
                return
              }
              const next = togglePick(selectedIds, id, maxSelected)
              if (next.length === 0) onChange({ [field]: undefined } as Partial<StylingValue>)
              else if (next.length === 1) onChange({ [field]: next[0] } as Partial<StylingValue>)
              else onChange({ [field]: next } as Partial<StylingValue>)
            }}
          />
        )
      })}
    </div>
  )
})

interface DimensionSectionProps {
  readonly dimension: StylingDimension
  readonly entries: ReadonlyArray<Styling>
  readonly field: keyof StylingValue
  readonly checked: boolean
  readonly selectedIds: ReadonlyArray<string>
  readonly maxSelected: number
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
}

function DimensionSection({
  dimension,
  entries,
  field,
  checked,
  selectedIds,
  maxSelected,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
}: DimensionSectionProps) {
  const id = useId()
  const baseLabel = STYLING_DIMENSION_LABELS[dimension]
  const multi = maxSelected > 1
  const label = multi ? `${baseLabel} (pick up to ${maxSelected})` : baseLabel
  const isHairCut = dimension === "hair-cut"
  const hairCutCurrent = selectedIds[0]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`${id}-${field}`}
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            className="rounded border-muted-foreground/40"
          />
          <label
            htmlFor={`${id}-${field}`}
            className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground select-none cursor-pointer"
          >
            {label}
          </label>
        </div>
        {/* Hair Cut has 45 entries — even as a chip grid it's a lot. The
            "Pick by look" pill opens the modal with silhouettes so users
            can browse visually without losing the inline chip list. */}
        {isHairCut && (
          <HairCutBrowser
            variant="compact"
            value={checked ? hairCutCurrent : undefined}
            onChange={(id) => {
              if (id) onPick(id)
            }}
          />
        )}
      </div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={label}
        className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}
      >
        {entries.map((entry) => {
          const selectedIdx = selectedIds.indexOf(entry.id)
          const selected = checked && selectedIdx >= 0
          const eyewearIcon = dimension === "eyewear" ? <EyewearIcon eyewearId={entry.id} className="size-6" /> : null
          const headwearIcon = dimension === "headwear" ? <HeadwearIcon headwearId={entry.id} className="size-6" /> : null
          const entryLabel = resolveLabel(entry.id, entry.label)
          const entryDescription = resolveDescription(entry.id, entry.description)
          return (
            <button
              key={entry.id}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={selected}
              title={checked ? entryDescription : `${entryDescription} (click to enable ${label})`}
              onClick={() => onPick(entry.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              {multi && selected && (
                <span
                  className="absolute top-1 right-1 size-4 rounded-full bg-[#ff0073] text-white text-[9px] font-semibold flex items-center justify-center pointer-events-none"
                  aria-hidden="true"
                >
                  {selectedIdx + 1}
                </span>
              )}
              {eyewearIcon}
              {headwearIcon}
              <FitText
                text={entryLabel}
                className={cn(
                  "text-[11px] font-medium leading-tight max-w-full",
                  selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
