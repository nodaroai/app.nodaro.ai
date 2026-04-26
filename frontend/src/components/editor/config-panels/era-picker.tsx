"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  ERAS,
  ERA_CATEGORY_LABELS,
  ERA_CATEGORY_ORDER,
  type Era,
  type EraCategory,
} from "@nodaro-shared/era"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface EraPickerProps {
  readonly value: string
  readonly onValueChange: (eraId: string) => void
  readonly className?: string
}

/**
 * Single-select era / period picker. Entries are grouped by category
 * (20th-Century Decade, Pre-Modern, Speculative). Each tile shows the
 * era's label plus a short tagline so users know the period vibe at a
 * glance. Search filters across label + description.
 */
export const EraPicker = memo(function EraPicker({
  value,
  onValueChange,
  className,
}: EraPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("era")

  const grouped = useMemo(() => {
    const byCategory = new Map<EraCategory, Era[]>()
    for (const era of ERAS) {
      if (!matches(era.id, era.label, era.description, query)) {
        continue
      }
      const list = byCategory.get(era.category) ?? []
      list.push(era)
      byCategory.set(era.category, list)
    }
    return ERA_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      eras: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.eras.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search era"
          placeholder="Search era"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No era matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, eras }) => {
        if (eras.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {ERA_CATEGORY_LABELS[category]}
            </div>
            <div
              role="radiogroup"
              aria-label={ERA_CATEGORY_LABELS[category]}
              className="grid grid-cols-2 gap-1.5"
            >
              {eras.map((era) => {
                const selected = era.id === value
                const label = resolveLabel(era.id, era.label)
                const description = resolveDescription(era.id, era.description)
                return (
                  <button
                    key={era.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(era.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[11px] font-semibold leading-tight truncate w-full",
                        selected ? "text-[#ff0073]" : "text-gray-800 dark:text-[#E2E8F0]",
                      )}
                    >
                      {label}
                    </span>
                    <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2 w-full">
                      {description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})
