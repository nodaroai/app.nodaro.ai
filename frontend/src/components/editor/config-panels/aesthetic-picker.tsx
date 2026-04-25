"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  AESTHETICS,
  AESTHETIC_CATEGORY_LABELS,
  AESTHETIC_CATEGORY_ORDER,
  type Aesthetic,
  type AestheticCategory,
} from "@nodaro-shared/aesthetic"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface AestheticPickerProps {
  readonly value: string
  readonly onValueChange: (aestheticId: string) => void
  readonly className?: string
}

/**
 * Single-select aesthetic / microtrend picker. Entries are grouped by
 * category (Mainstream, Niche, Era, Mood). Microtrends are dense
 * model-recognised tokens; the description below the label gives users a
 * quick read on what each microtrend bundles together. Search filters
 * across label + description.
 */
export const AestheticPicker = memo(function AestheticPicker({
  value,
  onValueChange,
  className,
}: AestheticPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<AestheticCategory, Aesthetic[]>()
    for (const aesthetic of AESTHETICS) {
      if (q && !aesthetic.label.toLowerCase().includes(q) && !aesthetic.description.toLowerCase().includes(q)) {
        continue
      }
      const list = byCategory.get(aesthetic.category) ?? []
      list.push(aesthetic)
      byCategory.set(aesthetic.category, list)
    }
    return AESTHETIC_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      aesthetics: byCategory.get(cat) ?? [],
    }))
  }, [query])

  const anyVisible = grouped.some((g) => g.aesthetics.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search aesthetic"
          placeholder="Search aesthetic"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No aesthetic matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, aesthetics }) => {
        if (aesthetics.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {AESTHETIC_CATEGORY_LABELS[category]}
            </div>
            <div
              role="radiogroup"
              aria-label={AESTHETIC_CATEGORY_LABELS[category]}
              className="grid grid-cols-2 gap-1.5"
            >
              {aesthetics.map((aesthetic) => {
                const selected = aesthetic.id === value
                return (
                  <button
                    key={aesthetic.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={aesthetic.description}
                    onClick={() => onValueChange(aesthetic.id)}
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
                      {aesthetic.label}
                    </span>
                    <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2 w-full">
                      {aesthetic.description}
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
