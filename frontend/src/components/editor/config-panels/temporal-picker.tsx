"use client"

import { memo, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  TEMPORALS,
  TEMPORAL_CATEGORY_ORDER,
  TEMPORAL_CATEGORY_LABELS,
  TEMPORAL_FIELD_BY_CATEGORY,
  type Temporal,
  type TemporalCategory,
  type TemporalValue,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { TemporalPreview } from "./temporal-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface TemporalPickerProps {
  readonly value: TemporalValue
  readonly onChange: (patch: Partial<TemporalValue>) => void
  readonly className?: string
}

/**
 * Multi-category temporal picker: each of the 4 temporal dimensions
 * (speed, freeze, direction, shutter) is an independent checkbox section.
 * User can enable any combination of categories and pick one entry per
 * enabled category. A real shot combines entries from multiple categories
 * (e.g. "Slow Motion + Bullet Time + Reverse + Long Exposure").
 */
export const TemporalPicker = memo(function TemporalPicker({
  value,
  onChange,
  className,
}: TemporalPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("temporal")

  const grouped = useMemo(() => {
    const byCategory = new Map<TemporalCategory, Temporal[]>()
    for (const temporal of TEMPORALS) {
      if (!matches(temporal.id, temporal.label, temporal.description, query)) {
        continue
      }
      const list = byCategory.get(temporal.category) ?? []
      list.push(temporal)
      byCategory.set(temporal.category, list)
    }
    return TEMPORAL_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      temporals: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((s) => s.temporals.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search temporal"
          placeholder="Search temporal"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No temporal matches "{query}"
        </div>
      )}

      {grouped.map(({ category, temporals }) => {
        const field = TEMPORAL_FIELD_BY_CATEGORY[category]
        const current = value[field]
        const checked = current !== undefined && current !== ""
        // Hide the whole section when searching filters everything out AND
        // the category is also empty of matches, to keep the search UX tight.
        // When there's no active query, always show every category section.
        if (query && temporals.length === 0) return null
        return (
          <CategorySection
            key={category}
            category={category}
            temporals={temporals}
            field={field}
            checked={checked}
            current={current}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onToggle={(next) => {
              if (next) {
                // Enabling: auto-pick the first entry in this category as default.
                const first = TEMPORALS.find((t) => t.category === category)?.id
                if (first) onChange({ [field]: first })
              } else {
                onChange({ [field]: undefined })
              }
            }}
            onPick={(id) => onChange({ [field]: id })}
          />
        )
      })}
    </div>
  )
})

interface CategorySectionProps {
  readonly category: TemporalCategory
  readonly temporals: ReadonlyArray<Temporal>
  readonly field: "temporalSpeed" | "temporalFreeze" | "temporalDirection" | "temporalShutter"
  readonly checked: boolean
  readonly current: string | undefined
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
}

function CategorySection({
  category,
  temporals,
  field,
  checked,
  current,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
}: CategorySectionProps) {
  const id = useId()
  const label = TEMPORAL_CATEGORY_LABELS[category]
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
      <div role="radiogroup" aria-label={label} className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}>
        {temporals.map((temporal) => {
          const selected = checked && temporal.id === current
          const entryLabel = resolveLabel(temporal.id, temporal.label)
          const entryDescription = resolveDescription(temporal.id, temporal.description)
          return (
            <button
              key={temporal.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={checked ? entryDescription : `${entryDescription} (click to enable ${label})`}
              onClick={() => onPick(temporal.id)}
              className={cn(
                "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <TemporalPreview temporalId={temporal.id} className="w-full aspect-square" />
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
