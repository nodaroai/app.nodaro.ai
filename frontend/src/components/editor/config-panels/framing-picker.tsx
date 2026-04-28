"use client"

import { memo, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  FRAMINGS,
  FRAMING_CATEGORY_ORDER,
  FRAMING_CATEGORY_LABELS,
  FRAMING_FIELD_BY_CATEGORY,
  type Framing,
  type FramingCategory,
  type FramingValue,
} from "@nodaro/shared"
import { pickIds, togglePick } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { FramingPreview } from "./framing-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

/** Per-category multi-select cap. composition supports 2 picks
 *  (rule-of-thirds + leading-lines, centered + negative-space). */
const MAX_SELECTED_BY_FRAMING_CATEGORY: Partial<Record<FramingCategory, number>> = {
  composition: 2,
}

interface FramingPickerProps {
  readonly value: FramingValue
  readonly onChange: (patch: Partial<FramingValue>) => void
  readonly className?: string
}

/**
 * Multi-category framing picker: each of the 5 framing dimensions (shot-size,
 * angle, coverage, composition, vantage) is an independent checkbox section.
 * User can enable any combination of categories and pick one entry per
 * enabled category. A real shot combines entries from multiple categories
 * (e.g. "Wide Shot + Low Angle + Rule of Thirds").
 */
export const FramingPicker = memo(function FramingPicker({
  value,
  onChange,
  className,
}: FramingPickerProps) {
  const [query, setQuery] = useState("")
  /** Multi-select dims (max > 1) intentionally start empty when toggled on —
   *  user picks what they want. We track explicit enable here so the section
   *  stays "checked" without forcing a default selection. */
  const [enabledMulti, setEnabledMulti] = useState<Set<FramingCategory>>(new Set())
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("framing")

  const grouped = useMemo(() => {
    const byCategory = new Map<FramingCategory, Framing[]>()
    for (const framing of FRAMINGS) {
      if (!matches(framing.id, framing.label, framing.description, query)) {
        continue
      }
      const list = byCategory.get(framing.category) ?? []
      list.push(framing)
      byCategory.set(framing.category, list)
    }
    return FRAMING_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      framings: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((s) => s.framings.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search framings"
          placeholder="Search framings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No framings match "{query}"
        </div>
      )}

      {grouped.map(({ category, framings }) => {
        const field = FRAMING_FIELD_BY_CATEGORY[category]
        const raw = value[field]
        const selectedIds = pickIds(raw)
        const maxSelected = MAX_SELECTED_BY_FRAMING_CATEGORY[category] ?? 1
        const isMulti = maxSelected > 1
        const checked = isMulti
          ? enabledMulti.has(category) || selectedIds.length > 0
          : selectedIds.length > 0
        // Hide the whole section when searching filters everything out AND
        // the category is also empty of matches, to keep the search UX tight.
        // When there's no active query, always show every category section.
        if (query && framings.length === 0) return null
        return (
          <CategorySection
            key={category}
            category={category}
            framings={framings}
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
                    n.add(category)
                    return n
                  })
                } else {
                  const first = FRAMINGS.find((f) => f.category === category)?.id
                  if (first) onChange({ [field]: first })
                }
              } else {
                if (isMulti) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.delete(category)
                    return n
                  })
                }
                onChange({ [field]: undefined })
              }
            }}
            onPick={(id) => {
              if (maxSelected <= 1) {
                onChange({ [field]: id })
                return
              }
              const next = togglePick(selectedIds, id, maxSelected)
              if (next.length === 0) onChange({ [field]: undefined })
              else if (next.length === 1) onChange({ [field]: next[0] })
              else onChange({ [field]: next })
            }}
          />
        )
      })}
    </div>
  )
})

interface CategorySectionProps {
  readonly category: FramingCategory
  readonly framings: ReadonlyArray<Framing>
  readonly field: "shotSize" | "angle" | "coverage" | "composition" | "vantage"
  readonly checked: boolean
  readonly selectedIds: ReadonlyArray<string>
  readonly maxSelected: number
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
}

function CategorySection({
  category,
  framings,
  field,
  checked,
  selectedIds,
  maxSelected,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
}: CategorySectionProps) {
  const id = useId()
  const baseLabel = FRAMING_CATEGORY_LABELS[category]
  const multi = maxSelected > 1
  const label = multi ? `${baseLabel} (pick up to ${maxSelected})` : baseLabel
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5">
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
      <div role={multi ? "group" : "radiogroup"} aria-label={label} className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}>
        {framings.map((framing) => {
          const selectedIdx = selectedIds.indexOf(framing.id)
          const selected = checked && selectedIdx >= 0
          const entryLabel = resolveLabel(framing.id, framing.label)
          const entryDescription = resolveDescription(framing.id, framing.description)
          return (
            <button
              key={framing.id}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={selected}
              title={checked ? entryDescription : `${entryDescription} (click to enable ${label})`}
              onClick={() => onPick(framing.id)}
              className={cn(
                "relative group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              {multi && selected && (
                <span
                  className="absolute top-1 right-1 size-4 rounded-full bg-[#ff0073] text-white text-[9px] font-semibold flex items-center justify-center pointer-events-none z-10"
                  aria-hidden="true"
                >
                  {selectedIdx + 1}
                </span>
              )}
              <FramingPreview framingId={framing.id} className="w-full aspect-square" />
              <FitText
                text={entryLabel}
                className={cn(
                  "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center",
                  selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
