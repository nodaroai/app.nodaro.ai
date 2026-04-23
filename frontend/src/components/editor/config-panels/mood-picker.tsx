"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  MOODS,
  MOOD_CATEGORY_LABELS,
  MOOD_CATEGORY_ORDER,
  type Mood,
  type MoodCategory,
} from "@nodaro-shared/mood"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface MoodPickerProps {
  readonly value: string
  readonly onValueChange: (moodId: string) => void
  readonly className?: string
}

/**
 * Single-select mood picker: user picks ONE emotional state from the
 * 26-entry catalog, grouped by category (Positive / Negative / Neutral /
 * Intense). Search filters across label + description.
 */
export const MoodPicker = memo(function MoodPicker({
  value,
  onValueChange,
  className,
}: MoodPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<MoodCategory, Mood[]>()
    for (const mood of MOODS) {
      if (q && !mood.label.toLowerCase().includes(q) && !mood.description.toLowerCase().includes(q)) {
        continue
      }
      const list = byCategory.get(mood.category) ?? []
      list.push(mood)
      byCategory.set(mood.category, list)
    }
    return MOOD_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      moods: byCategory.get(cat) ?? [],
    }))
  }, [query])

  const anyVisible = grouped.some((g) => g.moods.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search mood"
          placeholder="Search mood"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No mood matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, moods }) => {
        if (moods.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {MOOD_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={MOOD_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {moods.map((mood) => {
                const selected = mood.id === value
                return (
                  <button
                    key={mood.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={mood.description}
                    onClick={() => onValueChange(mood.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[11px] font-medium leading-tight truncate max-w-full",
                        selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {mood.label}
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
