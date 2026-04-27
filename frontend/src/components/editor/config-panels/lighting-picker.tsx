"use client"

import { memo, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  LIGHTINGS,
  LIGHTING_CATEGORY_ORDER,
  LIGHTING_CATEGORY_LABELS,
  LIGHTING_FIELD_BY_CATEGORY,
  type Lighting,
  type LightingCategory,
  type LightingValue,
} from "@nodaro-shared/lighting"
import { pickIds, togglePick } from "@nodaro-shared/multi-pick"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { LightingPreview } from "./lighting-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

/** Per-category multi-select cap. style (lighting style) supports 2 picks
 *  (key + rim, soft + hard, beauty-dish + accent). All other categories
 *  are single-select. */
const MAX_SELECTED_BY_LIGHTING_CATEGORY: Partial<Record<LightingCategory, number>> = {
  style: 2,
}

interface LightingPickerProps {
  readonly value: LightingValue
  readonly onChange: (patch: Partial<LightingValue>) => void
  readonly className?: string
}

/**
 * Multi-category lighting picker: each of the 3 lighting dimensions
 * (time-of-day, style, direction) is an independent checkbox section.
 * User can enable any combination of categories and pick one entry per
 * enabled category. A real shot combines entries from multiple categories
 * (e.g. "Golden Hour + Rembrandt + Side").
 */
export const LightingPicker = memo(function LightingPicker({
  value,
  onChange,
  className,
}: LightingPickerProps) {
  const [query, setQuery] = useState("")
  /** Multi-select dims (max > 1) intentionally start empty when toggled on —
   *  user picks what they want. We track explicit enable here so the section
   *  stays "checked" without forcing a default selection. */
  const [enabledMulti, setEnabledMulti] = useState<Set<LightingCategory>>(new Set())
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("lighting")

  const grouped = useMemo(() => {
    const byCategory = new Map<LightingCategory, Lighting[]>()
    for (const lighting of LIGHTINGS) {
      if (!matches(lighting.id, lighting.label, lighting.description, query)) {
        continue
      }
      const list = byCategory.get(lighting.category) ?? []
      list.push(lighting)
      byCategory.set(lighting.category, list)
    }
    return LIGHTING_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      lightings: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((s) => s.lightings.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search lighting"
          placeholder="Search lighting"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No lighting matches "{query}"
        </div>
      )}

      {grouped.map(({ category, lightings }) => {
        const field = LIGHTING_FIELD_BY_CATEGORY[category]
        const raw = value[field]
        const selectedIds = pickIds(raw)
        const maxSelected = MAX_SELECTED_BY_LIGHTING_CATEGORY[category] ?? 1
        const isMulti = maxSelected > 1
        const checked = isMulti
          ? enabledMulti.has(category) || selectedIds.length > 0
          : selectedIds.length > 0
        // Hide the whole section when searching filters everything out AND
        // the category is also empty of matches, to keep the search UX tight.
        // When there's no active query, always show every category section.
        if (query && lightings.length === 0) return null
        return (
          <CategorySection
            key={category}
            category={category}
            lightings={lightings}
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
                  // Single-select: auto-pick the first entry as default.
                  const first = LIGHTINGS.find((l) => l.category === category)?.id
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
  readonly category: LightingCategory
  readonly lightings: ReadonlyArray<Lighting>
  readonly field: (typeof LIGHTING_FIELD_BY_CATEGORY)[LightingCategory]
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
  lightings,
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
  const baseLabel = LIGHTING_CATEGORY_LABELS[category]
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
        {lightings.map((lighting) => {
          const selectedIdx = selectedIds.indexOf(lighting.id)
          const selected = checked && selectedIdx >= 0
          const entryLabel = resolveLabel(lighting.id, lighting.label)
          const entryDescription = resolveDescription(lighting.id, lighting.description)
          return (
            <button
              key={lighting.id}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={selected}
              title={checked ? entryDescription : `${entryDescription} (click to enable ${label})`}
              onClick={() => onPick(lighting.id)}
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
              <LightingPreview lightingId={lighting.id} className="w-full aspect-square" />
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
